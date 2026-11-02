import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, decodeClarityV3Json, normalizeClarityV3Candidate, safeFormatAdjustments } from './clarity-v3-format.mjs';
import { validateClarityCandidate } from '../public/clarity-v3-contract.mjs';
import { validateClarityResponse } from './clarity-v3.mjs';
import {clarityContract} from './clarity-v3.mjs';
import {runCandidate} from './runtime.mjs';
import {getPersonalRoute} from './providers.mjs';

const context = (extra = {}) => ({
  sessionId: 'format_test', revision: 1, stage: 'reflect', allowNextStep: false, modeId: 'auto', goal: null,
  statements: [{ id: 'u1', kind: 'expression', text: '今天在河边散步，觉得很放松。' }], dialogue: [], claims: [], ...extra,
});
const candidate = (extra = {}) => ({
  modeId: 'moment', goal: '留下散步的感受', reply: '沿河走走，让你觉得放松。', question: null,
  claims: [], finish: false, title: '河边的一刻', ...extra,
});
const claim = (extra = {}) => ({ type: 'feeling', text: '我觉得很放松。', evidenceIds: ['u1'], derivation: 'stated', supersedes: [], ...extra });
const normalizedCheck = (value, c = context()) => validateClarityResponse(normalizeClarityV3Candidate(value, c).candidate, c);

test('normalization diagnostics do not change a result, delay it or invite another model request',async()=>{
  for(const sink of [()=>{throw Error('private-sink-error');},()=>Promise.reject(Error('private-sink-error')),()=>new Promise(()=>{})]){
    let calls=0;const raw=candidate();delete raw.question;delete raw.claims;const before=structuredClone(raw);
    const adapter={profile:getPersonalRoute('deepseek','deepseek-flash').profile,async generate(){calls++;return{status:'completed',output:raw,formatAdjustments:['json_fence']};}};
    const result=await runCandidate({context:context(),adapter,contract:clarityContract,isCurrent:()=>true,onFormatNormalization:sink});
    assert.equal(result.status,'candidate');assert.equal(result.candidate.reply,raw.reply);assert.equal(result.candidate.question,null);
    assert.deepEqual(result.candidate.claims,[]);assert.deepEqual(raw,before);assert.equal(calls,1);
  }
});

test('v3 decodes only an entire JSON frame or external whitespace and preserves all string values', () => {
  const raw = candidate({ reply: '  原话里的空白、```json 和问号“好吗？”都保留。  ' }), json = JSON.stringify(raw);
  assert.deepEqual(decodeClarityV3Json(json), { value: raw, adjustments: [] });
  for (const [text, expected] of [
    ['\ufeff \r\n' + json + '\t\n', ['json_whitespace']],
    ['```json\n' + json + '\n```', ['json_fence']],
    ['```\r\n' + json + '\r\n```', ['json_fence']],
    [' \n```JSON\n \ufeff' + json + ' \n```\t', ['json_whitespace', 'json_fence']],
  ]) {
    const result = decodeClarityV3Json(text);
    assert.deepEqual(result.value, raw);
    assert.deepEqual(result.adjustments, expected);
    assert.equal(JSON.stringify(result.value), json);
  }
});

test('v3 does not extract an object from prose, repair JSON, or select among frames or objects', () => {
  for (const text of [
    '', '   ', '说明：{}', '{} 后面还有说明', '{}{}', '{}\n{}',
    '```json\n{}\n```\n```json\n{}\n```', '```json\n{}', '```json {} ```',
    '```javascript\n{}\n```', '```jsonc\n{}\n```', '```json\n{}\n```\n说明',
    '{"question":null,}', '{/*comment*/"question":null}', '{"reply":"未闭合}',
    '{"reply":"a\nb"}', '{"reply":"\\x20"}', 'NaN', 'undefined', '01', '+1', '[1,]',
  ]) assert.throws(() => decodeClarityV3Json(text), /invalid_json/, text);
  for (const value of [null, {}, [], 1, true]) assert.throws(() => decodeClarityV3Json(value), /invalid_json/);
});

test('duplicates are rejected in every object and escaped equivalent keys cannot choose a different value', () => {
  for (const text of [
    '{"finish":false,"finish":true}', '{"finish":false,"fin\\u0069sh":true}',
    '{"claims":[{"type":"feeling","type":"insight"}]}',
    '{"a":{"evidenceIds":["u1"],"evidenceIds":["u99"]}}',
    '```json\n{"question":null,"question":{}}\n```', '{"__proto__":{},"__proto__":{}}',
  ]) assert.throws(() => decodeClarityV3Json(text), /duplicate_json_key/);
  assert.deepEqual(decodeClarityV3Json('{"a":{"text":"x"},"b":{"text":"y"}}').value,
    { a: { text: 'x' }, b: { text: 'y' } });
});

test('complete JSON grammar and the 32-container depth bound apply inside and outside frames', () => {
  for (const value of [null, true, false, 0, -2.5, 'string', [1, null, {}], { a: '\\"\r\n\t', b: -1.2e-3 }]) {
    assert.deepEqual(decodeClarityV3Json(JSON.stringify(value)).value, value);
  }
  const bounded = '['.repeat(32) + '0' + ']'.repeat(32);
  assert.deepEqual(decodeClarityV3Json(bounded).value, JSON.parse(bounded));
  for (const text of ['['.repeat(33) + '0' + ']'.repeat(33), '```json\n' + '['.repeat(33) + '0' + ']'.repeat(33) + '\n```'])
    assert.throws(() => decodeClarityV3Json(text), /json_depth_exceeded/);
  // A primitive/array can decode but can never become a valid seven-field candidate.
  for (const value of [null, true, [], 'reply']) assert.equal(normalizedCheck(value).ok, false);
});

test('absent question is null and absent claims are empty only in ordinary reflect, without modifying raw', () => {
  const raw = candidate(); delete raw.question; delete raw.claims;
  const before = structuredClone(raw), result = normalizeClarityV3Candidate(raw, context());
  assert.deepEqual(result.adjustments, ['question_default', 'claims_default']);
  assert.equal(result.candidate.question, null); assert.deepEqual(result.candidate.claims, []);
  assert.equal(validateClarityCandidate(result.candidate, context()).ok, true);
  assert.deepEqual(raw, before);
  for (const c of [context({ stage: 'review' }), context({ allowNextStep: true })]) {
    const result = normalizeClarityV3Candidate(raw, c);
    assert.equal(Object.hasOwn(result.candidate, 'claims'), false);
    assert.equal(validateClarityCandidate(result.candidate, c).ok, false);
  }
  for (const value of [null, '', 'null', false, {}]) {
    const raw = candidate({ question: value, claims: value }), result = normalizeClarityV3Candidate(raw, context());
    assert.deepEqual(result.candidate, raw); assert.deepEqual(result.adjustments, []);
    if (value !== null) assert.equal(normalizedCheck(raw).ok, false);
  }
});

test('an absent replacement list becomes empty only when no previous claim can be replaced', () => {
  const value = claim(); delete value.supersedes;
  const raw = candidate({ claims: [value, { ...value, text: '我想留下这段感受。' }] }), before = structuredClone(raw);
  const result = normalizeClarityV3Candidate(raw, context());
  assert.deepEqual(result.adjustments, ['supersedes_default']);
  assert.ok(result.candidate.claims.every(v => Array.isArray(v.supersedes) && v.supersedes.length === 0));
  assert.equal(normalizedCheck(raw).ok, true); assert.deepEqual(raw, before);
  const { supersedes: _supersedes, ...oldClaim } = claim();
  const c = context({ claims: [{ id: 'old1', ...oldClaim, status: 'candidate' }] });
  const preserved = normalizeClarityV3Candidate(raw, c);
  assert.equal(Object.hasOwn(preserved.candidate.claims[0], 'supersedes'), false);
  assert.equal(normalizedCheck(raw, c).reason, 'invalid_claim');
  for (const explicit of [null, '', '[]', false, {}]) {
    const raw = candidate({ claims: [claim({ supersedes: explicit })] });
    assert.deepEqual(normalizeClarityV3Candidate(raw, context()).candidate, raw);
    assert.equal(normalizedCheck(raw).reason, 'invalid_claim');
  }
});

test('normalization cannot discard unknown fields, change source IDs, coerce booleans, or trim prose to fit limits', () => {
  for (const raw of [
    candidate({ extra: 'private-extra-field' }), candidate({ finish: 'false' }),
    candidate({ reply: '长'.repeat(301) }), candidate({ claims: [claim({ text: '长'.repeat(241) })] }),
    candidate({ claims: [claim({ evidenceIds: ['u99'] })] }), candidate({ claims: [claim({ evidenceIds: ['u1', 'u1'] })] }),
    candidate({ claims: [claim({ extra: true })] }),
  ]) {
    const before = structuredClone(raw), result = normalizeClarityV3Candidate(raw, context());
    assert.deepEqual(result.candidate, before); assert.deepEqual(raw, before);
    assert.equal(validateClarityCandidate(result.candidate, context()).ok, false);
  }
  const raw = candidate({ reply: '  正文两端的空白也不动。  ' });
  assert.equal(normalizeClarityV3Candidate(raw, context()).candidate.reply, raw.reply);
});

test('empty-value conventions do not relax permissions, source checks, review requirements, or lifecycle decisions', () => {
  const listen = context({ statements: [{ id: 'u1', kind: 'expression', text: '今天很累。先不用问，也不用分析。' }] });
  const unauthorized = candidate({ claims: [claim({ type: 'insight', derivation: 'inferred' })] }); delete unauthorized.question;
  assert.equal(normalizedCheck(unauthorized, listen).reason, 'interpretation_not_allowed');
  const q = candidate({ question: { text: '为什么很累？', target: 'event', evidenceIds: ['u1'] } }); delete q.claims;
  assert.equal(normalizedCheck(q, listen).reason, 'question_not_allowed');
  const finish = candidate({ finish: true }); delete finish.question; delete finish.claims;
  assert.equal(normalizedCheck(finish).reason, 'unexpected_finish');
  assert.equal(normalizedCheck(candidate({ finish: true }), context({ stage: 'review' })).reason, 'empty_review');
  const badSource = candidate({ claims: [claim({ evidenceIds: ['u99'] })] }); delete badSource.question; delete badSource.claims[0].supersedes;
  assert.equal(normalizedCheck(badSource).reason, 'invalid_claim');
  const review = context({ stage: 'review' }), event = candidate({ finish: true, claims: [claim({ type: 'event', text: '凭空编写的经历。' })] });
  delete event.question; delete event.claims[0].supersedes;
  assert.equal(normalizedCheck(event, review).reason, 'review_event_not_allowed');
});

test('format metadata accepts only a complete bounded unique enum array and never exposes supplied values', () => {
  assert.ok(Object.isFrozen(ADJUSTMENTS));
  const valid = [...ADJUSTMENTS], result = safeFormatAdjustments(valid);
  assert.deepEqual(result, valid); result.push('changed'); assert.equal(valid.length, 5);
  for (const bad of [null, {}, 'json_fence', ['private-value'], ['json_fence', 'private-value'],
    ['json_fence', 'json_fence'], [...ADJUSTMENTS, 'json_fence'], [undefined], Array(1),
    [{ toString: () => 'json_fence' }], Object.defineProperty([], 0, { get() { throw Error('private-value'); } })]) {
    assert.deepEqual(safeFormatAdjustments(bad), []);
  }
  let reads = 0;
  const changing = Object.defineProperty([], 0, { get() { return ++reads === 1 ? 'json_fence' : 'private-value'; } });
  assert.deepEqual(safeFormatAdjustments(changing), ['json_fence']);
  assert.equal(reads, 1, 'untrusted array members are read once before validation');
});
