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

test('the next concern question can replace a repeat, never malformed provenance or model state', () => {
  const c = contextFor(CORE_SAMPLES.C01[0]);
  c.dialogue.push({ question: CONCERN_QUESTIONS.event, answerId: 'u1' });
  const raw = c01Candidate(c); raw.question.text = CONCERN_QUESTIONS.event;
  assert.equal(validateClarityResponse(raw, c).candidate.question.text, CONCERN_QUESTIONS.interpretation);
  for (const mutate of [v => { v.question.evidenceIds = ['fake']; }, v => { v.claims[0].status = 'candidate'; }, v => { v.claims[0].status = 'confirmed'; }]) {
    const bad = structuredClone(raw); mutate(bad); assert.equal(validateClarityResponse(bad, c).ok, false);
  }
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
