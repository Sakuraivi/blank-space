import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, CONSENT_VERSION, PRICE_VALID_UNTIL } from './api.mjs';
import { encryptKey, decryptKey } from './secrets.mjs';
import { createSession } from '../public/core.mjs';

const SCHEMA = readFileSync(new URL('../drizzle/0000_glamorous_jackal.sql', import.meta.url), 'utf8');
const ORIGIN = 'https://liubai.test';
const DATE = Date.parse('2026-10-30T12:00:00+08:00');
const API_KEY = 'fake-deepseek-key-only-tests';
const INVITE = 'friends-test-2026';
const OWNER = { 'oai-authenticated-user-id': 'site-owner-123', 'oai-authenticated-user-email': 'owner@example.test' };
const CANDIDATE = { reflection: { text: '你说这次散步很开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null };
const complete = usage => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(CANDIDATE) } }], usage: usage ?? { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }), { headers: { 'Content-Type': 'application/json' } });

function d1(sqlite) {
  return { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  } };
}
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(SCHEMA);
  t.after(() => sqlite.close());
  let calls = 0;
  const env = { DB: d1(sqlite), LIUBAI_BOOTSTRAP_EMAIL: 'owner@example.test', LIUBAI_SECRET_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') };
  const options = { now: () => DATE, fetchImpl: async () => { calls++; return complete(); } };
  const call = async (path, { method = 'GET', body, headers = {}, options: custom = {} } = {}) => {
    const req = new Request(`${ORIGIN}${path}`, { method, headers: { ...(method !== 'GET' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const res = await handleApi(req, env, { ...options, ...custom });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const configure = async (overrides = {}) => {
    const result = await call('/api/admin/config', { method: 'POST', headers: OWNER, body: { apiKey: API_KEY, inviteCode: INVITE, enabled: true, ...overrides } });
    assert.equal(result.status, 200, JSON.stringify(result));
    return (await call('/api/ai/status')).body;
  };
  return { sqlite, env, options, call, configure, calls: () => calls };
}
function input(overrides = {}) {
  const session = createSession(); session.id = 'session-0001'; session.story = '这次散步很开心。';
  return { requestId: 'request-0001', revision: 1, configVersion: 'deepseek-1', consentVersion: CONSENT_VERSION, inviteCode: INVITE, stage: 'reflect', allowNextStep: false, session, ...overrides };
}

test('anonymous and non-owner administrators are rejected without binding or calling a model', async t => {
  const f = fixture(t);
  for (const headers of [{}, { 'oai-authenticated-user-id': 'other-id', 'oai-authenticated-user-email': 'stranger@example.test' }]) {
    const result = await f.call('/api/admin/status', { headers });
    assert.equal(result.status, 403);
    assert.equal(result.body.reason, 'admin_required');
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_config').get().n, 0);
  assert.equal(f.calls(), 0);
});

test('bootstrap requires designated owner email and subsequent authorization binds the Site user ID', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/admin/status', { headers: { ...OWNER, 'oai-authenticated-user-email': 'OWNER@EXAMPLE.TEST' } })).status, 200);
  assert.equal(f.sqlite.prepare("SELECT admin_user_id FROM pilot_config WHERE id='main'").get().admin_user_id, OWNER['oai-authenticated-user-id']);
  assert.equal((await f.call('/api/admin/status', { headers: { ...OWNER, 'oai-authenticated-user-id': 'different-site-id' } })).status, 403);
  assert.equal((await f.call('/api/admin/status', { headers: { ...OWNER, 'oai-authenticated-user-email': 'changed-email@example.test' } })).status, 200);
  delete f.env.LIUBAI_BOOTSTRAP_EMAIL;
  assert.equal((await f.call('/api/admin/status', { headers: OWNER })).status, 200);
});

test('missing bootstrap configuration prevents a first administrator claim', async t => {
  const f = fixture(t); delete f.env.LIUBAI_BOOTSTRAP_EMAIL;
  assert.equal((await f.call('/api/admin/status', { headers: OWNER })).status, 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_config').get().n, 0);
});

test('admin key is encrypted, invite is hashed, and status responses never echo secrets', async t => {
  const f = fixture(t);
  const status = await f.configure();
  assert.equal(status.enabled, true);
  const row = f.sqlite.prepare("SELECT * FROM pilot_config WHERE id='main'").get();
  assert.notEqual(row.encrypted_key, API_KEY);
  assert.notEqual(row.invite_hash, INVITE);
  assert.doesNotMatch(JSON.stringify(row), /fake-deepseek-key|friends-test/);
  assert.equal(await decryptKey(row, f.env.LIUBAI_SECRET_KEY), API_KEY);
  const admin = await f.call('/api/admin/status', { headers: OWNER });
  for (const serialized of [JSON.stringify(status), JSON.stringify(admin.body)]) {
    assert.doesNotMatch(serialized, /fake-deepseek-key|friends-test|encrypted_key|invite_hash|LIUBAI_SECRET/);
  }
  assert.equal(admin.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls(), 0);
});

test('AES-GCM uses fresh IVs and rejects altered ciphertext or wrong master keys', async () => {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const a = await encryptKey(API_KEY, secret), b = await encryptKey(API_KEY, secret);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.encrypted_key, b.encrypted_key);
  assert.equal(await decryptKey(a, secret), API_KEY);
  const tampered = { ...a, encrypted_key: `${a.encrypted_key[0] === 'A' ? 'B' : 'A'}${a.encrypted_key.slice(1)}` };
  await assert.rejects(decryptKey(tampered, secret));
  await assert.rejects(decryptKey(a, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')));
  await assert.rejects(encryptKey(API_KEY, 'too-short'));
});

test('state-changing endpoints require exact same-origin and reject cross-site requests', async t => {
  const f = fixture(t); await f.configure();
  for (const headers of [{ Origin: 'https://evil.test' }, { Origin: '' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }]) {
    const generate = await f.call('/api/ai/generate', { method: 'POST', headers, body: input() });
    assert.equal(generate.status, 403);
    assert.equal(generate.body.reason, 'origin_rejected');
    const admin = await f.call('/api/admin/config', { method: 'DELETE', headers: { ...OWNER, ...headers } });
    assert.equal(admin.status, 403);
  }
  assert.equal(f.calls(), 0);
  assert.equal((await f.call('/api/ai/status')).body.enabled, true);
});

test('missing configuration and expired price validation block generation before any call', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/ai/generate', { method: 'POST', body: input() })).body.reason, 'not_configured');
  await f.configure();
  const expired = await f.call('/api/ai/generate', { method: 'POST', body: input(), options: { now: () => PRICE_VALID_UNTIL } });
  assert.equal(expired.body.reason, 'pricing_expired');
  assert.equal((await f.call('/api/ai/status', { options: { now: () => PRICE_VALID_UNTIL } })).body.enabled, false);
  assert.equal(f.calls(), 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
});

test('consent and configuration versions or wrong invite prevent model dispatch', async t => {
  const f = fixture(t); await f.configure();
  for (const change of [{ configVersion: 'deepseek-0' }, { consentVersion: 'old-version' }, { consentVersion: undefined }]) {
    assert.equal((await f.call('/api/ai/generate', { method: 'POST', body: input(change) })).body.reason, 'consent_changed');
  }
  for (const inviteCode of ['wrong-code', '', undefined, 'x'.repeat(65)]) {
    assert.equal((await f.call('/api/ai/generate', { method: 'POST', body: input({ inviteCode }) })).body.reason, 'invite_required');
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
});

test('oversized HTTP body and model context fail before reserving or sending', async t => {
  const f = fixture(t); await f.configure();
  const tooLarge = input(); tooLarge.session.story = '中'.repeat(10000);
  assert.notEqual((await f.call('/api/ai/generate', { method: 'POST', body: tooLarge })).status, 200);
  const promptLarge = input(); promptLarge.session.story = '中'.repeat(3500);
  assert.equal((await f.call('/api/ai/generate', { method: 'POST', body: promptLarge })).body.reason, 'input_too_large_or_invalid');
  assert.equal(f.calls(), 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
});

test('valid request returns a candidate with request identity and persists only numeric usage and hashes', async t => {
  const f = fixture(t); await f.configure();
  const result = await f.call('/api/ai/generate', { method: 'POST', body: input() });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'candidate');
  assert.deepEqual(result.body.candidate, CANDIDATE);
  assert.equal(result.body.requestId, 'request-0001');
  assert.equal(result.body.revision, 1);
  assert.equal(f.calls(), 1);
  const row = f.sqlite.prepare('SELECT * FROM pilot_requests').get();
  assert.equal(row.state, 'finished');
  assert.equal(row.outcome, 'candidate');
  assert.equal(row.prompt_tokens, 100);
  assert.match(row.digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(row), /散步|fake-deepseek|friends-test/);
  const status = (await f.call('/api/ai/status')).body;
  assert.equal(status.remainingCalls, 17);
});

test('double submission yields one provider call and changed material with the same request ID conflicts', async t => {
  const f = fixture(t); await f.configure();
  const results = await Promise.all([1, 2].map(() => f.call('/api/ai/generate', { method: 'POST', body: input() })));
  assert.equal(results.filter(r => r.body.status === 'candidate').length, 1);
  assert.equal(results.filter(r => r.body.reason === 'duplicate_request').length, 1);
  const changed = input(); changed.session.story = '不同的内容';
  assert.equal((await f.call('/api/ai/generate', { method: 'POST', body: changed })).body.reason, 'request_conflict');
  assert.equal(f.calls(), 1);
});

test('parallel requests cannot exceed two provider calls in flight', { timeout: 2000 }, async t => {
  const f = fixture(t); await f.configure();
  let calls = 0, release, denied = 0, allDenied;
  const wait = new Promise(resolve => { release = resolve; });
  const rejectedRemainder = new Promise(resolve => { allDenied = resolve; });
  const fetchImpl = async () => { calls++; await wait; return complete(); };
  const pending = Array.from({ length: 6 }, (_, i) => f.call('/api/ai/generate', { method: 'POST', body: input({ requestId: `parallel-${i}`, session: { ...input().session, id: `session-${i}` } }), options: { fetchImpl } }).then(result => {
    if (result.body.reason === 'concurrency_limit' && ++denied === 4) allDenied();
    return result;
  }));
  await rejectedRemainder;
  assert.equal(calls, 2);
  release();
  const results = await Promise.all(pending);
  assert.equal(results.filter(r => r.body.status === 'candidate').length, 2);
  assert.equal(results.filter(r => r.body.reason === 'concurrency_limit').length, 4);
});

test('provider failure still consumes a permanent budget slot and does not retry', async t => {
  const f = fixture(t); await f.configure();
  let calls = 0;
  const result = await f.call('/api/ai/generate', { method: 'POST', body: input(), options: { fetchImpl: async () => { calls++; return new Response('PRIVATE_TOKEN_ERROR', { status: 401 }); } } });
  assert.equal(result.body.status, 'fallback');
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE|TOKEN_ERROR/);
  assert.equal(calls, 1);
  assert.equal((await f.call('/api/ai/status')).body.remainingCalls, 17);
});

test('eighteen calls exhaust the persistent pilot budget across separate sessions', async t => {
  const f = fixture(t); await f.configure();
  for (let i = 0; i < 18; i++) {
    const result = await f.call('/api/ai/generate', { method: 'POST', body: input({ requestId: `budget-request-${i}`, session: { ...input().session, id: `budget-session-${i}` } }) });
    assert.equal(result.body.status, 'candidate', JSON.stringify(result));
  }
  const denied = await f.call('/api/ai/generate', { method: 'POST', body: input({ requestId: 'budget-request-19', session: { ...input().session, id: 'new-session-19' } }) });
  assert.equal(denied.body.reason, 'budget_exhausted');
  assert.equal(f.calls(), 18);
  const stats = (await f.call('/api/admin/status', { headers: OWNER })).body;
  assert.equal(stats.reservedMicros, 900000);
  assert.equal(stats.remainingCalls, 0);
});

test('deleting or replacing credentials never resets the budget ledger', async t => {
  const f = fixture(t); await f.configure();
  await f.call('/api/ai/generate', { method: 'POST', body: input() });
  assert.equal((await f.call('/api/admin/config', { method: 'DELETE', headers: OWNER })).status, 200);
  const deleted = f.sqlite.prepare("SELECT * FROM pilot_config WHERE id='main'").get();
  assert.equal(deleted.encrypted_key, null); assert.equal(deleted.iv, null); assert.equal(deleted.invite_hash, null);
  assert.equal(deleted.admin_user_id, OWNER['oai-authenticated-user-id']);
  assert.equal((await f.call('/api/ai/status')).body.remainingCalls, 17);
  await f.configure({ apiKey: 'another-fake-key-only-tests' });
  assert.equal((await f.call('/api/ai/status')).body.remainingCalls, 17);
  assert.equal(f.calls(), 1);
});

test('configuration change during an inference discards its response without refunding', async t => {
  const f = fixture(t); await f.configure();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const pending = f.call('/api/ai/generate', { method: 'POST', body: input(), options: { fetchImpl: async () => { entered(); await waiting; return complete(); } } });
  await started;
  await f.configure({ apiKey: '', inviteCode: '', enabled: false });
  release();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'config_changed');
  assert.equal((await f.call('/api/ai/status')).body.remainingCalls, 17);
});

test('usage above the per-request allowance disables the configuration', async t => {
  const f = fixture(t); await f.configure();
  const result = await f.call('/api/ai/generate', { method: 'POST', body: input(), options: { fetchImpl: async () => complete({ prompt_tokens: 100000, completion_tokens: 10, total_tokens: 100010 }) } });
  assert.equal(result.body.reason, 'config_changed');
  assert.equal(f.sqlite.prepare("SELECT enabled FROM pilot_config WHERE id='main'").get().enabled, 0);
  assert.equal((await f.call('/api/ai/status')).body.enabled, false);
  assert.equal((await f.call('/api/ai/status')).body.remainingCalls, 17);
});

test('database failure or corrupted encrypted key fails closed without calling a model', async t => {
  const f = fixture(t); await f.configure();
  f.sqlite.prepare("UPDATE pilot_config SET encrypted_key='bad-cipher' WHERE id='main'").run();
  const corrupted = await f.call('/api/ai/generate', { method: 'POST', body: input() });
  assert.equal(corrupted.status, 503);
  assert.equal(f.calls(), 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
  f.env.DB = { prepare() { throw new Error('PRIVATE_DATABASE_SECRET'); } };
  const failure = await f.call('/api/ai/generate', { method: 'POST', body: input() });
  assert.equal(failure.status, 503);
  assert.deepEqual(failure.body, { status: 'fallback', reason: 'service_unavailable' });
  assert.equal(f.calls(), 0);
});
