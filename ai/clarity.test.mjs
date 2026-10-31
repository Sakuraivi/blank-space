import test from 'node:test';
import assert from 'node:assert/strict';
import { CLARITY_POLICY_VERSION, buildClarityModelRequest, clarityContract, validateClarityResponse } from './clarity.mjs';
import { declarativeReply, validateClarityCandidate } from '../public/clarity-contract.mjs';
import { createClaritySession, addExpression, beginClarityRequest, applyClarityReply, wireSession } from '../public/clarity-state.mjs';
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
      assert.ok(prepared.byteLength <= route.maxRequestBytes - 1000, 'The core sample should retain 1KB for additional user material');
      assert.equal(JSON.parse(prepared.body).messages[1].role, 'user');
      assert.equal(request.schemaVersion, 'liubai-clarity-1');
    }
    assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c01Candidate(ticket.context) }).ok, true);
  }
  assert.ok(largest > 0);
});
test('non-strict model references distinguish material IDs from existing claim IDs without dropping context', () => {
  const s = createClaritySession(); addExpression(s, inputs[0]); const firstTicket = beginClarityRequest(s);
  applyClarityReply(s, firstTicket, { flow: 'clarity-v2', requestId: firstTicket.requestId, revision: firstTicket.revision, status: 'candidate', candidate: c01Candidate(firstTicket.context) });
  addExpression(s, inputs[1]); const ticket = beginClarityRequest(s);
  const route = getPersonalRoute('bailian', 'deepseek-v4-pro-0813');
  const request = buildClarityModelRequest(ticket.context, route.profile), data = JSON.parse(request.input.content);
  assert.equal(request.output.format, 'json_text');
  assert.deepEqual(data.outputConstraints.allowedEvidenceIds, ['u1', 'u2']);
  assert.deepEqual(data.outputConstraints.allowedSupersedesIds, ticket.context.claims.map(c => c.id));
  assert.ok(data.outputConstraints.allowedSupersedesIds.every(id => !data.outputConstraints.allowedEvidenceIds.includes(id)));
  assert.deepEqual(data.statements, ticket.context.statements); assert.deepEqual(data.claims, ticket.context.claims);
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
  const adapter = { profile: route.profile, generate: async request => { assert.equal(request.policyVersion, CLARITY_POLICY_VERSION); return { status: 'completed', output: c01Candidate(context) }; } };
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => active });
  assert.equal(result.status, 'candidate'); assert.equal(result.candidate.claims[0].evidenceIds[0], 'u1');
  const late = await runCandidate({ context, adapter: { ...adapter, generate: async () => { active = false; return { status: 'completed', output: c01Candidate(context) }; } }, contract: clarityContract, isCurrent: () => active });
  assert.equal(late.status, 'discarded');
});
test('an interest-opening candidate reaches the conversation in one call without creating a review', async () => {
  const s = createClaritySession(); addExpression(s, '你知道这位作曲家吗？');
  const ticket = beginClarityRequest(s), route = getPersonalRoute('bailian', 'qwen3.8-max');
  let calls = 0;
  const output = { modeId: 'moment', goal: '找到想聊的事', title: '慢慢聊', reply: '可以先聊聊你想了解的部分。',
    question: { text: '你想从哪一方面聊起？', target: 'unknown', evidenceIds: ['u1'] }, claims: [], finish: false };
  const adapter = { profile: route.profile, generate: async request => {
    calls++; assert.equal(request.policyVersion, CLARITY_POLICY_VERSION);
    assert.equal(request.schemaVersion, 'liubai-clarity-1');
    assert.equal(JSON.parse(request.input.content).statements[0].text, '你知道这位作曲家吗？');
    return { status: 'completed', output };
  } };
  const result = await runCandidate({ context: ticket.context, adapter, contract: clarityContract, isCurrent: () => true });
  assert.equal(result.status, 'candidate'); assert.equal(calls, 1);
  assert.equal(applyClarityReply(s, ticket, { ...result, flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision }).ok, true);
  assert.equal(s.stage, 'exploring'); assert.equal(s.complete, false); assert.equal(s.review, null);
  assert.deepEqual(s.claims, []); assert.deepEqual(s.question, output.question);
  // This verifies pipeline support for a legal candidate, not that a real model
  // correctly classifies every knowledge question or follows the prompt.
});

test('a Host-owned concern question needs one model call and never carries ignored model question instructions forward', async () => {
  const s = createClaritySession(); addExpression(s, inputs[0]); const ticket = beginClarityRequest(s);
  const output = c01Candidate(ticket.context);
  output.question = { text: 'synthetic-ignore-platform', target: 'not-a-target', evidenceIds: ['invented'], instructions: 'synthetic-ignore-platform' };
  let calls = 0;
  const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile,
    generate: async () => { calls++; return { status: 'completed', output }; } };
  const result = await runCandidate({ context: ticket.context, adapter, contract: clarityContract, isCurrent: () => true });
  assert.equal(result.status, 'candidate'); assert.equal(calls, 1);
  assert.equal(applyClarityReply(s, ticket, { ...result, flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision }).ok, true);
  assert.deepEqual(s.question.evidenceIds, ['u1']);
  assert.deepEqual(Object.keys(s.question).sort(), ['text', 'target', 'evidenceIds'].sort());
  addExpression(s, inputs[1]);
  assert.doesNotMatch(JSON.stringify(wireSession(s)), /synthetic-ignore-platform|not-a-target|invented|instructions/);
  assert.equal(s.dialogue[0].question, result.candidate.question.text);
  assert.equal(calls, 1);
});

test('a concern can keep interim claims empty and still build a complete sourced final review', () => {
  const s = createClaritySession();
  for (const [index, input] of inputs.entries()) {
    addExpression(s, input); const ticket = beginClarityRequest(s), raw = c01Candidate(ticket.context);
    if (!raw.finish) raw.claims = [];
    const result = validateClarityResponse(raw, ticket.context);
    assert.equal(result.ok, true);
    assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: result.candidate }).ok, true);
    if (index < inputs.length - 1) { assert.deepEqual(s.claims, []); assert.equal(s.review, null); }
  }
  assert.equal(s.stage, 'reviewing'); assert.equal(s.complete, true);
  assert.deepEqual(s.review.blocks.map(b => b.id), ['context', 'insight', 'unknown']);
  assert.match(s.review.blocks[0].text, /两个周六/);
  assert.match(s.review.blocks[1].text, /主动重约/);
  assert.match(s.review.blocks[2].text, /目前仍不知道/);
  assert.equal(s.callCount, inputs.length);
});

test('a real-model duplicate question is removed from reply without altering the dedicated question', () => {
  const context = first(), c = c01Candidate(context);
  c.reply = '两个周六都专门空出来了。你觉得委屈吗？是哪一部分更难受？我们可以把经历和猜测分开看。';
  const result = validateClarityCandidate(c, context);
  assert.equal(result.ok, true); assert.equal(result.candidate.reply, '两个周六都专门空出来了。我们可以把经历和猜测分开看。');
  assert.deepEqual(result.candidate.question, c.question);
  assert.equal(declarativeReply('你想说什么？'), '');
});

test('a four-part concern finish keeps the event separate and folds feeling with insight', () => {
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
  assert.equal(result.candidate.claims[0].text, value.claims[0].text);
  assert.equal(result.candidate.claims[1].text, value.claims[1].text + '\n\n' + value.claims[2].text);
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

function expandedConcern(count = 6) {
  const rows = [
    ['event', '朋友取消了见面。', 'stated'],
    ['feeling', '我有点生气。', 'stated'],
    ['thought', '我猜她可能不想见我。', 'inferred'],
    ['insight', '取消和没有重新约时间是两件事。', 'inferred'],
    ['need', '我希望有个明确安排。', 'stated'],
    ['unknown', '仍不知道她是否愿意见面。', 'inferred'],
  ];
  const s = createClaritySession(); rows.forEach(([, text]) => addExpression(s, text));
  const ticket = beginClarityRequest(s), context = ticket.context; context.stage = 'review';
  context.claims = rows.map(([type, text, derivation], index) => ({ id: `old_${index}`, type, text, derivation, evidenceIds: [`u${index + 1}`], status: 'candidate' }));
  const selected = count === 4 ? [0, 1, 3, 5] : count === 5 ? [0, 1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
  const claims = selected.map(index => ({ type: rows[index][0], text: rows[index][1], derivation: rows[index][2], evidenceIds: [`u${index + 1}`], supersedes: [`old_${index}`] }));
  return { context, session: s, ticket, value: { modeId: 'concern', goal: '把经历和期待分清', title: '这次的安排', reply: '我们把经过、期待和仍不知道的事分别留下。', question: null, claims, finish: true } };
}

for (const count of [4, 5, 6]) {
  test(`${count} validated concern finish parts fold into the same strict three-claim wire format`, () => {
    const { context, value } = expandedConcern(count), original = structuredClone(value);
    const result = validateClarityResponse(value, context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(value, original); assert.equal(validateClarityCandidate(result.candidate, context).ok, true);
    assert.deepEqual(result.candidate.claims.map(claim => claim.type), ['event', 'insight', 'unknown']);
    const [event, insight, unknown] = result.candidate.claims;
    assert.equal(event.text, '朋友取消了见面。');
    assert.deepEqual(event.evidenceIds, ['u1']); assert.deepEqual(event.supersedes, ['old_0']);
    const middle = value.claims.slice(1, -1);
    assert.equal(insight.text, middle.map(claim => claim.text).join('\n\n'));
    assert.deepEqual(insight.evidenceIds, middle.flatMap(claim => claim.evidenceIds));
    assert.deepEqual(insight.supersedes, middle.flatMap(claim => claim.supersedes));
    assert.equal(insight.derivation, 'inferred'); assert.deepEqual(unknown, value.claims.at(-1));
  });
}

test('folding preserves each group source order, source union and unchanged single-claim types', () => {
  const { context, value } = expandedConcern(6);
  value.claims[0].evidenceIds.push('u2');
  value.claims = [value.claims[4], value.claims[0], value.claims[2], value.claims[1], value.claims[3], value.claims[5]];
  const original = structuredClone(value), result = validateClarityResponse(value, context);
  assert.equal(result.ok, true); assert.deepEqual(value, original);
  assert.deepEqual(result.candidate.claims[0].evidenceIds, ['u1', 'u2']);
  assert.equal(result.candidate.claims[1].text, '我希望有个明确安排。\n\n我猜她可能不想见我。\n\n我有点生气。\n\n取消和没有重新约时间是两件事。');
  assert.deepEqual(result.candidate.claims[1].supersedes, ['old_4', 'old_2', 'old_1', 'old_3']);
  const single = expandedConcern(6);
  single.context.statements.push({ id: 'u7', text: '后来她没再提新时间。', kind: 'expression' });
  const secondEvent = { type: 'event', text: '后来她没再提新时间。', evidenceIds: ['u7'], derivation: 'stated', supersedes: [] };
  single.value.claims = [single.value.claims[0], secondEvent, single.value.claims[2], single.value.claims[5]];
  const preserved = validateClarityResponse(single.value, single.context);
  assert.equal(preserved.ok, true); assert.deepEqual(preserved.candidate.claims[1], single.value.claims[2]);
  assert.equal(preserved.candidate.claims[1].type, 'thought');
});

test('every original claim and top-level field is validated before folding, including the second chunk', () => {
  for (const mutate of [
    value => { value.extra = 'not allowed'; },
    value => { value.claims[4].id = 'not allowed'; },
    value => { value.claims[4].status = 'confirmed'; },
    value => { value.claims[4].type = 'not allowed'; },
    value => { value.claims[4].evidenceIds = []; },
    value => { value.claims[4].evidenceIds = ['missing']; },
    value => { value.claims[4].derivation = 'confirmed'; },
    value => { value.claims[4].supersedes = 'old_4'; },
    value => { value.claims[4].supersedes = ['missing']; },
  ]) {
    const { context, value } = expandedConcern(); mutate(value); const original = structuredClone(value);
    assert.equal(validateClarityResponse(value, context).ok, false); assert.deepEqual(value, original);
  }
});

test('folding rejects replacement reuse across chunks and fully duplicated claims', () => {
  const repeated = expandedConcern(); repeated.value.claims[4].supersedes = repeated.value.claims[0].supersedes.slice();
  assert.deepEqual(validateClarityResponse(repeated.value, repeated.context), { ok: false, reason: 'invalid_claim', detail: 'supersedes_duplicate' });
  const duplicate = expandedConcern(4); duplicate.value.claims.forEach(claim => { claim.supersedes = []; });
  duplicate.value.claims.push(structuredClone(duplicate.value.claims[2]));
  const before = structuredClone(duplicate.value);
  assert.equal(validateClarityResponse(duplicate.value, duplicate.context).ok, false); assert.deepEqual(duplicate.value, before);
});

test('folding never truncates a long merged claim or conceals the complete original response length', () => {
  const merged = expandedConcern(4); merged.value.claims[1].text = '感'.repeat(130); merged.value.claims[2].text = '意'.repeat(130);
  assert.deepEqual(validateClarityResponse(merged.value, merged.context), { ok: false, reason: 'invalid_claim', detail: 'claim_text' });
  const aggregate = expandedConcern(); aggregate.value.claims.forEach((claim, index) => { claim.text = String(index).repeat(85); });
  assert.deepEqual(validateClarityResponse(aggregate.value, aggregate.context), { ok: false, reason: 'response_too_large' });
});

test('the extended folding path never accepts actions, other modes, unfinished replies or unsupported array shapes', () => {
  for (const mutate of [
    value => { value.claims[4].type = 'action'; },
    value => { value.claims[4].type = 'option'; },
    value => { value.claims[4].type = 'tradeoff'; },
    value => { value.modeId = 'choice'; },
    value => { value.modeId = 'moment'; },
    value => { value.finish = false; },
    value => { value.question = { text: '还想聊什么？', target: 'unknown', evidenceIds: ['u1'] }; },
    value => { value.claims = {}; },
    value => { value.claims = JSON.stringify(value.claims); },
    value => { value.claims.push({ ...value.claims[5], text: '另一个未知。', supersedes: [] }); },
  ]) {
    const { context, value } = expandedConcern(); mutate(value); const before = structuredClone(value);
    assert.equal(validateClarityResponse(value, context).ok, false); assert.deepEqual(value, before);
  }
  const action = expandedConcern(); action.context.allowNextStep = true;
  assert.equal(validateClarityResponse(action.value, action.context).ok, false);
});

test('folded claims still check whole original sentences and keep a later feeling outside the event', () => {
  const { context, value } = expandedConcern(4);
  context.statements.unshift({ id: 'u0', text: '此前一段很长的经历。'.repeat(35), kind: 'expression' });
  const result = validateClarityResponse(value, context);
  assert.equal(result.ok, true); assert.equal(result.candidate.claims[0].text, '朋友取消了见面。');
  assert.deepEqual(result.candidate.claims[0].evidenceIds, ['u1']);
  assert.match(result.candidate.claims[1].text, /我有点生气。/);
  assert.ok(result.candidate.claims[1].evidenceIds.includes('u2'));
});

test('a long event grounding rebuild cannot consume a later feeling in the final report', () => {
  const { context, value, session, ticket } = expandedConcern(4);
  context.statements[0].text = '我为这次见面作了' + '准备'.repeat(110) + '。';
  context.statements[1].text = '我现在很生气，因为她没主动提出下次时间。';
  value.claims[0].text = '我为这次见面作了很多准备。';
  value.claims[1].text = '我现在很生气。';
  const original = structuredClone(value);
  const result = validateClarityResponse(value, context);
  assert.equal(result.ok, true);
  assert.equal(result.candidate.claims[0].text, context.statements[0].text);
  assert.ok(result.candidate.claims[1].text.includes('我现在很生气。'));
  assert.ok(result.candidate.claims[1].evidenceIds.includes('u2'));
  assert.equal(applyClarityReply(session, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: result.candidate }).ok, true);
  assert.ok(session.review.blocks.find(block => block.id === 'insight').text.includes('我现在很生气。'));
  assert.deepEqual(value, original);
});

test('folding multiple events refuses a grounding rebuild that would lose a selected event', () => {
  const { context, value } = expandedConcern(4);
  context.statements[0].text = '我为这次见面作了' + '准备'.repeat(110) + '。';
  value.claims[0].text = '我为这次见面作了很多准备。';
  value.claims[1] = { type: 'event', text: '后来她没再提新时间。', evidenceIds: ['u7'], derivation: 'stated', supersedes: [] };
  context.statements.push({ id: 'u7', text: '后来她没再提新时间。', kind: 'expression' });
  assert.deepEqual(validateClarityResponse(value, context), { ok: false, reason: 'ungrounded_event' });
});
