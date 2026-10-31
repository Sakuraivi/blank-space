import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { summarize, verifySnapshots } from './verify-ledger.mjs';

const snapshot = () => ({
  pilot_requests: [1, 2].map(i => ({ request_id: `synthetic-request-${i}`, session_id: `synthetic-session-${i}`, digest: 'a'.repeat(64), config_version: 'historical-synthetic', source_mode: 'default', provider_id: null, model_id: null, price_version: null, reserved_micros: 50000, state: 'finished', created_at_ms: i, finished_at_ms: i + 1, outcome: 'fallback', prompt_tokens: null, completion_tokens: null, total_tokens: null })),
  pilot_config: [{ id: 'main', encrypted_key: null, iv: null, enabled: 0, revision: 0, invite_hash: null, admin_user_id: null }],
});

test('migration verification preserves exact rows without exposing row contents', () => {
  const source = snapshot(), target = structuredClone(source);
  target.pilot_requests.reverse();
  const verified = verifySnapshots(source, target);
  assert.equal(verified.matched, true);
  assert.equal(verified.remainingCalls, 16);
  assert.equal(verified.remainingBudgetMicros, 800000);
  assert.doesNotMatch(JSON.stringify(verified), /synthetic-request|synthetic-session|encrypted_key|invite_hash/);
});

test('matching aggregate budget cannot conceal changed records or configuration', () => {
  const source = snapshot();
  for (const mutate of [target => { target.pilot_requests[0].request_id = 'different-record'; }, target => { target.pilot_requests[0].outcome = 'error'; }, target => { target.pilot_config[0].enabled = 1; }]) {
    const target = structuredClone(source); mutate(target);
    assert.throws(() => verifySnapshots(source, target), /migration_snapshot_mismatch/);
  }
});

test('an empty, duplicate or unknown-schema ledger cannot become migration-ready', () => {
  const empty = snapshot(); empty.pilot_requests = [];
  assert.throws(() => summarize(empty), /historical_shared_floor_missing/);
  const duplicate = snapshot(); duplicate.pilot_requests.push({ ...duplicate.pilot_requests[0] });
  assert.throws(() => summarize(duplicate), /row_identity_invalid/);
  const wrongSchema = snapshot(); wrongSchema.pilot_requests[0].extra = 'must-not-ignore';
  assert.throws(() => summarize(wrongSchema), /schema_mismatch/);
});

test('the CLI accepts explicit files, emits summaries only and sanitizes parse/read errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liubai-migration-test-'));
  const source = join(directory, 'source.json'), target = join(directory, 'target.json');
  const script = fileURLToPath(new URL('./verify-ledger.mjs', import.meta.url));
  const run = (...paths) => spawnSync(process.execPath, [script, ...paths], { encoding: 'utf8' });
  try {
    await writeFile(source, JSON.stringify(snapshot()));
    await writeFile(target, JSON.stringify(snapshot()));
    const success = run(source, target);
    assert.equal(success.status, 0);
    assert.equal(JSON.parse(success.stdout).matched, true);
    assert.doesNotMatch(success.stdout, /synthetic-request|synthetic-session|encrypted_key|invite_hash/);
    await writeFile(target, '{"synthetic-private-fragment": invalid}');
    const malformed = run(source, target);
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stderr.trim(), 'invalid_snapshot_json');
    assert.equal(malformed.stdout, '');
    const absent = run(source, join(directory, 'absent-private-path.json'));
    assert.equal(absent.status, 1);
    assert.equal(absent.stderr.trim(), 'snapshot_read_failed');
    assert.equal(run().status, 1);
  } finally {
    await unlink(source);
    await unlink(target);
    await rmdir(directory);
  }
});
