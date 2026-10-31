import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, PILOT_LIMITS } from './ledger.mjs';

const SCHEMA = `CREATE TABLE pilot_requests (
  request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, digest TEXT NOT NULL,
  config_version TEXT NOT NULL, state TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER, outcome TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER
);`;
const MIGRATION = readFileSync(new URL('../drizzle/0001_rapid_shocker.sql', import.meta.url), 'utf8');
const route = { providerId: 'kimi', modelId: 'kimi-k3.1-pro', priceVersion: '2026-10-30-v1' };
const DIGEST = 'a'.repeat(64);
const reservation = (requestId, overrides = {}) => ({ requestId, sessionId: 'session-1', digest: DIGEST, configVersion: 'v1', now: 1000000, ...overrides });

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
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.exec(MIGRATION);
  return { sqlite, ledger: createLedger(d1(sqlite)) };
}

test('reservation is atomic under concurrent submissions and duplicates never consume twice', async () => {
  const { ledger, sqlite } = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve(reservation('same-request'))));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.filter(r => r.reason === 'duplicate_request').length, 9);
  assert.equal((await ledger.stats({ now: 1000000 })).usedCalls, 1);
  sqlite.close();
});

test('different concurrent request IDs are bounded at two active calls', async () => {
  const { ledger, sqlite } = fixture();
  const results = await Promise.all(Array.from({ length: 9 }, (_, i) => ledger.reserve(reservation(`request-${i}`, { sessionId: `session-${i}` }))));
  assert.equal(results.filter(r => r.ok).length, 2);
  assert.equal(results.filter(r => r.reason === 'concurrency_limit').length, 7);
  assert.equal((await ledger.stats({ now: 1000000 })).activeCalls, 2);
  sqlite.close();
});

test('same ID with different material, session or configuration is a conflict', async () => {
  const { ledger, sqlite } = fixture();
  await ledger.reserve(reservation('request-1'));
  for (const changes of [{ digest: 'b'.repeat(64) }, { sessionId: 'another-session' }, { configVersion: 'v2' }]) {
    assert.deepEqual(await ledger.reserve(reservation('request-1', changes)), { ok: false, reason: 'request_conflict' });
  }
  await ledger.finish('request-1', { outcome: 'candidate', now: 1000001 });
  assert.deepEqual(await ledger.reserve(reservation('request-1')), { ok: false, reason: 'duplicate_request' });
  assert.equal((await ledger.stats()).usedCalls, 1);
  sqlite.close();
});

test('session cap remains five after successes, failures, timeouts and configuration changes', async () => {
  const { ledger, sqlite } = fixture();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await ledger.reserve(reservation(`request-${i}`, { configVersion: `v${i}` })), { ok: true });
    await ledger.finish(`request-${i}`, { outcome: ['candidate', 'fallback', 'timeout', 'cancelled', 'error'][i], now: 1000001 });
  }
  assert.deepEqual(await ledger.reserve(reservation('request-6')), { ok: false, reason: 'session_limit' });
  assert.equal((await ledger.stats()).reservedMicros, 250000);
  sqlite.close();
});

test('permanent total cap remains eighteen across sessions and does not count denied attempts', async () => {
  const { ledger, sqlite } = fixture();
  for (let i = 0; i < 18; i++) {
    assert.deepEqual(await ledger.reserve(reservation(`request-${i}`, { sessionId: `session-${i}` })), { ok: true });
    await ledger.finish(`request-${i}`, { outcome: 'fallback', now: 1000001 });
  }
  assert.deepEqual(await ledger.reserve(reservation('request-19', { sessionId: 'new-session' })), { ok: false, reason: 'budget_exhausted' });
  const stats = await ledger.stats();
  assert.equal(stats.usedCalls, 18);
  assert.equal(stats.remainingCalls, 0);
  assert.equal(stats.reservedMicros, 900000);
  assert.equal(stats.currency, 'CNY');
  sqlite.close();
});

test('expired active slots permit new work without refunding occupied budget', async () => {
  const { ledger, sqlite } = fixture();
  await ledger.reserve(reservation('first'));
  await ledger.reserve(reservation('second'));
  assert.equal((await ledger.reserve(reservation('early', { now: 1119999 }))).reason, 'concurrency_limit');
  assert.deepEqual(await ledger.reserve(reservation('later', { now: 1120000 })), { ok: true });
  const stats = await ledger.stats({ now: 1120000 });
  assert.equal(stats.usedCalls, 3);
  assert.equal(stats.activeCalls, 1);
  assert.equal(stats.reservedMicros, 150000);
  sqlite.close();
});

test('finished usage is numeric-only and finish is idempotent without refunding', async () => {
  const { ledger, sqlite } = fixture();
  await ledger.reserve(reservation('first'));
  assert.deepEqual(await ledger.finish('first', { outcome: 'candidate', now: 1000001, usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50, privateText: 'DO_NOT_STORE' } }), { ok: true });
  assert.deepEqual(await ledger.finish('first', { outcome: 'error', now: 1000002, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), { ok: false });
  const row = sqlite.prepare('SELECT * FROM pilot_requests WHERE request_id = ?').get('first');
  assert.equal(row.outcome, 'candidate');
  assert.equal(row.prompt_tokens, 40);
  assert.equal(row.completion_tokens, 10);
  assert.equal(row.total_tokens, 50);
  assert.doesNotMatch(JSON.stringify(row), /DO_NOT_STORE/);
  const stats = await ledger.stats({ now: 1000002 });
  assert.equal(stats.activeCalls, 0);
  assert.equal(stats.usedCalls, 1);
  assert.equal(stats.promptTokens, 40);
  sqlite.close();
});

test('malformed usage is not persisted and unknown completion is rejected', async () => {
  const { ledger, sqlite } = fixture();
  await ledger.reserve(reservation('first'));
  await ledger.finish('first', { outcome: 'error', usage: { promptTokens: 'KEY', completionTokens: 1, totalTokens: 2 } });
  assert.equal(sqlite.prepare('SELECT prompt_tokens FROM pilot_requests').get().prompt_tokens, null);
  assert.deepEqual(await ledger.finish('missing', { outcome: 'error' }), { ok: false });
  await assert.rejects(ledger.finish('first', { outcome: 'PRIVATE_ERROR_TEXT' }), /invalid_completion/);
  sqlite.close();
});

test('invalid identifiers, digest, time and configuration cannot enter the ledger', async () => {
  const { ledger, sqlite } = fixture();
  for (const overrides of [{ requestId: '../private' }, { sessionId: '' }, { digest: 'raw private text' }, { configVersion: '' }, { now: -1 }, { now: 1.5 }]) {
    await assert.rejects(ledger.reserve(reservation('first', overrides)), /invalid_reservation/);
  }
  assert.equal((await ledger.stats()).usedCalls, 0);
  assert.throws(() => createLedger(null), /persistent_ledger_required/);
  assert.ok(Object.isFrozen(PILOT_LIMITS));
  sqlite.close();
});

test('persistent SQL ledger survives close and reopening, without resetting caps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'liubai-ledger-'));
  const path = join(dir, 'ledger.sqlite');
  let sqlite = new DatabaseSync(path);
  try {
    sqlite.exec(SCHEMA);
    sqlite.exec(MIGRATION);
    const first = createLedger(d1(sqlite));
    await first.reserve(reservation('first'));
    await first.finish('first', { outcome: 'timeout' });
    sqlite.close();
    sqlite = new DatabaseSync(path);
    const reopened = createLedger(d1(sqlite));
    assert.equal((await reopened.stats()).usedCalls, 1);
    assert.deepEqual(await reopened.reserve(reservation('first')), { ok: false, reason: 'duplicate_request' });
    assert.equal((await reopened.stats()).reservedMicros, 50000);
  } finally {
    sqlite.close();
    rmSync(path, { force: true });
    rmdirSync(dir);
  }
});

test('append-only migration preserves two legacy attempts and their shared reservation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const initial = readFileSync(new URL('../drizzle/0000_glamorous_jackal.sql', import.meta.url), 'utf8');
    sqlite.exec(initial);
    for (let i = 1; i <= 2; i++) sqlite.prepare(`INSERT INTO pilot_requests
      (request_id, session_id, digest, config_version, state, created_at_ms, outcome)
      VALUES (?, 'original-session', ?, 'public-v1', 'finished', 1000000, 'fallback')`).run(`legacy-${i}`, DIGEST);
    const before = sqlite.prepare('SELECT request_id, session_id, digest, config_version, outcome FROM pilot_requests ORDER BY request_id').all();
    sqlite.exec(MIGRATION);
    assert.deepEqual(sqlite.prepare('SELECT request_id, session_id, digest, config_version, outcome FROM pilot_requests ORDER BY request_id').all(), before);
    const rows = sqlite.prepare('SELECT source_mode, reserved_micros, provider_id, model_id, price_version FROM pilot_requests').all();
    for (const row of rows) assert.deepEqual({ ...row }, { source_mode: 'default', reserved_micros: 50000, provider_id: null, model_id: null, price_version: null });
    const stats = await createLedger(d1(sqlite)).stats();
    assert.equal(stats.usedCalls, 2);
    assert.equal(stats.remainingCalls, 16);
    assert.equal(stats.reservedMicros, 100000);
    assert.equal(stats.remainingBudgetMicros, 800000);
    assert.equal(stats.personalCalls, 0);
  } finally { sqlite.close(); }
});

test('personal attempts never consume shared calls or reservation, even beyond eighteen attempts', async () => {
  const { ledger, sqlite } = fixture();
  try {
    for (let i = 0; i < 22; i++) {
      const id = `personal-${i}`;
      assert.deepEqual(await ledger.reserve(reservation(id, { sourceMode: 'personal', sessionId: `session-${i}`, ...route })), { ok: true });
      await ledger.finish(id, { outcome: i % 2 ? 'fallback' : 'candidate', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } });
    }
    let stats = await ledger.stats();
    assert.equal(stats.usedCalls, 0);
    assert.equal(stats.remainingCalls, 18);
    assert.equal(stats.reservedMicros, 0);
    assert.equal(stats.remainingBudgetMicros, 900000);
    assert.equal(stats.personalCalls, 22);
    assert.equal(stats.promptTokens, 440);
    assert.equal(stats.personalPromptTokens, 440);
    assert.equal(stats.sharedPromptTokens, 0);
    const values = sqlite.prepare('SELECT DISTINCT reserved_micros FROM pilot_requests').all();
    assert.deepEqual(values.map(row => row.reserved_micros), [0]);
    await ledger.reserve(reservation('default-1', { sessionId: 'default-session' }));
    await ledger.finish('default-1', { outcome: 'timeout', usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 } });
    stats = await ledger.stats();
    assert.equal(stats.usedCalls, 1);
    assert.equal(stats.remainingCalls, 17);
    assert.equal(stats.reservedMicros, 50000);
    assert.equal(stats.promptTokens, 480);
    assert.equal(stats.sharedPromptTokens, 40);
    assert.equal(stats.personalPromptTokens, 440);
  } finally { sqlite.close(); }
});

test('personal source remains eligible after shared count or variable-priced budget is exhausted', async () => {
  for (const kind of ['count', 'budget']) {
    const { ledger, sqlite } = fixture();
    try {
      const attempts = kind === 'count' ? 18 : 3;
      const reservedMicros = kind === 'count' ? 50000 : 300000;
      for (let i = 0; i < attempts; i++) {
        await ledger.reserve(reservation(`default-${i}`, { sessionId: `default-session-${i}`, ...route, reservedMicros }));
        await ledger.finish(`default-${i}`, { outcome: 'fallback' });
      }
      assert.deepEqual(await ledger.reserve(reservation('over-budget', { sessionId: 'over-budget', ...route })), { ok: false, reason: 'budget_exhausted' });
      assert.deepEqual(await ledger.reserve(reservation('personal-okay', { sourceMode: 'personal', sessionId: 'personal-session', ...route })), { ok: true });
      const stats = await ledger.stats({ now: 1000000 });
      assert.equal(stats.usedCalls, attempts);
      assert.equal(stats.reservedMicros, 900000);
      assert.equal(stats.personalCalls, 1);
      assert.equal(stats.activeCalls, 1);
    } finally { sqlite.close(); }
  }
});

test('personal attempts share per-session and concurrent limits with default attempts', async () => {
  const { ledger, sqlite } = fixture();
  try {
    const first = reservation('default-first');
    const second = reservation('personal-second', { sourceMode: 'personal', sessionId: 'other-session', ...route });
    assert.deepEqual(await ledger.reserve(first), { ok: true });
    assert.deepEqual(await ledger.reserve(second), { ok: true });
    assert.deepEqual(await ledger.reserve(reservation('personal-third', { sourceMode: 'personal', sessionId: 'third-session', ...route })), { ok: false, reason: 'concurrency_limit' });
    assert.deepEqual(await ledger.reserve(reservation('default-third', { sessionId: 'third-session' })), { ok: false, reason: 'concurrency_limit' });
    await ledger.finish(first.requestId, { outcome: 'candidate' });
    await ledger.finish(second.requestId, { outcome: 'fallback' });
    for (let i = 0; i < 4; i++) {
      const id = `mixed-session-${i}`;
      await ledger.reserve(reservation(id, { sourceMode: 'personal', ...route }));
      await ledger.finish(id, { outcome: 'cancelled' });
    }
    for (const sourceMode of ['personal', 'default']) assert.deepEqual(await ledger.reserve(reservation(`session-six-${sourceMode}`, { sourceMode, ...route })), { ok: false, reason: 'session_limit' });
    assert.equal((await ledger.stats()).reservedMicros, 50000);
  } finally { sqlite.close(); }
});

test('variable-price reservations atomically enforce the shared monetary cap without refunds', async () => {
  const { ledger, sqlite } = fixture();
  try {
    await ledger.reserve(reservation('seed', { sessionId: 'seed-session', reservedMicros: 600000, ...route }));
    await ledger.finish('seed', { outcome: 'timeout' });
    const amounts = [400000, 300000, 50000];
    const results = await Promise.all(amounts.map((reservedMicros, i) => ledger.reserve(reservation(`budget-${i}`, { sessionId: `budget-session-${i}`, reservedMicros, ...route }))));
    assert.deepEqual(results, [{ ok: false, reason: 'budget_exhausted' }, { ok: true }, { ok: false, reason: 'budget_exhausted' }]);
    await ledger.finish('budget-1', { outcome: 'cancelled' });
    assert.deepEqual(await ledger.reserve(reservation('after-cancel', { sessionId: 'after-cancel' })), { ok: false, reason: 'budget_exhausted' });
    const stats = await ledger.stats();
    assert.equal(stats.reservedMicros, 900000);
    assert.equal(stats.usedCalls, 2);
    assert.equal(stats.remainingCalls, 16);
    assert.equal(stats.remainingBudgetMicros, 0);
  } finally { sqlite.close(); }
});

test('same request ID cannot change source, route, price version or reservation', async () => {
  const { ledger, sqlite } = fixture();
  try {
    const original = reservation('routed-request', { ...route, reservedMicros: 400000 });
    await ledger.reserve(original);
    assert.deepEqual(await ledger.reserve(original), { ok: false, reason: 'duplicate_request' });
    for (const changes of [
      { providerId: 'deepseek', modelId: 'deepseek-flash' }, { modelId: 'different-model' }, { priceVersion: '2026-11-01-v2' },
      { reservedMicros: 50000 }, { sourceMode: 'personal', reservedMicros: 0 },
    ]) assert.deepEqual(await ledger.reserve({ ...original, ...changes }), { ok: false, reason: 'request_conflict' });
    assert.equal((await ledger.stats()).usedCalls, 1);
    assert.equal((await ledger.stats()).reservedMicros, 400000);
  } finally { sqlite.close(); }
});

test('invalid payer or reservation metadata is rejected before writing', async () => {
  const { ledger, sqlite } = fixture();
  try {
    for (const changes of [
      { sourceMode: 'unknown' }, { sourceMode: '' }, { reservedMicros: 0 }, { reservedMicros: 49999 }, { reservedMicros: 900001 }, { reservedMicros: 50000.5 },
      { sourceMode: 'personal', reservedMicros: 50000 }, { sourceMode: 'personal', reservedMicros: -1 },
      { providerId: 'kimi' }, { modelId: 'kimi-k3.1-pro' }, { priceVersion: 'unsafe private text' }, { providerId: 'unsafe\nname', modelId: 'model' },
    ]) await assert.rejects(ledger.reserve(reservation('invalid-request', changes)), /invalid_reservation/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
  } finally { sqlite.close(); }
});

test('personal fine-tune IDs bind idempotency without granting a shared reservation', async () => {
  const { ledger, sqlite } = fixture();
  try {
    const original = reservation('personal-fine-tune', { sourceMode: 'personal', providerId: 'openai', modelId: 'ft:model:team:review-1', priceVersion: 'personal-unpriced-v1' });
    assert.deepEqual(await ledger.reserve(original), { ok: true });
    assert.deepEqual(await ledger.reserve(original), { ok: false, reason: 'duplicate_request' });
    assert.deepEqual(await ledger.reserve({ ...original, modelId: 'ft:model:team:review-2' }), { ok: false, reason: 'request_conflict' });
    const stats = await ledger.stats();
    assert.equal(stats.usedCalls, 0); assert.equal(stats.personalCalls, 1); assert.equal(stats.reservedMicros, 0);
    for (const modelId of ['https://attacker.invalid/model', 'model?private=key', 'model\nname']) await assert.rejects(ledger.reserve({ ...original, requestId: 'invalid-model-id', modelId }), /invalid_reservation/);
  } finally { sqlite.close(); }
});
