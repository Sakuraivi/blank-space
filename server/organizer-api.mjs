import { getOrganizerSession, loginOrganizer, logoutOrganizer, organizerCookie } from './organizer-auth.mjs';
import { getOrganizerStatus, saveOrganizerConfig, setOrganizerEnabled, clearOrganizerKey } from './organizer-config.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...JSON_HEADERS, ...headers } });
const error = (reason, status) => json({ reason }, status);
const services = { getOrganizerStatus, saveOrganizerConfig, setOrganizerEnabled, clearOrganizerKey };
const methods = new Map([
  ['/api/organizer/login', ['POST']], ['/api/organizer/session', ['GET']], ['/api/organizer/logout', ['POST']],
  ['/api/organizer/status', ['GET']], ['/api/organizer/config', ['POST', 'DELETE']], ['/api/organizer/enabled', ['POST']],
]);

async function readBody(request, maxBytes) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('invalid_config');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_config');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('invalid_config'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_config');
    return body;
  } catch { throw new Error('invalid_config'); }
  finally { reader.releaseLock(); }
}

function authResponse(result) {
  return json(result.body, result.status, {
    ...(result.cookie ? { 'Set-Cookie': result.cookie } : {}),
    ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
  });
}

export async function handleOrganizerApi(request, env, { now = Date.now, configServices = services } = {}) {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (!methods.has(path)) return error('not_found', 404);
    if (!methods.get(path).includes(request.method)) return error('method_not_allowed', 405);
    let body;
    if (request.method !== 'GET') {
      if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return error('origin_rejected', 403);
      body = await readBody(request, path === '/api/organizer/login' ? 1024 : 8192);
    }
    if (path === '/api/organizer/login') return authResponse(await loginOrganizer(request, env, body.password, { now }));
    if (path === '/api/organizer/logout') return authResponse(await logoutOrganizer(request, env));
    const session = await getOrganizerSession(request, env, { now });
    if (path === '/api/organizer/session') return json(session, 200, session.authenticated ? {} : { 'Set-Cookie': organizerCookie() });
    if (!session.authenticated) return error('auth_required', 401);
    if (path === '/api/organizer/status') return json(await configServices.getOrganizerStatus(env, { now }));
    if (env.LIUBAI_MAINTENANCE === '1') return error('maintenance', 503);
    const action = path === '/api/organizer/enabled' ? configServices.setOrganizerEnabled :
      request.method === 'DELETE' ? configServices.clearOrganizerKey : configServices.saveOrganizerConfig;
    const result = await action(env, body, { now });
    return json(result.body, result.status);
  } catch (failure) {
    const reason = failure?.message === 'invalid_config' ? 'invalid_config' :
      failure?.message === 'admin_unconfigured' ? 'admin_unconfigured' : 'service_unavailable';
    return error(reason, reason === 'invalid_config' ? 400 : 503);
  }
}
