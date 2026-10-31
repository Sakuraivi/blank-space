import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClarityModelRequest, clarityContract } from './clarity.mjs';
import { declarativeReply, validateClarityCandidate } from '../public/clarity-contract.mjs';
import { createClaritySession, addExpression, beginClarityRequest, applyClarityReply } from '../public/clarity-state.mjs';
import { runCandidate } from './runtime.mjs';
import { publicProviders, getPersonalRoute } from './providers.mjs';
import { prepareProviderRequest } from './provider-transport.mjs';
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
test('runtime injects v2 contract, preserves source evidence, and discards stale results', async () => {
  const context = first(), route = getPersonalRoute('deepseek', 'deepseek-flash'); let active = true;
  const adapter = { profile: route.profile, generate: async request => { assert.equal(request.policyVersion, 'clarity-warm-2'); return { status: 'completed', output: c01Candidate(context) }; } };
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
