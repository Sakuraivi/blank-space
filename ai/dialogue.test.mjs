import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, aiRequestSession, aiEvidence, validateUiCandidate } from '../public/core.mjs';
import { buildContext, buildModelRequest, validateCandidate } from './contract.mjs';

const fixture = () => ({
  ...createSession('concern'),
  story: '朋友很久没有回复，我有点担心。',
  turns: [{ id: 't1', question: '这份担心里，什么最让你在意？', answer: '我担心我们不再像以前一样亲近。' }],
  feedback: [{ hypothesisText: '你可能想结束这段关系。', verdict: 'rejected', correction: '不是想结束，我很珍惜这个朋友。' }],
});
const contextFor = session => buildContext({ session, revision: 2, stage: 'reflect', questionsAsked: session.turns.length });
const output = (text, evidenceIds) => ({ reflection: { text, evidenceIds }, hypothesis: null, question: null, nextStep: null });

test('dynamic answer is evidence while its actual question remains separate context', () => {
  const session = fixture();
  const context = contextFor(session);
  assert.deepEqual(context.statements.find(s => s.id === 'u_turn_t1'), {
    id: 'u_turn_t1', text: session.turns[0].answer, kind: 'expression',
  });
  assert.deepEqual(context.dialogue, [{ question: session.turns[0].question, answerId: 'u_turn_t1', role: 'question_not_evidence' }]);
  assert.equal(context.statements.some(s => s.text === session.turns[0].question), false);
  assert.equal(validateCandidate(output('你担心关系变得疏远。', ['u_turn_t1']), context).ok, true);
  assert.equal(validateCandidate(output('问题被当成事实。', ['t1']), context).reason, 'invalid_evidence');
  assert.equal(validateCandidate(output('问题被当成事实。', ['question_t1']), context).reason, 'invalid_evidence');
});

test('rejected hypothesis is history only; explicit correction becomes user evidence', () => {
  const session = fixture();
  const context = contextFor(session);
  assert.deepEqual(context.statements.find(s => s.id === 'u_feedback_1'), {
    id: 'u_feedback_1', text: session.feedback[0].correction, kind: 'correction',
  });
  assert.deepEqual(context.candidateFeedback, [{
    hypothesisText: session.feedback[0].hypothesisText, verdict: 'rejected', correctionId: 'u_feedback_1', role: 'model_candidate_not_evidence',
  }]);
  assert.equal(context.statements.some(s => s.text === session.feedback[0].hypothesisText), false);
  assert.equal(validateCandidate(output('你明确说很珍惜这个朋友。', ['u_feedback_1']), context).ok, true);
  assert.equal(validateCandidate(output('被否认的推断不能自证。', ['hypothesis_1']), context).reason, 'invalid_evidence');
  session.feedback[0].hypothesisText = '修改后的模型文本';
  session.feedback[0].correction = '修改后的用户文字';
  assert.notEqual(context.candidateFeedback[0].hypothesisText, session.feedback[0].hypothesisText);
  assert.ok(Object.isFrozen(context.candidateFeedback[0]) && Object.isFrozen(context.dialogue[0]));
});

test('skipped and whitespace-only answers keep question history but create no evidence', () => {
  const session = fixture();
  session.turns = [
    { id: 't1', question: '第一题？', answer: '' },
    { id: 't2', question: '第二题？', answer: ' \n\t' },
    { id: 't3', question: '第三题？', answer: '我想再等一等。' },
  ];
  session.feedback = [
    { hypothesisText: '一种理解', verdict: 'rejected', correction: '' },
    { hypothesisText: '另一种理解', verdict: 'uncertain', correction: '  ' },
  ];
  const context = contextFor(session);
  assert.deepEqual(context.dialogue.map(t => t.answerId), [null, null, 'u_turn_t3']);
  assert.deepEqual(context.candidateFeedback.map(f => f.correctionId), [null, null]);
  assert.equal(context.statements.some(s => ['u_turn_t1', 'u_turn_t2', 'u_feedback_1', 'u_feedback_2'].includes(s.id)), false);
  assert.equal(context.questionsAsked, 3);
  assert.equal(validateCandidate({ ...output('你想再等等。', ['u_turn_t3']), question: { text: '再问一个？', evidenceIds: ['u_turn_t3'] } }, context).reason, 'question_not_allowed');
});

test('duplicate, excessive, malformed or oversized dynamic turns are rejected', () => {
  const base = fixture();
  const invalidTurns = [
    [base.turns[0], { ...base.turns[0] }],
    [1, 2, 3, 4].map(i => ({ id: `t${i}`, question: '问题？', answer: '回答' })),
    [{ id: 't4', question: '问题？', answer: '回答' }],
    [{ ...base.turns[0], question: '问'.repeat(121) }],
    [{ ...base.turns[0], answer: '答'.repeat(3001) }],
    [{ ...base.turns[0], extra: 'not allowed' }],
  ];
  for (const turns of invalidTurns) {
    assert.throws(() => buildContext({ session: { ...base, turns }, revision: 1, questionsAsked: Math.min(turns.length, 3) }), /invalid_turns/);
  }
});

test('feedback limits reject more than six entries and corrections over 1000 characters', () => {
  const base = fixture();
  const item = base.feedback[0];
  assert.throws(() => contextFor({ ...base, feedback: Array.from({ length: 7 }, () => ({ ...item })) }), /invalid_feedback/);
  assert.throws(() => contextFor({ ...base, feedback: [{ ...item, correction: '字'.repeat(1001) }] }), /invalid_feedback/);
  assert.throws(() => contextFor({ ...base, feedback: [{ ...item, verdict: 'confirmed' }] }), /invalid_feedback/);
  assert.throws(() => contextFor({ ...base, feedback: [{ ...item, hypothesisText: '字'.repeat(201) }] }), /invalid_feedback/);
  assert.throws(() => contextFor({ ...base, feedback: [{ ...item, extra: 'not allowed' }] }), /invalid_feedback/);
  const allowed = contextFor({ ...base, feedback: Array.from({ length: 6 }, () => ({ ...item, correction: '字'.repeat(1000) })) });
  assert.equal(allowed.candidateFeedback.length, 6);
});

test('frontend request whitelist and evidence IDs match server dialogue contract', () => {
  const session = fixture();
  session.turns.push({ id: 't2', question: '是否还想补充？', answer: '' });
  session.feedback.push({ hypothesisText: '你希望有更多联系。', verdict: 'uncertain', correction: '希望彼此轻松一点。' });
  session.review = { title: 'PRIVATE_REVIEW', sections: [] };
  session.inviteCode = 'PRIVATE_INVITE';
  session.apiKey = 'PRIVATE_KEY';
  const payload = aiRequestSession(session);
  const context = contextFor(payload);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_/);
  const browserEvidence = aiEvidence(payload);
  assert.deepEqual(Object.fromEntries(context.statements.map(s => [s.id, s.text])), browserEvidence);
  const candidate = output('你珍惜这个朋友，也希望彼此轻松一点。', ['u_feedback_1', 'u_feedback_2']);
  assert.equal(validateCandidate(candidate, context).ok, true);
  assert.deepEqual(validateUiCandidate(candidate, payload, { stage: 'reflect' }), candidate);
  const request = buildModelRequest(context, { providerId: 'fixture', modelId: 'fixture', instructionChannel: 'system', structuredOutput: false });
  const input = JSON.parse(request.input.content);
  assert.deepEqual(input.dialogue, context.dialogue);
  assert.deepEqual(input.candidateFeedback, context.candidateFeedback);
  assert.equal(request.instruction.text.includes(session.turns[0].question), false);
  assert.equal(request.instruction.text.includes(session.feedback[0].hypothesisText), false);
});
