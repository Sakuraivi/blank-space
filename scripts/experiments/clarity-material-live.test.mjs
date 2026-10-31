import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClarityContext } from '../../public/clarity-contract.mjs';
import { createProviderAdapter, MAX_RESPONSE_BYTES } from '../../ai/provider-transport.mjs';
import { syncBuiltinESMExports } from 'node:module';
import { getPersonalRoute } from '../../ai/providers.mjs';
import { MATERIAL_SELECTION_VERSION } from '../../ai/experiments/clarity-materials.mjs';
import { PUBLIC_CONFIG_VERSION, CONSENT_VERSION } from '../../server/api.mjs';
import { createMaterialEvaluationWorker } from './clarity-material-worker.mjs';
import { runMaterialLiveEvaluation } from './clarity-material-live.mjs';
import { createMaterialReviewCase, MATERIAL_LIVE_CASE_IDS, MATERIAL_LIVE_LABEL, MATERIAL_LIVE_ORIGIN, MATERIAL_LIVE_ROUTE, MATERIAL_LIVE_TTL_MS } from './clarity-material-fixtures.mjs';

const START = 1_790_000_000_000, RUN = 'synthetic_run_01';
const environment = () => ({ LIUBAI_MATERIAL_EVAL_RUN_ID: RUN, LIUBAI_MATERIAL_EVAL_STARTED_AT: String(START), LIUBAI_DATA_MIGRATION_STATE: 'verified' });
const request = (path = '/evaluate/H06_CROSS_SENTENCE', options = {}) => new Request(`${MATERIAL_LIVE_ORIGIN}${path}`, { method: 'POST', headers: { 'X-Liubai-Evaluation-Run': RUN }, ...options });
const health = (runId = RUN) => ({ label: MATERIAL_LIVE_LABEL, runId, startedAt: START, expiresAt: START + MATERIAL_LIVE_TTL_MS });
const profile = () => ({ enabled: true, defaultAvailable: true, defaultEnabled: true, configVersion: PUBLIC_CONFIG_VERSION, consentVersion: CONSENT_VERSION,
  defaultProfile: { providerId: MATERIAL_LIVE_ROUTE.providerId, modelId: MATERIAL_LIVE_ROUTE.modelId, defaultRevision: 3 } });
const route = getPersonalRoute('bailian', 'deepseek-v4-pro-0813');
const outputFor = body => {
  const input = JSON.parse(body.messages[1].content), index = input.materialIndex;
  const anchor = index.anchors.find(value => value.sourceId === (index.anchors.some(a => a.quote.includes('改成')) ? 'u2' : 'u1'));
  return { version: MATERIAL_SELECTION_VERSION, snapshotId: index.snapshotId, modeId: 'concern', goal: '核对原句、顾虑与条件',
    reply: '先把已经说清的这部分留下。', question: null, claims: [{ type: 'event', anchorIds: [anchor.id], supersedes: [] }], finish: true, title: '合成整理记录' };
};

function fakeApi({ calls = [], transportRequests = [], status = profile(), invalidTransport = false } = {}) {
  const seen = new Set();
  return async (req, env, options) => {
    const url = new URL(req.url); calls.push({ path: url.pathname, origin: url.origin, request: req });
    if (url.pathname === '/api/ai/status') return Response.json(status);
    assert.equal(req.headers.get('origin'), url.origin, 'Worker must create an internal same-origin request');
    const body = await req.json();
    const context = buildClarityContext({ session: body.session, revision: body.revision, stage: body.stage, allowNextStep: body.allowNextStep });
    const prepared = await options.prepareClarityRun(context, route.profile);
    if (seen.has(body.requestId)) return Response.json({ status: 'fallback', reason: 'duplicate_request' }, { status: 429 });
    seen.add(body.requestId);
    const adapter = createProviderAdapter({ route, apiKey: 'synthetic-only-not-a-real-key', fetchImpl: async (endpoint, init) => {
      transportRequests.push({ endpoint, body: init.body });
      if (invalidTransport) init.body += ' ';
      // The guard must never inspect headers. The fake upstream doesn't either.
      const opaque = { method: init.method, redirect: init.redirect, body: init.body, signal: init.signal };
      Object.defineProperty(opaque, 'headers', { get() { throw Error('headers_must_remain_opaque'); } });
      return options.fetchImpl(endpoint, opaque);
    } });
    const result = await prepared.run({ adapter, signal: req.signal, isCurrent: () => !req.signal.aborted, timeoutMs: 1000 });
    return Response.json({ ...result, flow: 'clarity-v2', requestId: body.requestId, revision: body.revision, route: MATERIAL_LIVE_ROUTE });
  };
}

function upstream({ requests = [], status = 200, message = 'provider_error_secret_must_not_escape' } = {}) {
  return async (endpoint, init) => {
    requests.push({ endpoint, body: init.body });
    if (status !== 200) return Response.json({ error: { message } }, { status });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputFor(JSON.parse(init.body))), reasoning_content: 'REASONING_MUST_NOT_ESCAPE' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, arbitrary: 'USAGE_SECRET_MUST_NOT_ESCAPE' } });
  };
}

test('case fixtures have deterministic identities, real statements and no fabricated dialogue', () => {
  for (const id of MATERIAL_LIVE_CASE_IDS) {
    const first = createMaterialReviewCase(id, RUN), second = createMaterialReviewCase(id, RUN);
    assert.equal(first.ticket.requestId, second.ticket.requestId);
    assert.deepEqual(first.context, second.context);
    assert.equal(first.context.stage, 'review'); assert.equal(first.context.modeId, 'concern');
    assert.equal(first.context.allowNextStep, false); assert.deepEqual(first.context.dialogue, []);
    assert.equal(first.session.pending.requestId, first.ticket.requestId);
  }
  assert.throws(() => createMaterialReviewCase('H02_CONDITION', RUN), /invalid_material_case/);
  assert.throws(() => createMaterialReviewCase(MATERIAL_LIVE_CASE_IDS[0], 'bad'), /invalid_material_case/);
});

test('worker rejects arbitrary routes, body, query, credentials, expired and unverified runs before API/model', async () => {
  let apiCalls = 0, upstreamCalls = 0;
  const worker = createMaterialEvaluationWorker({ handleApiImpl: async () => { apiCalls++; }, fetchImpl: async () => { upstreamCalls++; }, now: () => START });
  const rejected = [
    [request('/api/ai/generate'), environment(), 404], [request('/evaluate/H02_CONDITION'), environment(), 404],
    [request('/evaluate/H03_SELF_DOUBT?model=other'), environment(), 400],
    [request(undefined, { body: JSON.stringify({ personalApiKey: 'not-accepted' }) }), environment(), 400],
    [request(undefined, { headers: { Authorization: 'not-accepted' } }), environment(), 400],
    [request(undefined, { headers: { Cookie: 'not-accepted' } }), environment(), 400],
    [request(undefined, { headers: { 'X-Liubai-Evaluation-Run': 'another_run_01' } }), environment(), 409],
    [request(undefined, { headers: {} }), environment(), 409],
    [request(), { ...environment(), LIUBAI_MATERIAL_EVAL_STARTED_AT: String(START - MATERIAL_LIVE_TTL_MS) }, 410],
    [request(), { ...environment(), LIUBAI_MATERIAL_EVAL_STARTED_AT: String(START + 1) }, 410],
    [request(), { ...environment(), LIUBAI_DATA_MIGRATION_STATE: 'pending' }, 503],
  ];
  for (const [req, env, status] of rejected) assert.equal((await worker.fetch(req, env)).status, status);
  assert.equal(apiCalls, 0); assert.equal(upstreamCalls, 0);
  assert.equal((await worker.fetch(request('/health', { method: 'GET' }), {})).status, 410);
  const healthy = await worker.fetch(request('/health', { method: 'GET' }), environment());
  assert.deepEqual(await healthy.json(), health());
});

test('worker refuses wrong default model/revision before preparation or paid dispatch', async () => {
  for (const changed of [{ providerId: 'openai' }, { modelId: 'other' }, { defaultRevision: 4 }]) {
    const status = profile(); Object.assign(status.defaultProfile, changed); let preparations = 0;
    const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi({ status }), prepareRun: () => { preparations++; throw Error('unexpected'); }, fetchImpl: () => { throw Error('unexpected'); } });
    assert.equal((await worker.fetch(request(), environment())).status, 409); assert.equal(preparations, 0);
  }
});

test('exact guarded transport captures only synthetic content and numeric usage; repeated case retains ledger identity', async () => {
  const requests = [], calls = [];
  const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi({ calls }), fetchImpl: upstream({ requests }) });
  const first = await (await worker.fetch(request(), environment())).json();
  assert.equal(first.transport.dispatches, 1); assert.equal(first.api.result.status, 'candidate');
  assert.equal(first.api.result.schemaVersion, 'liubai-clarity-1');
  assert.equal(first.api.result.policyVersion, 'clarity-material-experiment-1');
  assert.deepEqual(first.transport.response.usage, { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  assert.equal(first.transport.request.model, 'deepseek-v4-pro-0813');
  assert.equal(calls[1].origin, MATERIAL_LIVE_ORIGIN); assert.equal(requests.length, 1);
  const serial = JSON.stringify(first);
  assert.doesNotMatch(serial, /REASONING_MUST|USAGE_SECRET|Authorization|synthetic-only-not-a-real-key/);
  const again = await (await worker.fetch(request(), environment())).json();
  assert.equal(again.requestId, first.requestId); assert.equal(again.api.httpStatus, 429);
  assert.equal(again.transport.dispatches, 0); assert.equal(requests.length, 1);
});

test('unexpected transport body is rejected without upstream call', async () => {
  const requests = [];
  const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi({ invalidTransport: true }), fetchImpl: upstream({ requests }) });
  const result = await (await worker.fetch(request(), environment())).json();
  assert.equal(result.transport.dispatches, 0); assert.equal(requests.length, 0); assert.equal(result.api.result.status, 'fallback');
});

test('provider error body and arbitrary exception text never enter evidence', async () => {
  const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi(), fetchImpl: upstream({ status: 403 }) });
  const result = await (await worker.fetch(request(), environment())).json();
  assert.equal(result.transport.httpStatus, 403); assert.equal(result.transport.response, null);
  assert.doesNotMatch(JSON.stringify(result), /provider_error_secret|headers|reasoning_content/);
  const crashed = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: () => { throw Error('never_export_this_secret'); } });
  assert.doesNotMatch(JSON.stringify(await (await crashed.fetch(request(), environment())).json()), /never_export/);
});

test('oversized successful clone capture does not wait for its original tee consumer', async () => {
  const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi(),
    fetchImpl: async () => new Response(' '.repeat(MAX_RESPONSE_BYTES + 1)) });
  let timer;
  try {
    const result = await Promise.race([worker.fetch(request(), environment()), new Promise(resolve => { timer = setTimeout(() => resolve('capture_deadlock'), 250); })]);
    assert.notEqual(result, 'capture_deadlock');
    const evidence = await result.json();
    assert.equal(evidence.transport.dispatches, 1); assert.equal(evidence.transport.response, null);
    assert.equal(evidence.api.result.status, 'fallback');
  } finally { clearTimeout(timer); }
});

test('client persists each attempted dispatch before fetch, calls each case once and verifies actual state save/readback', async () => {
  const snapshots = [], urls = [], requests = [];
  const worker = createMaterialEvaluationWorker({ now: () => START, handleApiImpl: fakeApi(), fetchImpl: upstream({ requests }) });
  const report = await runMaterialLiveEvaluation({ runId: RUN, now: () => START, persist: value => snapshots.push(value), fetchImpl: async (url, options) => {
    urls.push(url);
    const current = snapshots.at(-1);
    if (url.endsWith('/health')) assert.equal(current.statusRequestsDispatched, 1);
    else { assert.equal(current.caseRequestsDispatched, urls.length - 1); assert.equal(current.samples.at(-1).dispatches, 1); }
    return worker.fetch(new Request(url, options), environment());
  } });
  assert.equal(report.complete, true); assert.equal(report.mechanicalPassCount, 3); assert.equal(report.caseRequestsDispatched, 3);
  assert.equal(report.modelDispatchesObserved, 3); assert.equal(urls.length, 4); assert.equal(requests.length, 3);
  assert.equal(report.semanticReview, 'pending_manual_review');
  assert.ok(report.samples.every(sample => sample.stateVerification.ok && sample.semanticReview === 'pending_manual_review'));
  assert.ok(report.samples.every(sample => sample.evidence.context.dialogue.length === 0));
});

test('client does not retry errors or persist arbitrary proxy error bodies', async () => {
  const attempts = [], snapshots = [];
  const report = await runMaterialLiveEvaluation({ runId: RUN, now: () => START, persist: value => snapshots.push(value), fetchImpl: async url => {
    attempts.push(url); return url.endsWith('/health') ? Response.json(health()) : new Response('PROXY_SECRET_MUST_NOT_ESCAPE', { status: 403 });
  } });
  assert.equal(attempts.length, 4); assert.equal(new Set(attempts).size, 4); assert.equal(report.modelDispatchesObserved, 0);
  assert.equal(report.mechanicalPassCount, 0); assert.doesNotMatch(JSON.stringify(report), /PROXY_SECRET/);
  assert.equal(report.samples.length, 3);
});

test('client rejects an old preview run or invalid time window before any case POST', async () => {
  for (const value of [health('an_old_run_01'), { ...health(), expiresAt: START }, { ...health(), startedAt: START + 1, expiresAt: START + 1 + MATERIAL_LIVE_TTL_MS }]) {
    const attempts = [];
    const report = await runMaterialLiveEvaluation({ runId: RUN, now: () => START, persist: () => {}, fetchImpl: async (url, options) => {
      attempts.push({ url, method: options.method }); return Response.json(value);
    } });
    assert.equal(attempts.length, 1); assert.ok(attempts[0].url.endsWith('/health'));
    assert.equal(report.caseRequestsDispatched, 0); assert.equal(report.modelDispatchesObserved, 0);
    assert.equal(report.complete, false); assert.equal(report.health.failure.code, 'health_failed');
  }
});

test('client rejects arbitrary origin and stops before network if persistence fails', async () => {
  let network = 0;
  await assert.rejects(runMaterialLiveEvaluation({ runId: RUN, origin: 'https://blank.sakura.observer', persist: () => {}, fetchImpl: () => { network++; } }), /invalid_live_evaluation_options/);
  await assert.rejects(runMaterialLiveEvaluation({ runId: RUN, persist: () => { throw Error('disk_unavailable'); }, fetchImpl: () => { network++; } }), /disk_unavailable/);
  assert.equal(network, 0);
});

test('importing the CLI module neither dispatches network nor writes files', async () => {
  const fs = (await import('node:fs')).default;
  const original = globalThis.fetch, write = fs.writeFileSync, mkdir = fs.mkdirSync; let calls = 0, writes = 0;
  globalThis.fetch = () => { calls++; throw Error('no_network'); };
  fs.writeFileSync = fs.mkdirSync = () => { writes++; throw Error('no_write'); }; syncBuiltinESMExports();
  try { const imported = await import(`./clarity-material-live.mjs?inert_test=${Date.now()}`); assert.equal(typeof imported.runMaterialLiveEvaluation, 'function'); }
  finally { globalThis.fetch = original; fs.writeFileSync = write; fs.mkdirSync = mkdir; syncBuiltinESMExports(); }
  assert.equal(calls, 0); assert.equal(writes, 0);
});
