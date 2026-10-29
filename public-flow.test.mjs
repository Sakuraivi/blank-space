import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, makeReview, aiEvidence, validateUiCandidate, makeAiReview, confirmedRecord, aiRequestSession, acceptsAiReply } from './public/core.mjs';

const session = () => ({ ...createSession('moment'), story: '周末散步很自在。', focus: '喜欢临时决定方向。' });
const claim = (text, evidenceIds = ['u_story']) => ({ text, evidenceIds });
const candidate = changes => ({ reflection: claim('你说散步很自在。'), hypothesis: null, question: null, nextStep: null, ...changes });

test('dynamic answers keep their actual questions and corrections in raw fallback', () => {
  const value = session();
  value.cardId = 'pause'; value.cardReflection = '想到窗边。';
  value.turns = [
    { id: 't1', question: '自由对你是什么感觉？', answer: '不用赶时间。' },
    { id: 't2', question: '还想聊什么？', answer: '' },
    { id: 't3', question: '<b>保留</b>哪一幕？', answer: '<script>只是文字</script>' },
  ];
  value.answers.moment_scene = '还有一朵花。';
  value.feedback = [{ hypothesisText: '你想独处。', verdict: 'rejected', correction: '我其实想和朋友一起自由安排。' }];
  const review = makeReview(value);
  assert.ok(review.sections.length <= 6);
  const dialogue = review.sections.find(s => s.id === 'dialogue');
  assert.match(dialogue.text, /问题：自由对你是什么感觉？\n我的回答：不用赶时间。/);
  assert.match(dialogue.text, /<script>只是文字<\/script>/);
  assert.doesNotMatch(dialogue.text, /还想聊什么/);
  assert.match(dialogue.text, /还有一朵花/);
  assert.equal(review.sections.find(s => s.id === 'corrections').text, value.feedback[0].correction);
  assert.doesNotMatch(JSON.stringify(review), /你想独处/);
});

test('evidence contains user answers and corrections, not AI questions or old summaries', () => {
  const value = session();
  value.turns = [{ id: 't1', question: 'MODEL_QUESTION', answer: 'USER_ANSWER' }, { id: 't2', question: 'EMPTY_QUESTION', answer: '' }];
  value.feedback = [
    { hypothesisText: 'MODEL_HYPOTHESIS', verdict: 'rejected', correction: '' },
    { hypothesisText: 'MODEL_HYPOTHESIS', verdict: 'uncertain', correction: 'USER_CORRECTION' },
  ];
  value.review = { title: 'OLD_SUMMARY', sections: [] };
  const evidence = aiEvidence(value);
  assert.equal(evidence.u_turn_t1, 'USER_ANSWER');
  assert.equal(evidence.u_feedback_2, 'USER_CORRECTION');
  assert.equal(evidence.u_turn_t2, undefined);
  assert.equal(evidence.u_feedback_1, undefined);
  assert.doesNotMatch(JSON.stringify(evidence), /MODEL_|OLD_SUMMARY/);
});

test('display validation rejects control fields, unknown evidence, excess questions and actions', () => {
  const value = session();
  const check = (c, options = { stage: 'reflect' }) => validateUiCandidate(c, value, options);
  assert.ok(check(candidate({ question: claim('哪一刻最自在？') })));
  assert.equal(check({ ...candidate(), confirmed: true }), null);
  assert.equal(check(candidate({ reflection: claim('推断', ['card_pause']) })), null);
  assert.equal(check(candidate({ reflection: claim('推断', ['u_story', 'u_story']) })), null);
  assert.equal(check(candidate({ reflection: claim('字'.repeat(321)) })), null);
  assert.equal(check(candidate({ question: claim('继续？') }), { stage: 'review' }), null);
  assert.equal(check(candidate({ nextStep: claim('明天再散步。') }), { stage: 'review' }), null);
  assert.ok(check(candidate({ nextStep: claim('如果愿意，明天再散步。') }), { stage: 'review', allowNextStep: true }));
  value.turns = [1, 2, 3].map(i => ({ id: `t${i}`, question: '问题', answer: '回答' }));
  assert.equal(check(candidate({ question: claim('再问一个？') })), null);
});

test('AI draft excludes rejected hypothesis and all-null result falls back to original words', () => {
  const value = session();
  value.feedback = [{ hypothesisText: '你喜欢独处。', verdict: 'rejected', correction: '其实喜欢和朋友在一起。' }];
  const draft = makeAiReview(value, candidate({ hypothesis: claim('你喜欢独处。'), nextStep: claim('可以再安排一次散步。') }));
  assert.equal(draft.sections.length, 2);
  assert.doesNotMatch(JSON.stringify(draft), /你喜欢独处/);
  const uncertain = makeAiReview(value, candidate({ hypothesis: claim('你可能喜欢安排上有余地。') }));
  assert.ok(uncertain.sections.some(s => s.label.endsWith('（还不确定）')));
  assert.deepEqual(makeAiReview(value, { reflection: null, hypothesis: null, question: null, nextStep: null }), makeReview(value));
});

test('confirmed persistence strips original turns, feedback, credentials and unconfirmed state', () => {
  const value = session();
  value.turns = [{ id: 't1', question: 'PRIVATE_QUESTION', answer: 'PRIVATE_ANSWER' }];
  value.feedback = [{ hypothesisText: 'PRIVATE_HYPOTHESIS', verdict: 'rejected', correction: 'PRIVATE_CORRECTION' }];
  value.inviteCode = 'PRIVATE_INVITE'; value.apiKey = 'PRIVATE_KEY';
  value.review = { title: '我确认的记录', sections: [{ id: 'ai_reflection', label: '我的整理', text: '只留下这句话。', source: '我确认的内容' }] };
  assert.equal(confirmedRecord(value), null);
  value.confirmed = true;
  const record = confirmedRecord(value);
  assert.ok(record);
  assert.equal(record.story, '');
  assert.deepEqual(record.answers, {});
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE_|周末散步/);
  assert.equal(Object.hasOwn(record, 'turns'), false);
  assert.equal(Object.hasOwn(record, 'feedback'), false);
  assert.equal(record.review.sections[0].text, '只留下这句话。');
});

test('request session whitelists dynamic data and excludes edited review and keys', () => {
  const value = session();
  value.turns = [{ id: 't1', question: '问题', answer: '回答', unexpected: 'PRIVATE_EXTRA' }];
  value.feedback = [{ hypothesisText: '候选', verdict: 'rejected', correction: '纠正', unexpected: 'PRIVATE_EXTRA' }];
  value.answers.unexpected = 'PRIVATE_ANSWER';
  value.apiKey = 'PRIVATE_KEY'; value.inviteCode = 'PRIVATE_INVITE';
  value.review = { title: 'PRIVATE_REVIEW', sections: [] }; value.confirmed = true;
  const payload = aiRequestSession(value);
  assert.deepEqual(payload.turns, [{ id: 't1', question: '问题', answer: '回答' }]);
  assert.equal(payload.review, null); assert.equal(payload.confirmed, false);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_/);
  payload.turns[0].answer = 'changed';
  assert.equal(value.turns[0].answer, '回答');
});

test('only current session, request and revision may accept an AI response', () => {
  const expected = { sessionId: 's1', requestId: 'r1', revision: 3 };
  const reply = { requestId: 'r1', revision: 3 };
  const current = { active: true, ...expected };
  assert.equal(acceptsAiReply(reply, expected, current), true);
  for (const change of [{ active: false }, { sessionId: 's2' }, { requestId: 'r2' }, { revision: 4 }]) assert.equal(acceptsAiReply(reply, expected, { ...current, ...change }), false);
  assert.equal(acceptsAiReply({ ...reply, requestId: 'r2' }, expected, current), false);
  assert.equal(acceptsAiReply({ ...reply, revision: 2 }, expected, current), false);
});
