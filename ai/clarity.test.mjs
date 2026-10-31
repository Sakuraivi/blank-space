import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClarityModelRequest, clarityContract, validateClarityResponse } from './clarity.mjs';
import { declarativeReply, validateClarityCandidate } from '../public/clarity-contract.mjs';
import { createClaritySession, addExpression, beginClarityRequest, applyClarityReply } from '../public/clarity-state.mjs';
import { runCandidate } from './runtime.mjs';
import { publicProviders, getPersonalRoute } from './providers.mjs';
import { prepareProviderRequest, createProviderAdapter } from './provider-transport.mjs';
import { c01Candidate, inputs } from './fixtures/clarity-c01.mjs';
function first() { const s = createClaritySession(); addExpression(s, inputs[0]); return beginClarityRequest(s).context; }
test('wire output rejects extra fields, invented sources, unauthorized actions, and duplicate questions', () => {
  const context = first();
  for (const mutate of [v => { v.instructions = 'system'; }, v => { v.claims[0].evidenceIds = ['assistant1']; }, v => { v.claims[0].supersedes = ['missing']; }, v => { v.claims[0].type = 'action'; }, v => { v.finish = true; }, v => { v.question.target = 'diagnose'; }]) {
    const value = c01Candidate(context); mutate(value); assert.equal(validateClarityCandidate(value, context).ok, false);
  }
  context.dialogue.push({ question: c01Candidate(context).question.text, answerId: 'u1' });
  const repeat = c01Candidate(first()); assert.equal(validateClarityCandidate(repeat, context).reason, 'repeated_question');
});
test('each C01 request stays within all five trusted transport input budgets; output capacity remains a live-evaluation gate', () => {
  const s = createClaritySession(); let largest = 0;
  for (const input of inputs) {
    addExpression(s, input); const ticket = beginClarityRequest(s);
    for (const p of publicProviders()) {
      const route = getPersonalRoute(p.id, p.defaultModelId);
      const request = buildClarityModelRequest(ticket.context, route.profile);
      const prepared = prepareProviderRequest(request, route); largest = Math.max(largest, prepared.byteLength);
      assert.ok(prepared.byteLength <= route.maxRequestBytes);
      assert.equal(JSON.parse(prepared.body).messages[1].role, 'user');
      assert.equal(request.schemaVersion, 'liubai-clarity-1');
    }
    assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c01Candidate(ticket.context) }).ok, true);
  }
  assert.ok(largest > 0);
});
test('full serialized size is enforced, with no silent user-text truncation', () => {
  const context = first(); context.statements[0].text = '想'.repeat(4000);
  const route = getPersonalRoute('deepseek', 'deepseek-flash');
  assert.throws(() => prepareProviderRequest(buildClarityModelRequest(context, route.profile), route), /input_too_large/);
  assert.equal(context.statements[0].text.length, 4000);
});
test('documented Qwen Max aliases disable thinking; arbitrary model IDs stay generic', () => {
  for (const model of ['qwen3.8-max', 'qwen3.8-max-0902', 'custom-chat']) {
    const route = getPersonalRoute('bailian', model), body = JSON.parse(prepareProviderRequest(buildClarityModelRequest(first(), route.profile), route).body);
    assert.equal(body.enable_thinking, model === 'custom-chat' ? undefined : false);
    assert.equal(body.max_completion_tokens, 2000);
  }
});
test('strict output reaches only supported aliases and still enforces the request budget', () => {
  const s = createClaritySession();
  for (const input of inputs) {
    addExpression(s, input); const ticket = beginClarityRequest(s);
    for (const model of ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.8-max-future']) {
      const route = getPersonalRoute('bailian', model), request = buildClarityModelRequest(ticket.context, route.profile);
      const prepared = prepareProviderRequest(request, route), body = JSON.parse(prepared.body);
      if (model.endsWith('future')) { assert.equal(body.response_format, undefined); continue; }
      assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true);
      const schema = body.response_format.json_schema.schema, fields = schema.properties;
      assert.equal(schema.additionalProperties, false);
      assert.equal(fields.claims.maxItems, 3);
      assert.equal(fields.claims.items.properties.evidenceIds.minItems, 1);
      assert.deepEqual(fields.claims.items.properties.evidenceIds.items.enum, ticket.context.statements.map(s => s.id));
      assert.equal(fields.claims.items.properties.type.enum.includes('action'), false);
      if (ticket.context.stage === 'review') {
        assert.deepEqual(fields.question, { type: 'null' }); assert.equal(fields.finish.const, true);
      }
      assert.equal(body.max_completion_tokens, 2000); assert.equal(body.enable_thinking, false);
      const room = route.maxRequestBytes - prepared.byteLength;
      assert.throws(() => prepareProviderRequest({ ...request, input: { role: 'user', content: request.input.content + 'a'.repeat(room + 1) } }, route), /input_too_large/);
    }
    assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c01Candidate(ticket.context) }).ok, true);
  }
});
test('strict decoding never bypasses the application validator or silently retries', async () => {
  const context = first(), route = getPersonalRoute('bailian', 'qwen3.8-max'); let calls = 0;
  const value = c01Candidate(context); value.claims[0].evidenceIds = ['assistant1'];
  const adapter = createProviderAdapter({ route, apiKey: 'synthetic-test-only', fetchImpl: async (url, options) => {
    calls++; assert.equal(JSON.parse(options.body).response_format.json_schema.strict, true);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
  } });
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => true });
  assert.notEqual(result.status, 'candidate'); assert.equal(calls, 1);
});
test('runtime injects v2 contract, preserves source evidence, and discards stale results', async () => {
  const context = first(), route = getPersonalRoute('deepseek', 'deepseek-flash'); let active = true;
  const adapter = { profile: route.profile, generate: async request => { assert.equal(request.policyVersion, 'clarity-warm-13'); return { status: 'completed', output: c01Candidate(context) }; } };
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => active });
  assert.equal(result.status, 'candidate'); assert.equal(result.candidate.claims[0].evidenceIds[0], 'u1');
  const late = await runCandidate({ context, adapter: { ...adapter, generate: async () => { active = false; return { status: 'completed', output: c01Candidate(context) }; } }, contract: clarityContract, isCurrent: () => active });
  assert.equal(late.status, 'discarded');
});
test('a real-model duplicate question is removed from reply without altering the dedicated question', () => {
  const context = first(), c = c01Candidate(context);
  c.reply = '两个周六都专门空出来了。你觉得委屈吗？是哪一部分更难受？我们可以把经历和猜测分开看。';
  const result = validateClarityCandidate(c, context);
  assert.equal(result.ok, true); assert.equal(result.candidate.reply, '两个周六都专门空出来了。我们可以把经历和猜测分开看。');
  assert.deepEqual(result.candidate.question, c.question);
  assert.equal(declarativeReply('你想说什么？'), '');
});

test('a four-part concern finish folds event and feeling without losing text or provenance', () => {
  const context = first(); context.stage = 'review';
  const value = { ...c01Candidate(context), finish: true, question: null, claims: [
    { type: 'event', text: '最近约了两次朋友，她都在当天取消。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [] },
    { type: 'feeling', text: '现在一想到还要不要再约她，就很烦。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [] },
    { type: 'insight', text: '期待一个明确的安排。', evidenceIds: ['u1'], derivation: 'inferred', supersedes: [] },
    { type: 'unknown', text: '仍不知道对方的见面意愿。', evidenceIds: ['u1'], derivation: 'inferred', supersedes: [] },
  ] };
  assert.equal(validateClarityCandidate(value, context).ok, false);
  const result = validateClarityResponse(value, context);
  assert.equal(result.ok, true); assert.equal(value.claims.length, 4);
  assert.deepEqual(result.candidate.claims.map(c => c.type), ['event', 'insight', 'unknown']);
  assert.equal(result.candidate.claims[0].text, value.claims[0].text + '\n\n' + value.claims[1].text);
  assert.deepEqual(result.candidate.claims[0].evidenceIds, ['u1']);
  assert.equal(result.candidate.claims[0].derivation, 'stated');
  for (const mutate of [
    v => { v.claims[1].instructions = 'untrusted extra field'; },
    v => { v.claims[1].evidenceIds = ['assistant1']; },
    v => { v.claims[3].supersedes = ['missing']; },
    v => { v.claims[1].text = '感'.repeat(240); },
    v => { v.claims.push(structuredClone(v.claims[3])); },
  ]) { const bad = structuredClone(value); mutate(bad); assert.equal(validateClarityResponse(bad, context).ok, false); }
});
