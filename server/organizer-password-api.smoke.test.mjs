import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handleOrganizerApi } from './organizer-api.mjs';

// Isolated HTTP contract smoke: synthetic credentials, real schemas, no network.
const ORIGIN = 'https://organizer-password.example.test';
const OLD_PASSWORD = 'synthetic-old-password-for-http-smoke-only';
const NEW_PASSWORD = '  新的🌸管理口令-é-only-synthetic-2026  ';
const SYNTHETIC_KEY = 'synthetic-ciphertext-no-real-provider-key';
const NOW = Date.parse('2026-10-31T12:00:00+08:00');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const identity = { 'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': 'forged@example.test' };
const rotation = overrides => ({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD, ...overrides });

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_glamorous_jackal.sql', '0001_rapid_shocker.sql', '0002_organizer_admin.sql', '0003_organizer_auth.sql', '0004_organizer_credentials.sql']) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  }
  t.after(() => sqlite.close());
  sqlite.prepare(`INSERT INTO pilot_config (id,encrypted_key,iv,enabled,revision,invite_hash,admin_user_id)
    VALUES ('main',?,'synthetic-legacy-iv',0,4,'synthetic-invite-digest','synthetic-legacy-owner')`).run(SYNTHETIC_KEY);
  sqlite.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main','bailian','synthetic-model:v2','manual',NULL,NULL,NULL,NULL,?,'synthetic-organizer-iv',1,7,?)`).run(SYNTHETIC_KEY, NOW - 5000);
  for (const index of [1, 2]) {
    sqlite.prepare(`INSERT INTO pilot_requests
      (request_id,session_id,digest,config_version,state,created_at_ms,finished_at_ms,outcome,prompt_tokens,completion_tokens,total_tokens,
       source_mode,provider_id,model_id,price_version,reserved_micros)
      VALUES (?,?,?,'synthetic-history','finished',?,?,'candidate',100,30,130,'default','deepseek','deepseek-flash','synthetic-price',50000)`)
      .run(`synthetic-request-${index}`, `synthetic-session-${index}`, `synthetic-digest-${index}`, NOW - 2000 + index, NOW - 1000 + index);
  }
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_network'); });
  const serviceCalls = [];
  const configServices = {
    async getOrganizerStatus() { serviceCalls.push('status'); return { config: { hasKey: true, revision: 7 }, budget: { usedCalls: 2, reservedCny: 0.1 } }; },
    async saveOrganizerConfig() { serviceCalls.push('save'); throw new Error('unexpected_config_mutation'); },
    async setOrganizerEnabled() { serviceCalls.push('enable'); throw new Error('unexpected_config_mutation'); },
    async clearOrganizerKey() { serviceCalls.push('clear'); throw new Error('unexpected_config_mutation'); },
  };
  const env = { LIUBAI_ADMIN_PASSWORD_HASH: sha256(OLD_PASSWORD), DB: { prepare(sql) {
    let parameters = [];
    return {
      bind(...values) { parameters = values; return this; },
      async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...parameters).changes) } }; },
    };
  } } };
  const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const request = new Request(ORIGIN + path, { method, headers: {
      ...(method === 'GET' ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), 'cf-connecting-ip': '192.0.2.70', ...headers,
    }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const response = await handleOrganizerApi(request, env, { now: () => NOW, configServices });
    const json = await response.json();
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const serialized = JSON.stringify(json);
    const credential = sqlite.prepare("SELECT * FROM organizer_credentials WHERE id = 'main'").get();
    for (const secret of [OLD_PASSWORD, NEW_PASSWORD, SYNTHETIC_KEY, env.LIUBAI_ADMIN_PASSWORD_HASH, credential.password_hash, credential.salt, credential.auth_epoch, cookie?.split('=')[1]]) {
      if (secret) assert.equal(serialized.includes(secret), false, 'JSON response must not expose credentials or session material');
    }
    assert.doesNotMatch(serialized, /password_hash|encrypted_key|auth_epoch|token_hash/);
    return { status: response.status, body: json, headers: response.headers };
  };
  const login = async password => {
    const result = await call('/api/organizer/login', { method: 'POST', body: { password } });
    assert.equal(result.status, 200);
    const cookie = result.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie, /^__Host-liubai_admin=[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(result.body).includes(cookie.split('=')[1]), false);
    return cookie;
  };
  const sharedDigest = () => sha256(JSON.stringify(Object.fromEntries(['pilot_config', 'organizer_config', 'pilot_requests'].map(table => [
    table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'pilot_requests' ? 'request_id' : 'id'}`).all(),
  ]))));
  return { sqlite, env, call, login, sharedDigest, serviceCalls, network };
}

test('password HTTP boundary rejects anonymous, forged identity, cross-origin, methods and malformed/oversize bodies without changing credentials', async t => {
  const f = fixture(t);
  const credentials = JSON.stringify(f.sqlite.prepare('SELECT * FROM organizer_credentials').all());
  const shared = f.sharedDigest();
  for (const headers of [{}, identity]) {
    const response = await f.call('/api/organizer/password', { method: 'POST', body: rotation(), headers });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { reason: 'auth_required' });
  }
  const cookie = await f.login(OLD_PASSWORD);
  for (const headers of [{ Origin: 'https://attacker.example.test' }, { Origin: 'null' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await f.call('/api/organizer/password', { method: 'POST', cookie, body: rotation(), headers });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { reason: 'origin_rejected' });
  }
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await f.call('/api/organizer/password', { method, cookie });
    assert.equal(response.status, 405);
    assert.deepEqual(response.body, { reason: 'method_not_allowed' });
  }
  for (const options of [
    { body: rotation(), headers: { 'Content-Type': 'text/plain' } },
    { body: '{broken-json' }, { body: [] },
    { body: { ...rotation(), padding: 'x'.repeat(8192) } },
    { body: { ...rotation(), padding: '🌸'.repeat(2100) } },
  ]) {
    const response = await f.call('/api/organizer/password', { method: 'POST', cookie, ...options });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { reason: 'invalid_config' });
  }
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM organizer_credentials').all()), credentials);
  assert.equal(f.sharedDigest(), shared);
  assert.deepEqual(f.serviceCalls, []);
  assert.equal(f.network.mock.calls.length, 0);
});

test('password HTTP rotation keeps a session after wrong current password, revokes all old sessions and accepts only the exact new password', async t => {
  const f = fixture(t);
  const first = await f.login(OLD_PASSWORD);
  const second = await f.login(OLD_PASSWORD);
  const wrong = await f.call('/api/organizer/password', { method: 'POST', cookie: first, body: rotation({ currentPassword: 'synthetic-wrong-current-password' }) });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { reason: 'current_password_invalid' });
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal((await f.call('/api/organizer/session', { cookie: first })).body.authenticated, true);
  const changed = await f.call('/api/organizer/password', { method: 'POST', cookie: first, body: rotation() });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body, { changed: true, authenticated: false });
  assert.equal(changed.headers.get('set-cookie'), '__Host-liubai_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  for (const cookie of [first, second]) {
    assert.equal((await f.call('/api/organizer/session', { cookie })).body.authenticated, false);
    assert.equal((await f.call('/api/organizer/status', { cookie })).status, 401);
    assert.equal((await f.call('/api/organizer/password', { method: 'POST', cookie, body: rotation() })).status, 401);
  }
  for (const password of [OLD_PASSWORD, NEW_PASSWORD.trim(), NEW_PASSWORD.normalize('NFD')]) {
    const result = await f.call('/api/organizer/login', { method: 'POST', body: { password } });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { reason: 'invalid_password' });
  }
  const current = await f.login(NEW_PASSWORD);
  assert.equal((await f.call('/api/organizer/session', { cookie: current })).body.authenticated, true);
  assert.equal((await f.call('/api/organizer/status', { cookie: current })).status, 200);
  assert.equal(f.network.mock.calls.length, 0);
});

test('password API leaves shared encrypted configuration and every historical usage column unchanged', async t => {
  const f = fixture(t);
  const before = f.sharedDigest();
  const credentialBefore = JSON.stringify(f.sqlite.prepare('SELECT * FROM organizer_credentials').all());
  const cookie = await f.login(OLD_PASSWORD);
  const statusBefore = await f.call('/api/organizer/status', { cookie });
  assert.equal((await f.call('/api/organizer/password', { method: 'POST', cookie, body: rotation() })).status, 200);
  const newCookie = await f.login(NEW_PASSWORD);
  const statusAfter = await f.call('/api/organizer/status', { cookie: newCookie });
  assert.deepEqual(statusAfter.body, statusBefore.body);
  assert.notEqual(JSON.stringify(f.sqlite.prepare('SELECT * FROM organizer_credentials').all()), credentialBefore);
  assert.equal(f.sharedDigest(), before);
  const usage = f.sqlite.prepare('SELECT COUNT(*) AS calls, SUM(reserved_micros) AS reserved, SUM(prompt_tokens) AS input, SUM(completion_tokens) AS output FROM pilot_requests').get();
  assert.deepEqual({ ...usage }, { calls: 2, reserved: 100000, input: 200, output: 60 });
  assert.deepEqual(f.serviceCalls, ['status', 'status']);
  assert.equal(f.network.mock.calls.length, 0);
});
