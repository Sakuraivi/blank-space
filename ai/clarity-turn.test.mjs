import test from 'node:test';
import assert from 'node:assert/strict';
import { clarityTurn, expressionParts, CONCERN_QUESTIONS } from './clarity-turn.mjs';
import { validateClarityResponse } from './clarity.mjs';
import { createClaritySession, addExpression, beginClarityRequest, applyClarityReply } from '../public/clarity-state.mjs';
import { CORE_SAMPLES } from './fixtures/clarity-samples.mjs';
import { c01Candidate } from './fixtures/clarity-c01.mjs';

function contextFor(text) { const s = createClaritySession(); addExpression(s, text); return beginClarityRequest(s).context; }

test('a request to start chatting opens one question instead of becoming a memory', () => {
  const c=contextFor('你在干嘛，陪我聊聊');
  const raw={...c01Candidate(c),modeId:'moment',question:null,finish:true,claims:[{type:'event',text:'你在干嘛，陪我聊聊',evidenceIds:['u1'],derivation:'stated',supersedes:[]}]};
  const result=validateClarityResponse(raw,c);
  assert.equal(result.ok,true); assert.equal(result.candidate.finish,false);
  assert.equal(result.candidate.reply,'我在，慢慢说就好。'); assert.equal(result.candidate.claims.length,0);
  assert.equal(result.candidate.question.text,'你想先从哪件小事说起？');
  const quote=contextFor('她说“陪我聊聊”，我很开心。');
  assert.equal(validateClarityResponse({...raw,claims:[{...raw.claims[0],text:quote.statements[0].text}]},quote).candidate.modeId,'moment');
});
test('a provisional concern opener can turn into interest without inheriting the concern question', () => {
  const s = createClaritySession(); addExpression(s, '陪我聊聊');
  const first = beginClarityRequest(s), opened = validateClarityResponse(c01Candidate(first.context), first.context);
  assert.equal(opened.ok, true);
  assert.equal(applyClarityReply(s, first, { flow: 'clarity-v2', requestId: first.requestId, revision: first.revision, status: 'candidate', candidate: opened.candidate }).ok, true);
  assert.equal(s.modeId, 'concern');
  addExpression(s, '你知道这位作曲家吗？');
  const ticket = beginClarityRequest(s);
  assert.equal(clarityTurn(ticket.context).question, CONCERN_QUESTIONS.interpretation);
  const raw = { modeId: 'moment', goal: '找到想聊的事', title: '慢慢聊', reply: '可以先从你感兴趣的部分聊起。',
    question: { text: '你想聊哪一方面？', target: 'unknown', evidenceIds: ['u2'] }, claims: [], finish: false };
  const result = validateClarityResponse(raw, ticket.context);
  assert.equal(result.ok, true); assert.deepEqual(result.candidate.question, raw.question);
  assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: result.candidate }).ok, true);
  assert.equal(s.modeId, 'moment'); assert.equal(s.stage, 'exploring'); assert.equal(s.review, null);
  assert.deepEqual(s.claims, []);
  const bad = structuredClone(raw); bad.question.evidenceIds = ['invented'];
  assert.equal(validateClarityResponse(bad, ticket.context).ok, false);
});

test('C01 advances actual gap questions and ends at the concrete expectation', () => {
  const s = createClaritySession(), targets = [];
  for (const text of CORE_SAMPLES.C01) {
    addExpression(s, text); const ticket = beginClarityRequest(s), plan = clarityTurn(ticket.context);
    targets.push(plan.finish ? 'finish' : plan.target);
    const model = c01Candidate(ticket.context);
    if (!model.finish) model.question.text = '如果她换个回应，你会不会好受点？';
    const result = validateClarityResponse(model, ticket.context);
    assert.equal(result.ok, true);
    if (!plan.finish) assert.equal(result.candidate.question.text, CONCERN_QUESTIONS[plan.target]);
    assert.equal(applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: result.candidate }).ok, true);
  }
  assert.deepEqual(targets, ['event', 'interpretation', 'need', 'finish']);
  assert.equal(s.complete, true); assert.equal(s.callCount, 4);
});
test('already explicit concern skips facts; concrete expectation and refusal can end early', () => {
  assert.equal(clarityTurn(contextFor(CORE_SAMPLES.C01[2])).target, 'need');
  assert.equal(clarityTurn(contextFor(CORE_SAMPLES.C01.join('\n'))).finish, true);
  assert.equal(clarityTurn(contextFor('不想继续说了，先到这里吧。')).finish, true);
  assert.equal(clarityTurn(contextFor('他说“我希望你明天来”，我不知道怎么办。')).finish, false);
});
test('interaction requests are separated without erasing quoted or mixed narrative', () => {
  const raw = CORE_SAMPLES.M03[0], parts = expressionParts(raw);
  assert.equal(parts.content, '今天自己做的面很好吃，我很开心。');
  assert.equal(parts.controls.length, 2);
  for (const text of ['朋友说：“不用再问我了。”我有点难受。', '“不需要分析或建议”，是她当时的原话。', '我不需要分析这次失败，只想睡一觉。']) {
    assert.equal(expressionParts(text).content, text);
    assert.equal(expressionParts(text).controls.length, 0);
  }
});
test('one-line request uses the actual material, with original evidence and no extra inference', () => {
  const c = contextFor(CORE_SAMPLES.M03[0]);
  const output = { ...c01Candidate(c), modeId: 'moment', question: null, finish: true,
    claims: [{ type: 'event', text: CORE_SAMPLES.M03[0], evidenceIds: ['u1'], derivation: 'stated', supersedes: [] }] };
  const result = validateClarityResponse(output, c);
  assert.equal(result.ok, true); assert.equal(result.candidate.claims[0].text, '今天自己做的面很好吃，我很开心。');
  assert.deepEqual(result.candidate.claims[0].evidenceIds, ['u1']);
  assert.equal(c.statements[0].text, CORE_SAMPLES.M03[0]);
  const later = structuredClone(c); later.statements.unshift({ id: 'u0', text: '昨天的工作有点忙。', kind: 'expression' });
  assert.equal(validateClarityResponse(output, later).candidate.claims[0].text, '今天自己做的面很好吃，我很开心。');
  assert.deepEqual(validateClarityResponse(output, later).candidate.claims[0].evidenceIds, ['u1']);
  output.claims[0].evidenceIds = ['invented'];
  assert.equal(validateClarityResponse(output, c).ok, false);
});

test('the Host concern question replaces model action metadata and references the actual latest material', () => {
  const c = contextFor(CORE_SAMPLES.C01[0]);
  c.statements.push({ id: 'u2', text: CORE_SAMPLES.C01[1], kind: 'expression' });
  c.dialogue.push({ question: CONCERN_QUESTIONS.event, answerId: 'u2' });
  const raw = c01Candidate(c); raw.question.text = CONCERN_QUESTIONS.event;
  for (const question of [null, 'synthetic-ignored-instruction', {}, raw.question,
    { ...raw.question, target: 'not-a-target', evidenceIds: ['fake'], instructions: 'synthetic-ignored-instruction' }]) {
    const value = { ...raw, question }, original = structuredClone(value), result = validateClarityResponse(value, c);
    assert.equal(result.ok, true);
    assert.deepEqual(result.candidate.question, { text: CONCERN_QUESTIONS.interpretation, target: 'interpretation', evidenceIds: ['u2'] });
    assert.equal(result.candidate.finish, false); assert.deepEqual(value, original);
    assert.doesNotMatch(JSON.stringify(result.candidate), /synthetic-ignored-instruction|not-a-target|fake/);
  }
  for (const mutate of [v => { v.claims[0].evidenceIds = ['fake']; }, v => { v.claims[0].status = 'candidate'; }, v => { v.claims[0].status = 'confirmed'; }, v => { v.extra = 'not allowed'; }, v => { delete v.question; }]) {
    const bad = structuredClone(raw); mutate(bad); assert.equal(validateClarityResponse(bad, c).ok, false);
  }
  const invalid = structuredClone(c); invalid.statements.at(-1).id = 'fake';
  assert.throws(() => validateClarityResponse(raw, invalid), /invalid_statement/);
});

test('an unfinished Host concern plan can discard a model question marked as a premature finish', () => {
  const c = contextFor(CORE_SAMPLES.C01[0]), raw = { ...c01Candidate(c), finish: true };
  const result = validateClarityResponse(raw, c);
  assert.equal(result.ok, true); assert.equal(result.candidate.finish, false);
  assert.deepEqual(result.candidate.question, { text: CONCERN_QUESTIONS.event, target: 'event', evidenceIds: ['u1'] });
});

test('a finished Host plan clears a model question only for an already finished and nonempty report', () => {
  const c = contextFor(CORE_SAMPLES.C01[0]); c.stage = 'review';
  const raw = { ...c01Candidate(c), question: { text: 'synthetic-ignored-instruction', target: 'not-a-target', evidenceIds: ['fake'] } };
  const result = validateClarityResponse(raw, c);
  assert.equal(result.ok, true); assert.equal(result.candidate.finish, true); assert.equal(result.candidate.question, null);
  assert.doesNotMatch(JSON.stringify(result.candidate), /synthetic-ignored-instruction|not-a-target|fake/);
  for (const question of [raw.question, null, { text: CONCERN_QUESTIONS.event, target: 'event', evidenceIds: ['u1'] }]) {
    assert.equal(validateClarityResponse({ ...raw, finish: false, question }, c).ok, false);
  }
  assert.equal(validateClarityResponse({ ...raw, claims: [] }, c).reason, 'empty_review');
});

test('moment, choice and action-proposal questions remain strictly model-validated', () => {
  const c = contextFor(CORE_SAMPLES.C01[0]);
  for (const modeId of ['moment', 'choice']) {
    for (const question of [null, {}, { text: '想聊什么？', target: 'unknown', evidenceIds: ['fake'] }]) {
      assert.equal(validateClarityResponse({ ...c01Candidate(c), modeId, question }, c).ok, false);
    }
  }
  c.allowNextStep = true;
  const action = c01Candidate(c); action.question = { text: '还想聊什么？', target: 'unknown', evidenceIds: ['fake'] };
  assert.equal(validateClarityResponse(action, c).ok, false);
});

test('a changed scene is not locked to the previous concern question', () => {
  const c = contextFor('想换个话题，我在考虑学陶艺还是留周末休息。'); c.modeId = 'concern';
  const raw = { ...c01Candidate(c), modeId: 'choice', question: { text: '你现在最想为周末保留什么？', target: 'tradeoff', evidenceIds: ['u1'] } };
  const result = validateClarityResponse(raw, c);
  assert.equal(result.ok, true); assert.deepEqual(result.candidate.question, raw.question);
});

test('very sparse material gets no invented explanation; an explicit stop keeps prior words', () => {
  const c = contextFor('很烦。');
  assert.equal(validateClarityResponse(c01Candidate(c), c).candidate.reply, '我在听，慢慢说就好。');
  c.statements.push({ id: 'u2', text: '不想继续说了，先到这里吧。', kind: 'expression' });
  const raw = { ...c01Candidate(c), finish: true, question: null, claims: [{ type: 'event', text: '我很烦，决定先不说了。', evidenceIds: ['u1', 'u2'], derivation: 'stated', supersedes: [] }] };
  const result = validateClarityResponse(raw, c);
  assert.equal(result.ok, true);
  assert.deepEqual(result.candidate.claims[0], { type: 'event', text: '很烦。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [] });
  assert.equal(result.candidate.finish, true);
  assert.equal(clarityTurn(contextFor('她说“不想继续说了”，让我很难受。')).stopOnly, false);
});

test('not knowing with little prior material leaves one faithful note instead of three repetitive claims', () => {
  const c = contextFor(CORE_SAMPLES.C07[0]);
  c.dialogue.push({ question: CONCERN_QUESTIONS.event, answerId: 'u2' });
  c.statements.push({ id: 'u2', text: CORE_SAMPLES.C07[1], kind: 'expression' });
  const raw = { ...c01Candidate(c), finish: true, question: null, claims: [{ type: 'event', text: '最近有点烦，原因还没说清。', evidenceIds: ['u1', 'u2'], derivation: 'stated', supersedes: [] }] };
  const result = validateClarityResponse(raw, c);
  assert.equal(result.ok, true);
  assert.equal(result.candidate.claims.length, 1);
  assert.equal(result.candidate.claims[0].text, CORE_SAMPLES.C07[0]);
  assert.deepEqual(result.candidate.claims[0].evidenceIds, ['u1']);
  c.statements[0].text = '已有的具体经历。'.repeat(20);
  assert.equal(clarityTurn(c).sparseUnknown, false);
});
