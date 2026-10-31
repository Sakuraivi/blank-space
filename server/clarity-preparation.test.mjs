// Internal async preparation seam. Synthetic credentials and in-memory SQLite
// only; no provider, live database, or production secret is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, PUBLIC_CONFIG_VERSION, CONSENT_VERSION } from './api.mjs';
import { encryptKey } from './secrets.mjs';
import { buildClarityModelRequest, validateClarityResponse, CLARITY_POLICY_VERSION } from '../ai/clarity.mjs';
import { CLARITY_SCHEMA_VERSION } from '../public/clarity-contract.mjs';
import { runCandidate } from '../ai/runtime.mjs';
import { prepareConcernMaterialRun } from '../ai/experiments/clarity-materials.mjs';
import { createClaritySession, addExpression, wireSession, beginClarityRequest } from '../public/clarity-state.mjs';
import { createSession } from '../public/core.mjs';
import { c01Candidate, inputs } from '../ai/fixtures/clarity-c01.mjs';

const origin = 'https://preparation.test';
const fakeKey = 'synthetic-test-key-not-a-secret';
const fakeSecret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const PRIVATE_SCHEMA = 'synthetic-selection-nine-fields';
const PRIVATE_POLICY = 'synthetic-prepared-contract';
const schema = readdirSync(new URL('../drizzle/', import.meta.url)).filter(n => n.endsWith('.sql')).sort().map(n => readFileSync(new URL(`../drizzle/${n}`, import.meta.url), 'utf8')).join('\n');
const deferred = () => Promise.withResolvers();

function fixture(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema); t.after(() => db.close());
  let calls = 0, beforeFirst = async () => {}, legacy = false, providerOutput;
  const sentRequests = [];
  const env = { DB: { prepare(sql) {
    let args = [];
    return {
      bind(...v) { args = v; return this; },
      async first() { await beforeFirst(sql); return db.prepare(sql).get(...args) ?? null; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    };
  } }, LIUBAI_DEFAULT_DEEPSEEK_KEY: fakeKey };
  const call = async (body, { signal, ...options } = {}) => {
    const response = await handleApi(new Request(`${origin}/api/ai/generate`, {
      method: 'POST', signal, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), env, {
      now: () => Date.parse('2026-10-31T00:00:00Z'),
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.deepseek.com/chat/completions');
        assert.equal(options.signal.aborted, false);
        const request = JSON.parse(options.body), context = JSON.parse(request.messages[1].content);
        sentRequests.push(request);
        const output = providerOutput ? providerOutput(request) : legacy
          ? { reflection: { text: '今天的散步很开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null }
          : c01Candidate(context);
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
          usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } });
      }, ...options,
    });
    return { httpStatus: response.status, headers: response.headers, body: await response.json() };
  };
  return { db, env, call, sentRequests, calls: () => calls,
    beforeFirst: fn => { beforeFirst = fn; }, legacy: () => { legacy = true; },
    providerOutput: fn => { providerOutput = fn; } };
}

function input(overrides = {}) {
  const session = createClaritySession(); addExpression(session, inputs[0]); const ticket = beginClarityRequest(session);
  return { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, sourceMode: 'default',
    providerId: 'deepseek', modelId: 'deepseek-flash', configVersion: PUBLIC_CONFIG_VERSION, consentVersion: CONSENT_VERSION,
    session: wireSession(session), stage: 'reflect', allowNextStep: false, ...overrides };
}

// A minimal trusted injected contract, not the material implementation itself.
// It proves API ordering and delegation while the experiment tests prove the
// bound contract's private-to-public validation and lifecycle behavior.
async function prepare(context, profile) {
  const captured = structuredClone(context);
  const requestData = { ...buildClarityModelRequest(captured, profile), schemaVersion: PRIVATE_SCHEMA, policyVersion: PRIVATE_POLICY };
  const contract = {
    buildModelRequest: () => requestData,
    validateCandidate: value => validateClarityResponse(value, captured),
  };
  return { requestData, async run(options) {
    const result = await runCandidate({ ...options, context: captured, contract });
    return result.status === 'candidate' ? { ...result, schemaVersion: CLARITY_SCHEMA_VERSION } : result;
  } };
}

function assertUndispatched(f, result, reason) {
  assert.equal(result.body.status, 'fallback');
  if (reason) assert.equal(result.body.reason, reason);
  assert.equal(f.calls(), 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(fakeKey));
}

test('async preparation failure and malformed result fail before reservation or transport', async t => {
  const f = fixture(t);
  for (const prepareClarityRun of [async () => { throw Error('synthetic-private-preparation-error'); }, async () => null, async () => ({ requestData: {}, run: null })]) {
    assertUndispatched(f, await f.call(input(), { prepareClarityRun }), 'input_too_large_or_invalid');
  }
});

test('exact transport capacity is enforced on the prepared request before billing', async t => {
  const f = fixture(t);
  const result = await f.call(input(), { prepareClarityRun: async (...args) => {
    const prepared = await prepare(...args);
    prepared.requestData.input.content = JSON.stringify({ oversized: '长'.repeat(20000) });
    return prepared;
  } });
  assertUndispatched(f, result, 'input_too_large_or_invalid');
});

test('a prepared run uses the existing ledger and transport and returns public schema metadata', async t => {
  const f = fixture(t); let preparedCalls = 0;
  const result = await f.call(input(), { prepareClarityRun: async (...args) => { preparedCalls++; return prepare(...args); } });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, 'candidate');
  assert.equal(preparedCalls, 1); assert.equal(f.calls(), 1);
  assert.equal(result.body.schemaVersion, CLARITY_SCHEMA_VERSION); assert.equal(result.body.policyVersion, PRIVATE_POLICY);
  assert.equal(result.body.flow, 'clarity-v2');
  assert.equal(f.db.prepare('SELECT outcome FROM pilot_requests').get().outcome, 'candidate');
  assert.deepEqual(Object.keys(result.body).sort(), ['status', 'candidate', 'policyVersion', 'schemaVersion', 'requestId', 'revision', 'route', 'flow'].sort());
  assert.doesNotMatch(JSON.stringify(result.body), /synthetic-selection-nine-fields|snapshotId|selectionTrace/);
});

test('the real isolated material compiler crosses API, transport, runtime and ledger without leaking its private envelope', async t => {
  const f = fixture(t), body = input({ stage: 'review' });
  body.session.modeId = 'concern'; body.session.goal = '理清这次约朋友的事';
  f.providerOutput(request => {
    const data = JSON.parse(request.messages[1].content), index = data.materialIndex;
    assert.equal(data.kind, 'liubai_material_selection_user_data');
    return { version: index.selectionVersion, snapshotId: index.snapshotId, modeId: 'concern', goal: body.session.goal,
      reply: '先把已经说出的经过留下。', question: null, finish: true, title: '这次约朋友的事',
      claims: [{ type: 'event', anchorIds: [index.anchors[0].id], supersedes: [] }] };
  });
  const result = await f.call(body, { prepareClarityRun: prepareConcernMaterialRun });
  assert.equal(result.httpStatus, 200); assert.equal(result.body.status, 'candidate');
  assert.equal(result.body.policyVersion, 'clarity-material-experiment-1');
  assert.equal(result.body.schemaVersion, CLARITY_SCHEMA_VERSION);
  assert.equal(result.body.candidate.claims[0].text, '最近约了两次朋友，她都在当天取消。');
  assert.deepEqual(result.body.candidate.claims[0].evidenceIds, ['u1']);
  assert.equal(Object.keys(result.body.candidate).length, 7);
  assert.equal(Object.keys(result.body.candidate.claims[0]).length, 5);
  assert.equal(f.calls(), 1);
  assert.equal(f.db.prepare('SELECT outcome FROM pilot_requests').get().outcome, 'candidate');
  assert.doesNotMatch(JSON.stringify(result.body), /liubai-material-selection|snapshotId|anchorIds|selectionTrace/);
});

test('body and environment cannot activate preparation, and the default path keeps the original public contract', async t => {
  const f = fixture(t);
  f.env.LIUBAI_PREPARE_CLARITY_RUN = 'enabled';
  const result = await f.call(input({ prepareClarityRun: 'enabled', materialSelection: true }));
  assert.equal(result.body.status, 'candidate'); assert.equal(f.calls(), 1);
  assert.equal(result.body.policyVersion, CLARITY_POLICY_VERSION); assert.equal(result.body.schemaVersion, CLARITY_SCHEMA_VERSION);
  assert.equal(JSON.parse(f.sentRequests[0].messages[1].content).kind, 'liubai_clarity_user_data');
});

test('the prepared request is part of ledger identity and cannot replay a public request ID', async t => {
  const f = fixture(t), body = input();
  assert.equal((await f.call(body)).body.status, 'candidate');
  const differentContract = await f.call(body, { prepareClarityRun: prepare });
  assert.equal(differentContract.httpStatus, 429);
  assert.equal(differentContract.body.reason, 'request_conflict');
  assert.equal(f.calls(), 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 1);
});

test('a legacy v1 request never calls the clarity preparation hook', async t => {
  const f = fixture(t); f.legacy();
  const session = createSession(); session.story = '今天散步很开心。';
  const body = input({ session }); delete body.flow;
  const result = await f.call(body, { prepareClarityRun: () => { throw Error('unexpected_preparation'); } });
  assert.equal(result.body.status, 'candidate'); assert.ok(result.body.candidate.reflection);
  assert.equal(result.body.flow, undefined); assert.equal(f.calls(), 1);
});

test('cancellation during async preparation rejects before key use or reservation', async t => {
  const f = fixture(t), controller = new AbortController(), reached = deferred(), release = deferred();
  const pending = f.call(input(), { signal: controller.signal, prepareClarityRun: async (...args) => {
    reached.resolve(); await release.promise; return prepare(...args);
  } });
  await reached.promise; controller.abort(); release.resolve();
  assertUndispatched(f, await pending, 'inactive');
});

test('a source changed during preparation cannot reserve or dispatch', async t => {
  const f = fixture(t), reached = deferred(), release = deferred();
  const pending = f.call(input(), { prepareClarityRun: async (...args) => {
    reached.resolve(); await release.promise; return prepare(...args);
  } });
  await reached.promise;
  f.env.LIUBAI_DEFAULT_DEEPSEEK_KEY = 'synthetic-replacement-key-not-a-secret';
  release.resolve();
  assertUndispatched(f, await pending, 'config_changed');
});

test('cancellation during credential decryption rejects before reservation', async t => {
  const f = fixture(t), controller = new AbortController(), reached = deferred(), release = deferred();
  delete f.env.LIUBAI_DEFAULT_DEEPSEEK_KEY; f.env.LIUBAI_SECRET_KEY = fakeSecret;
  const encrypted = await encryptKey(fakeKey, fakeSecret);
  f.db.prepare("INSERT INTO pilot_config (id, enabled, encrypted_key, iv, revision) VALUES ('main', 1, ?, ?, 1)")
    .run(encrypted.encrypted_key, encrypted.iv);
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'decrypt', async (...args) => { reached.resolve(); await release.promise; return decrypt(...args); });
  const pending = f.call(input(), { signal: controller.signal, prepareClarityRun: prepare });
  await reached.promise; controller.abort(); release.resolve();
  assertUndispatched(f, await pending, 'inactive');
});

test('cancellation while hashing the reservation digest rejects before reservation', async t => {
  const f = fixture(t), controller = new AbortController(), reached = deferred(), release = deferred();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', async (...args) => { reached.resolve(); await release.promise; return digest(...args); });
  const pending = f.call(input(), { signal: controller.signal, prepareClarityRun: prepare });
  await reached.promise; controller.abort(); release.resolve();
  assertUndispatched(f, await pending, 'inactive');
});

test('cancellation during the final source recheck rejects before reservation', async t => {
  const f = fixture(t), controller = new AbortController(), reached = deferred(), release = deferred();
  let sourceReads = 0;
  f.beforeFirst(async sql => {
    if (sql.includes('FROM organizer_config') && ++sourceReads === 2) { reached.resolve(); await release.promise; }
  });
  const pending = f.call(input(), { signal: controller.signal, prepareClarityRun: prepare });
  await reached.promise; controller.abort(); release.resolve();
  assertUndispatched(f, await pending, 'inactive');
});
