import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleOrganizerApi } from './organizer-api.mjs';
import { ORGANIZER_COOKIE, ORGANIZER_SESSION_MS, ORGANIZER_LOGIN_WINDOW_MS } from './organizer-auth.mjs';
import { createStandaloneWorker } from './standalone-worker.mjs';

const ORIGIN = 'https://organizer.example.test';
const PASSWORD = 'synthetic-random-management-password-only-tests';
const AUTH_SCHEMA = `CREATE TABLE organizer_sessions(token_hash TEXT PRIMARY KEY, auth_epoch TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE organizer_login_limits(bucket_hash TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, attempts INTEGER NOT NULL, updated_at INTEGER NOT NULL);`;
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const identity = { 'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': 'owner@example.test' };

function d1(sqlite) {
  return { prepare(sql) {
    let parameters = [];
    return {
      bind(...values) { parameters = values; return this; },
      async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...parameters).changes) } }; },
    };
  } };
}

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(AUTH_SCHEMA);
  t.after(() => sqlite.close());
  let time = 1800000000000;
  const calls = [];
  const configServices = {
    getOrganizerStatus: async () => ({ config: { hasKey: false, revision: 0 } }),
    saveOrganizerConfig: async (_env, body) => { calls.push(body); return { ok: false, status: 409, body: { reason: 'config_conflict' } }; },
    setOrganizerEnabled: async (_env, body) => { calls.push(body); return { ok: true, status: 200, body: { saved: true, revision: 2 } }; },
    clearOrganizerKey: async (_env, body) => { calls.push(body); return { ok: true, status: 200, body: { deleted: true, revision: 3 } }; },
  };
  const env = { DB: d1(sqlite), LIUBAI_ADMIN_PASSWORD_HASH: await hash(PASSWORD) };
  const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const request = new Request(ORIGIN + path, { method, headers: {
      ...(method !== 'GET' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), 'cf-connecting-ip': '192.0.2.10', ...headers,
    }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const response = await handleOrganizerApi(request, env, { now: () => time, configServices });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { sqlite, env, call, calls, now: () => time, advance: n => { time += n; } };
}

test('new organizer permissions reject anonymous/forged identity and cross-origin writes before any service change', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.call('/api/organizer/session')).body, { authenticated: false });
  for (const [path, method] of [['status', 'GET'], ['config', 'POST'], ['config', 'DELETE'], ['enabled', 'POST']]) {
    const result = await f.call(`/api/organizer/${path}`, { method, ...(method === 'GET' ? {} : { body: {} }), headers: identity });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { reason: 'auth_required' });
  }
  for (const headers of [{ Origin: 'https://attacker.example.test' }, { Origin: 'null' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const result = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD }, headers });
    assert.equal(result.status, 403);
    assert.equal(result.body.reason, 'origin_rejected');
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_sessions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_login_limits').get().n, 0);
  assert.deepEqual(f.calls, []);
});

test('new login grants only an opaque 8h cookie, and logout/expiry/password rotation revoke old sessions', async t => {
  const f = await fixture(t);
  const login = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, { authenticated: true, expiresAt: f.now() + ORGANIZER_SESSION_MS });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-liubai_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  const cookie = setCookie.split(';')[0];
  const row = f.sqlite.prepare('SELECT * FROM organizer_sessions').get();
  assert.equal(row.token_hash, await hash(cookie.slice(ORGANIZER_COOKIE.length + 1)));
  assert.notEqual(row.auth_epoch, f.env.LIUBAI_ADMIN_PASSWORD_HASH);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(PASSWORD));
  assert.equal((await f.call('/api/organizer/status', { cookie })).status, 200);
  assert.equal((await f.call('/api/organizer/session', { cookie })).body.authenticated, true);
  const logout = await f.call('/api/organizer/logout', { method: 'POST', body: {}, cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.call('/api/organizer/status', { cookie })).status, 401);
  const second = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  f.advance(ORGANIZER_SESSION_MS);
  assert.equal((await f.call('/api/organizer/status', { cookie: secondCookie })).status, 401);
  const third = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  const thirdCookie = third.headers.get('set-cookie').split(';')[0];
  f.env.LIUBAI_ADMIN_PASSWORD_HASH = await hash('another-synthetic-random-management-password');
  assert.equal((await f.call('/api/organizer/status', { cookie: thirdCookie })).status, 401);
  assert.equal((await f.call('/api/organizer/session', { cookie: thirdCookie })).body.authenticated, false);
});

test('new login rate limit persists in D1, is atomic per IP and resets after its fixed window', async t => {
  const f = await fixture(t);
  const attempts = await Promise.all(Array.from({ length: 10 }, () => f.call('/api/organizer/login', { method: 'POST', body: { password: 'wrong-password' } })));
  assert.ok(attempts.every(result => result.status === 401 && result.body.reason === 'invalid_password'));
  const limited = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.reason, 'rate_limited');
  assert.equal(limited.headers.get('retry-after'), '900');
  const row = f.sqlite.prepare('SELECT * FROM organizer_login_limits').get();
  assert.equal(row.attempts, 11);
  assert.doesNotMatch(JSON.stringify(row), /192\.0\.2\.10|wrong-password/);
  assert.equal((await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD }, headers: { 'cf-connecting-ip': '192.0.2.11' } })).status, 200);
  f.advance(ORGANIZER_LOGIN_WINDOW_MS);
  assert.equal((await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } })).status, 200);
});

test('new JSON boundary and configuration dispatch preserve service CAS errors, optional monitoring fields and maintenance', async t => {
  const f = await fixture(t);
  const login = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const options of [{ body: '{broken' }, { body: [] }, { body: ' '.repeat(8193) }, { body: {}, headers: { 'Content-Type': 'text/plain' } }]) {
    assert.equal((await f.call('/api/organizer/config', { method: 'POST', cookie, ...options })).status, 400);
  }
  const body = { expectedRevision: 1, callLimit: null, budgetCny: null, inputRate: null, outputRate: null };
  const conflict = await f.call('/api/organizer/config', { method: 'POST', cookie, body });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, { reason: 'config_conflict' });
  assert.deepEqual(f.calls, [body]);
  assert.equal((await f.call('/api/organizer/enabled', { method: 'POST', cookie, body: { expectedRevision: 1, enabled: false } })).body.revision, 2);
  assert.equal((await f.call('/api/organizer/config', { method: 'DELETE', cookie, body: { expectedRevision: 2 } })).body.deleted, true);
  f.env.LIUBAI_MAINTENANCE = '1';
  const count = f.calls.length;
  for (const [path, method] of [['config', 'POST'], ['config', 'DELETE'], ['enabled', 'POST']]) {
    const result = await f.call(`/api/organizer/${path}`, { method, cookie, body: {} });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { reason: 'maintenance' });
  }
  assert.equal(f.calls.length, count);
  assert.equal((await f.call('/api/organizer/session', { cookie })).body.authenticated, true);
  assert.equal((await f.call('/api/organizer/logout', { method: 'POST', body: {}, cookie })).status, 200);
  assert.equal((await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } })).status, 200);
});

test('new auth database errors fail closed and never disclose internal material', async t => {
  const f = await fixture(t);
  delete f.env.LIUBAI_ADMIN_PASSWORD_HASH;
  const missing = await f.call('/api/organizer/login', { method: 'POST', body: { password: PASSWORD } });
  assert.deepEqual(missing.body, { reason: 'admin_unconfigured' });
  f.env.LIUBAI_ADMIN_PASSWORD_HASH = await hash(PASSWORD);
  f.env.DB = { prepare() { throw Error(`PRIVATE ${PASSWORD}`); } };
  for (const options of [{ path: 'login', method: 'POST', body: { password: PASSWORD } }, { path: 'status', cookie: `${ORGANIZER_COOKIE}=${'a'.repeat(43)}` }]) {
    const result = await f.call('/api/organizer/' + options.path, options);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { reason: 'service_unavailable' });
  }
  assert.deepEqual(f.calls, []);
});

test('new standalone admin entry keeps security headers, migration gate, legacy rejection and identity stripping', async () => {
  let observed, organizerCalls = 0;
  const worker = createStandaloneWorker({ handleOrganizerApiImpl: async request => { observed = request; organizerCalls++; return Response.json({ ok: true }); } });
  const env = { LIUBAI_DATA_MIGRATION_STATE: 'verified', DB: { prepare: () => ({ first: async () => ({ default_calls: 2, reserved_micros: 100000 }) }) },
    ASSETS: { fetch: async request => { observed = request; return new Response('<main>Independent organizer login</main>'); } } };
  for (const path of ['/admin', '/admin/', '/admin.html']) {
    const response = await worker.fetch(new Request(ORIGIN + path, { headers: identity }), env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Independent organizer/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(new URL(observed.url).pathname, '/admin');
  }
  const request = new Request(ORIGIN + '/api/organizer/session', { headers: identity });
  assert.equal((await worker.fetch(request, env)).status, 200);
  for (const name of Object.keys(identity)) assert.equal(observed.headers.get(name), null);
  assert.equal((await worker.fetch(new Request(ORIGIN + '/api/admin/status', { headers: identity }), env)).status, 404);
  env.LIUBAI_DATA_MIGRATION_STATE = 'pending';
  assert.equal((await worker.fetch(request, env)).status, 503);
  assert.equal(organizerCalls, 1);
});
