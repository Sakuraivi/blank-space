import { handleApi } from './api.mjs';

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

export function createStandaloneWorker({ handleApiImpl = handleApi } = {}) {
  return Object.freeze({
    async fetch(request, env) {
      const url = new URL(request.url);
      if (blockedIdentityPath(url.pathname)) return fallback('not_found', 404);
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        return Response.redirect(new URL('/?settings=ai', url), 303);
      }
      const sanitized = withoutPlatformIdentity(request);
      if (url.pathname.startsWith('/api/')) {
        if (!await importedLedgerReady(env)) return fallback('service_unconfigured', 503);
        return handleApiImpl(sanitized, env);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return fallback('method_not_allowed', 405);
      if (!env.ASSETS?.fetch) return fallback('assets_unconfigured', 503);
      return env.ASSETS.fetch(sanitized);
    },
  });
}

export default createStandaloneWorker();
