import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, PUBLIC_CONFIG_VERSION, CONSENT_VERSION } from './api.mjs';
import { createClaritySession, addExpression, wireSession, beginClarityRequest } from '../public/clarity-state.mjs';
import { createSession } from '../public/core.mjs';
import { c01Candidate, inputs } from '../ai/fixtures/clarity-c01.mjs';
const origin = 'https://clarity.test', fakeKey = 'synthetic-test-key-not-a-secret';
const schema = readdirSync(new URL('../drizzle/', import.meta.url)).filter(n => n.endsWith('.sql')).sort().map(n => readFileSync(new URL(`../drizzle/${n}`, import.meta.url), 'utf8')).join('\n');
function fixture(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema); t.after(() => db.close()); let calls = 0, legacy = false, transform = value => value;
  const env = { DB: { prepare(sql) { let args = []; return { bind(...v) { args = v; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } }; } }, LIUBAI_DEFAULT_DEEPSEEK_KEY: fakeKey };
  const call = async body => {
    const response = await handleApi(new Request(`${origin}/api/ai/generate`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { now: () => Date.parse('2026-10-31T00:00:00Z'), fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.match(options.headers.Authorization, /Bearer/);
      const request = JSON.parse(options.body), context = JSON.parse(request.messages[1].content);
      const output = legacy ? { reflection: { text: '今天的散步很开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null } : c01Candidate(context);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(transform(output)) } }], usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } });
    } }); return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { db, env, call, calls: () => calls, legacy: () => { legacy = true; }, transform: fn => { transform = fn; } };
}
function input(overrides = {}) {
  const s = createClaritySession(); addExpression(s, inputs[0]); const t = beginClarityRequest(s);
  return { flow: 'clarity-v2', requestId: t.requestId, revision: t.revision, sourceMode: 'default', providerId: 'deepseek', modelId: 'deepseek-flash', configVersion: PUBLIC_CONFIG_VERSION, consentVersion: CONSENT_VERSION, session: wireSession(s), stage: 'reflect', allowNextStep: false, ...overrides };
}
test('v2 uses the existing transport, route binding, ledger and duplicate guard', async t => {
  const f = fixture(t), body = input(); const result = await f.call(body);
  assert.equal(result.body.status, 'candidate', JSON.stringify(result)); assert.equal(result.body.flow, 'clarity-v2');
  assert.equal(result.body.route.sourceMode, 'default'); assert.equal(result.body.revision, body.revision);
  assert.equal(f.calls(), 1); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 1);
  const duplicate = await f.call(body); assert.equal(duplicate.status, 429); assert.equal(f.calls(), 1);
  body.requestId = crypto.randomUUID(); const retry = await f.call(body); assert.equal(retry.body.status, 'candidate'); assert.equal(f.calls(), 2);
});
test('bad flow, versions, source route and full-size context fail before reservation or model use', async t => {
  const f = fixture(t); const big = input(); big.session.statements[0].text = '长'.repeat(4000);
  for (const body of [input({ flow: 'unknown' }), input({ consentVersion: 'outdated' }), input({ modelId: 'wrong-shared-model' }), input({ baseUrl: 'https://other.test' }), big]) {
    assert.notEqual((await f.call(body)).body.status, 'candidate');
  }
  assert.equal(f.calls(), 0); assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 0);
});
test('personal requests never reserve the shared monetary budget', async t => {
  const f = fixture(t), result = await f.call(input({ sourceMode: 'personal', personalApiKey: fakeKey }));
  assert.equal(result.body.status, 'candidate', JSON.stringify(result));
  const row = f.db.prepare('SELECT source_mode, reserved_micros FROM pilot_requests').get();
  assert.equal(row.source_mode, 'personal'); assert.equal(row.reserved_micros, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(fakeKey));
});
test('absence of flow still dispatches the legacy v1 contract', async t => {
  const f = fixture(t); f.legacy(); const s = createSession(); s.story = '今天散步很开心。';
  const body = input({ session: s }); delete body.flow;
  const result = await f.call(body); assert.equal(result.body.status, 'candidate', JSON.stringify(result));
  assert.equal(result.body.flow, undefined); assert.ok(result.body.candidate.reflection); assert.equal(f.calls(), 1);
  assert.equal(result.headers.get('Server-Timing'), null);
  assert.equal(result.headers.get('X-Liubai-Validation'), null);
});

test('clarity candidate and model failure expose fixed timing stages without extra calls or JSON fields', async t => {
  const f = fixture(t);
  const candidate = await f.call(input({ sourceMode: 'personal', personalApiKey: fakeKey }));
  f.transform(value => ({ ...value, claims: [{ ...value.claims[0], evidenceIds: ['invented'] }] }));
  const fallback = await f.call(input());
  f.transform(() => { throw Error('synthetic-provider-private-error'); });
  const transportFailure = await f.call(input());
  assert.equal(candidate.body.status, 'candidate');
  assert.equal(fallback.body.status, 'fallback');
  assert.equal(transportFailure.body.reason, 'provider_response_failed');
  assert.equal(candidate.headers.get('X-Liubai-Validation'), null);
  assert.equal(fallback.headers.get('X-Liubai-Validation'), 'claim_evidence');
  assert.equal(transportFailure.headers.get('X-Liubai-Validation'), null);
  assert.equal(f.calls(), 3);
  for (const result of [candidate, fallback, transportFailure]) {
    assert.match(result.headers.get('Server-Timing'), /^prepare;dur=\d+(?:\.\d)?, model;dur=\d+(?:\.\d)?, finalize;dur=\d+(?:\.\d)?, total;dur=\d+(?:\.\d)?$/);
    assert.equal(result.headers.get('Timing-Allow-Origin'), null);
    assert.equal(result.body.timings, undefined);
    assert.doesNotMatch(result.headers.get('Server-Timing'), new RegExp(fakeKey));
    assert.doesNotMatch(JSON.stringify(result.body), /synthetic-provider-private-error/);
    assert.deepEqual(Object.keys(result.body).sort(), (result.body.status === 'candidate'
      ? ['status', 'candidate', 'policyVersion', 'schemaVersion', 'requestId', 'revision', 'route', 'flow']
      : ['status', 'reason', 'candidate', 'requestId', 'revision', 'route', 'flow']).sort());
  }
});

test('a broken timing clock cannot replace a usable candidate or trigger another model request', async t => {
  t.mock.method(performance, 'now', () => { throw Error('synthetic-private-clock-error'); });
  const f = fixture(t), result = await f.call(input());
  assert.equal(result.body.status, 'candidate');
  assert.equal(result.headers.get('Server-Timing'), null);
  assert.equal(f.calls(), 1);
  assert.doesNotMatch(JSON.stringify(result.body), /synthetic-private-clock-error/);
});

test('claim validation detail reaches logs and a fixed header, with public JSON unchanged', async t => {
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const f = fixture(t), body = input();
  f.transform(value => ({ ...value, claims: [{ ...value.claims[0], privateField: 'synthetic-private-value' }] }));
  const result = await f.call(body);
  assert.equal(result.body.reason, 'invalid_claim'); assert.equal(result.body.status, 'fallback');
  assert.deepEqual(Object.keys(result.body).sort(), ['status', 'reason', 'candidate', 'requestId', 'revision', 'route', 'flow'].sort());
  assert.equal(result.body.candidate, null); assert.equal(f.calls(), 1);
  const event = logs.find(entry => entry.requestId === body.requestId);
  assert.equal(event.validationDetail, 'claim_shape');
  assert.equal(result.headers.get('X-Liubai-Validation'), 'claim_shape');
  assert.doesNotMatch(JSON.stringify([result, logs]), /synthetic-private-value|privateField/);
  assert.equal(result.body.detail, undefined); assert.equal(result.body.validationDetail, undefined);
});

test('shape diagnostic headers expose only fixed enums and are absent for success or early refusal', async t => {
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const f = fixture(t), privateValue = 'synthetic-private-value-never-in-headers';
  const variants = [
    ['shape_fields', v => ({ ...v, [privateValue]: privateValue })],
    ['shape_mode', v => ({ ...v, modeId: privateValue })],
    ['shape_goal', v => ({ ...v, goal: privateValue.repeat(3) })],
    ['shape_title', v => ({ ...v, title: privateValue.repeat(3) })],
    ['shape_reply', v => ({ ...v, reply: privateValue.repeat(12) })],
    ['shape_finish', v => ({ ...v, finish: privateValue })],
    ['shape_claims', v => ({ ...v, claims: privateValue })],
  ];
  for (const [detail, transform] of variants) {
    f.transform(transform); const body = input(), result = await f.call(body);
    assert.equal(result.body.reason, 'invalid_shape'); assert.equal(result.body.status, 'fallback');
    assert.equal(result.headers.get('X-Liubai-Validation'), detail);
    assert.deepEqual(Object.keys(result.body).sort(), ['status', 'reason', 'candidate', 'requestId', 'revision', 'route', 'flow'].sort());
    assert.equal(logs.find(entry => entry.requestId === body.requestId).validationDetail, detail);
    assert.doesNotMatch(JSON.stringify([result.body, [...result.headers], logs]), new RegExp(privateValue));
  }
  f.transform(value => value);
  const success = await f.call(input());
  assert.equal(success.body.status, 'candidate'); assert.equal(success.headers.get('X-Liubai-Validation'), null);
  const refused = await f.call(input({ flow: 'not-supported' }));
  assert.equal(refused.headers.get('X-Liubai-Validation'), null);
  assert.equal(f.calls(), variants.length + 1);
});

test('API folds four valid concern parts but never invents missing evidence', async t => {
  const f = fixture(t);
  const finished = value => ({ ...value, finish: true, question: null, claims: [
    { type: 'event', text: '最近约了两次朋友，她都在当天取消。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [] },
    { type: 'feeling', text: '现在一想到还要不要再约她，就很烦。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [] },
    { type: 'insight', text: '两次取消还不能证实对方不愿意见面。', evidenceIds: ['u1'], derivation: 'inferred', supersedes: [] },
    { type: 'unknown', text: '对方的真实想法仍未知。', evidenceIds: ['u1'], derivation: 'inferred', supersedes: [] },
  ] });
  f.transform(finished);
  const result = await f.call(input({ stage: 'review' }));
  assert.equal(result.body.status, 'candidate'); assert.deepEqual(result.body.candidate.claims.map(c => c.type), ['event', 'insight', 'unknown']);
  assert.equal(result.body.candidate.claims[0].text, '最近约了两次朋友，她都在当天取消。');
  assert.match(result.body.candidate.claims[1].text, /还要不要再约/);
  f.transform(value => { const bad = finished(value); bad.claims[3].evidenceIds = []; return bad; });
  const refused = await f.call(input({ stage: 'review' }));
  assert.notEqual(refused.body.status, 'candidate'); assert.equal(f.calls(), 2);
});

test('a changed occurrence scope uses original source excerpts without an automatic retry', async t => {
  const f = fixture(t);
  f.transform(value => ({ ...value, finish:true, question:null, claims:[
    { type:'event', text:'两次她都发了抱歉表情。', evidenceIds:['u1'], derivation:'stated', supersedes:[] },
  ] }));
  const result = await f.call(input({ stage:'review' }));
  assert.equal(result.body.status,'candidate');
  assert.equal(result.body.candidate.claims[0].text,inputs[0].replaceAll('。','。\n').trim());
  assert.equal(f.calls(),1);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(fakeKey));
});

test('clarity requests can continue past five while keeping the ledger and duplicate guard', async t => {
  const f=fixture(t), body=input({sourceMode:'personal',personalApiKey:fakeKey});
  for (let i=0;i<8;i++) {
    body.requestId=crypto.randomUUID();
    assert.equal((await f.call(body)).body.status,'candidate');
  }
  assert.equal(f.calls(),8);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,8);
  assert.equal((await f.call(body)).status,429); assert.equal(f.calls(),8);
});
