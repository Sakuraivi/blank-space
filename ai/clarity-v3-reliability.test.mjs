import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClarityCandidate } from '../public/clarity-v3-contract.mjs';
import { CLAIM_VALIDATION_DETAILS, SHAPE_VALIDATION_DETAILS, isClarityValidationDetail } from '../public/clarity-contract.mjs';
import { clarityFailureInfo } from '../public/clarity-v3-errors.mjs';

const privateValue = 'synthetic-private-value-<script>not-for-diagnostics</script>';
const requestId = '11111111-2222-4333-8444-555555555555';
const context = (extra = {}) => ({
  sessionId: 'reliability_test', revision: 1, stage: 'reflect', allowNextStep: false,
  modeId: 'auto', goal: null,
  statements: [{ id: 'u1', text: '今天原本想推进工作，结果一直在做自己的事，也没好好休息。', kind: 'expression' }],
  dialogue: [], claims: [], ...extra,
});
const candidate = (extra = {}) => ({
  modeId: 'concern', goal: '聊聊周末的安排', reply: '工作没有推进，自己的时间也没有成为休息。',
  question: null, claims: [], finish: false, title: '周末的安排', ...extra,
});
const claim = (extra = {}) => ({
  type: 'thought', text: '我原本想推进工作。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [], ...extra,
});

test('quoted questions in Chinese single or nested quotes remain statements without changing model text', () => {
  const c = context({ statements: [...context().statements,
    { id: 'u2', text: '不用追问。', kind: 'request' }] });
  for (const reply of [
    '你问‘该怎么安排？’，是在找一个能开始的点。',
    '你提到“脑中一直有个‘怎么开始？’的声音”，工作仍没开始。',
    '你写下‘我问自己“还有时间吗？”’，是在回顾当时的想法。',
    '你提到「我问『怎么开始？』」，那是你当时的疑问。',
  ]) {
    const raw = candidate({ reply }), before = structuredClone(raw);
    const result = validateClarityCandidate(raw, c);
    assert.equal(result.ok, true, reply);
    assert.deepEqual(result.candidate, raw);
    assert.deepEqual(raw, before);
    assert.equal(result.candidate.question, null);
  }
});

test('real external questions and unfinished quotation cannot bypass the dedicated question field', () => {
  for (const reply of [
    '你提到‘怎么安排？’。你最想先做什么？',
    '今天没有推进工作。下一步是什么?',
    '你提到‘怎么安排？但还没有写完。',
    '你提到“脑中一直有个‘怎么开始？’的声音。',
    '你先问了什么？后来写下‘怎么安排？’。',
  ]) {
    assert.deepEqual(validateClarityCandidate(candidate({ reply }), context()),
      { ok: false, reason: 'question_in_reply' }, reply);
  }
});

test('supporting quotes does not permit repeating an answered question or overriding a no-question preference', () => {
  const question = { text: '原本想推进的是哪件工作？', target: 'event', evidenceIds: ['u1'] };
  assert.equal(validateClarityCandidate(candidate({ question }), context()).ok, true);
  assert.deepEqual(validateClarityCandidate(candidate({ question }), context({
    dialogue: [{ question: question.text, answerId: 'u1' }],
  })), { ok: false, reason: 'repeated_question' });
  assert.deepEqual(validateClarityCandidate(candidate({ question }), context({
    statements: [...context().statements, { id: 'u2', text: '不用追问。', kind: 'request' }],
  })), { ok: false, reason: 'question_not_allowed' });
});

test('v3 shape failures report only fixed diagnostic codes, never rejected values', () => {
  const cases = [
    [candidate({ extra: privateValue }), 'shape_fields'],
    [candidate({ modeId: privateValue }), 'shape_mode'],
    [candidate({ goal: privateValue.repeat(2) }), 'shape_goal'],
    [candidate({ title: privateValue.repeat(2) }), 'shape_title'],
    [candidate({ reply: privateValue.repeat(6) }), 'shape_reply'],
    [candidate({ finish: privateValue }), 'shape_finish'],
    [candidate({ claims: privateValue }), 'shape_claims'],
  ];
  for (const [raw, detail] of cases) {
    const result = validateClarityCandidate(raw, context());
    assert.deepEqual(result, { ok: false, reason: 'invalid_shape', detail });
    assert.equal(SHAPE_VALIDATION_DETAILS.includes(result.detail), true);
    assert.equal(isClarityValidationDetail(result.reason, result.detail), true);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test('v3 claim failures distinguish source, field and replacement violations without exposing values', () => {
  const c = context({ claims: [{ id: 'c1', type: 'thought', text: '我原本想推进工作。',
    evidenceIds: ['u1'], derivation: 'stated', status: 'candidate' }] });
  const cases = [
    [[claim({ extra: privateValue })], 'claim_shape'],
    [[claim({ type: privateValue })], 'claim_type'],
    [[claim({ text: privateValue.repeat(5) })], 'claim_text'],
    [[claim({ evidenceIds: [privateValue] })], 'claim_evidence'],
    [[claim({ derivation: privateValue })], 'claim_derivation'],
    [[claim({ supersedes: privateValue })], 'supersedes_shape'],
    [[claim({ supersedes: [privateValue] })], 'supersedes_unknown'],
    [[claim({ supersedes: ['c1', 'c1'] })], 'supersedes_duplicate'],
    [[claim({ supersedes: ['c1'] }), claim({ supersedes: ['c1'] })], 'supersedes_duplicate'],
  ];
  for (const [claims, detail] of cases) {
    const raw = candidate({ claims }), before = structuredClone(raw);
    const result = validateClarityCandidate(raw, c);
    assert.deepEqual(result, { ok: false, reason: 'invalid_claim', detail });
    assert.equal(CLAIM_VALIDATION_DETAILS.includes(result.detail), true);
    assert.equal(isClarityValidationDetail(result.reason, result.detail), true);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
    assert.deepEqual(raw, before);
  }
});

test('failure presentation distinguishes response format, content checks, timeout and network connection', () => {
  const format = clarityFailureInfo('invalid_shape');
  const boundary = clarityFailureInfo('question_in_reply');
  const timeout = clarityFailureInfo('timeout');
  const network = clarityFailureInfo('network_error');
  assert.match(format.message, /回复没能完整接上/u);
  assert.match(boundary.message, /没有通过内容检查/u);
  assert.match(timeout.message, /等待太久/u);
  assert.match(network.message, /连接/u);
  assert.notEqual(format.message, boundary.message);
  assert.notEqual(timeout.message, network.message);
  for (const [reason, info] of [['invalid_shape', format], ['question_in_reply', boundary],
    ['timeout', timeout], ['network_error', network]]) {
    assert.equal(info.code, reason);
    assert.match(info.message, /文字|输入/u);
  }
});

test('problem details accept only matching fixed enums and a string UUID, never arbitrary diagnostic content', () => {
  for (const [reason, details] of [['invalid_shape', SHAPE_VALIDATION_DETAILS], ['invalid_claim', CLAIM_VALIDATION_DETAILS]]) {
    for (const validationDetail of details) {
      assert.deepEqual(clarityFailureInfo(reason, { requestId, validationDetail }), {
        code: reason, message: clarityFailureInfo(reason).message, requestId, validationDetail,
      });
    }
  }
  for (const reason of [privateValue, { value: privateValue }, [privateValue], null, undefined]) {
    const info = clarityFailureInfo(reason, { requestId: privateValue, validationDetail: privateValue });
    assert.equal(info.code, 'other');
    assert.equal(Object.hasOwn(info, 'requestId'), false);
    assert.equal(Object.hasOwn(info, 'validationDetail'), false);
    assert.equal(JSON.stringify(info).includes(privateValue), false);
  }
  for (const invalidId of [privateValue, requestId + privateValue, [requestId],
    { toString: () => requestId, value: privateValue }, null, undefined]) {
    const info = clarityFailureInfo('invalid_claim', { requestId: invalidId, validationDetail: { value: privateValue } });
    assert.equal(Object.hasOwn(info, 'requestId'), false);
    assert.equal(Object.hasOwn(info, 'validationDetail'), false);
    assert.equal(JSON.stringify(info).includes(privateValue), false);
  }
  for (const [reason, validationDetail] of [['invalid_shape', 'claim_shape'], ['invalid_claim', 'shape_fields'],
    ['timeout', 'shape_reply'], ['question_in_reply', 'claim_evidence']]) {
    assert.equal(Object.hasOwn(clarityFailureInfo(reason, { validationDetail }), 'validationDetail'), false);
  }
});
