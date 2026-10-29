import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, PILOT_LIMITS } from './ledger.mjs';

const SCHEMA = `CREATE TABLE pilot_requests (
  request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, digest TEXT NOT NULL,
  config_version TEXT NOT NULL, state TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER, outcome TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER
);`;
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
