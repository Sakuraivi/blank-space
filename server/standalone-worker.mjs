import { handleApi } from './api.mjs';
import { handleOrganizerApi } from './organizer-api.mjs';

// Standalone entry only. No Sites dispatch, OAuth, Vinext or connector runtime.
// Activation requires a verified import of the historical ledger.
// A fresh database is never a new trial budget.
export const MIGRATION_FLOOR = Object.freeze({ defaultCalls: 2, reservedMicros: 100000 });
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const fallback = (reason, status) => Response.json({ status: 'fallback', reason }, { status, headers: JSON_HEADERS });
const blockedIdentityPath = pathname => /^\/api\/admin(?:\/|$)/.test(pathname) ||
  ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(pathname.replace(/\/$/, ''));

function withoutPlatformIdentity(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-') || name === 'x-openai-user-id' || name === 'x-openai-user-email') headers.delete(name);
  }
  return new Request(request, { headers });
}

async function importedLedgerReady(env) {
  if (env.LIUBAI_DATA_MIGRATION_STATE !== 'verified' || !env.DB?.prepare) return false;
  try {
    const row = await env.DB.prepare(`SELECT
      COUNT(*) AS default_calls,
      COALESCE(SUM(reserved_micros), 0) AS reserved_micros
      FROM pilot_requests WHERE source_mode = 'default'`).first();
    const calls = Number(row?.default_calls), reserved = Number(row?.reserved_micros);
    return Number.isSafeInteger(calls) && calls >= MIGRATION_FLOOR.defaultCalls &&
      Number.isSafeInteger(reserved) && reserved >= MIGRATION_FLOOR.reservedMicros;
  } catch { return false; }
}

export function createStandaloneWorker({ handleApiImpl = handleApi, handleOrganizerApiImpl = handleOrganizerApi } = {}) {
  return Object.freeze({
    async fetch(request, env) {
      const url = new URL(request.url);
      if (blockedIdentityPath(url.pathname)) return fallback('not_found', 404);
      const sanitized = withoutPlatformIdentity(request);
      if (['/clarity', '/clarity/', '/clarity.html'].includes(url.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) return fallback('method_not_allowed', 405);
        if (!env.ASSETS?.fetch) return fallback('assets_unconfigured', 503);
        // One real pilot URL. Fixture adapters are loopback-only tooling and
        // are never imported into this deployed entry point.
        const asset = await env.ASSETS.fetch(new Request(new URL('/clarity-v3', url), sanitized));
        const headers = new Headers(asset.headers);
        headers.set('Cache-Control', 'no-store');
        return new Response(request.method === 'HEAD' ? null : asset.body, {status: asset.status, headers});
      }
      if (['/admin', '/admin/', '/admin.html'].includes(url.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) return fallback('method_not_allowed', 405);
        if (!env.ASSETS?.fetch) return fallback('assets_unconfigured', 503);
        // The assets binding resolves the extensionless route to admin.html.
        // Request that canonical path to avoid its automatic .html redirect.
        const asset = await env.ASSETS.fetch(new Request(new URL('/admin', url), sanitized));
        const headers = new Headers(asset.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('Content-Security-Policy', "frame-ancestors 'none'");
        headers.set('X-Frame-Options', 'DENY');
        headers.set('Referrer-Policy', 'no-referrer');
        return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
      }
      if (url.pathname.startsWith('/api/')) {
        const organizerApi = /^\/api\/organizer(?:\/|$)/.test(url.pathname);
        if (!await importedLedgerReady(env)) return organizerApi
          ? Response.json({ reason: 'service_unavailable' }, { status: 503, headers: JSON_HEADERS })
          : fallback('service_unconfigured', 503);
        if (organizerApi) return handleOrganizerApiImpl(sanitized, env);
        return handleApiImpl(sanitized, env);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return fallback('method_not_allowed', 405);
      if (!env.ASSETS?.fetch) return fallback('assets_unconfigured', 503);
      const asset = await env.ASSETS.fetch(sanitized);
      if (/^\/clarity-v3[^/]*\.(?:mjs|css)$/u.test(url.pathname)) {
        const headers = new Headers(asset.headers); headers.set('Cache-Control', 'no-store');
        return new Response(asset.body, {status: asset.status, headers});
      }
      return asset;
    },
  });
}

export default createStandaloneWorker();
