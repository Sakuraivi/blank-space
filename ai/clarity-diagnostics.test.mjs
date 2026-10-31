import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_VALIDATION_DETAILS, SHAPE_VALIDATION_DETAILS, validateClarityCandidate } from '../public/clarity-contract.mjs';
import { createClaritySession, addExpression, beginClarityRequest } from '../public/clarity-state.mjs';
import { clarityContract } from './clarity.mjs';
import { runCandidate } from './runtime.mjs';
import { getPersonalRoute } from './providers.mjs';
import { c01Candidate, inputs } from './fixtures/clarity-c01.mjs';

const privateValue = 'synthetic-private-content-never-logged';
function fixture() {
  const s = createClaritySession(); addExpression(s, inputs[0]);
  const context = beginClarityRequest(s).context;
  context.claims = [{ id: 'c_existing', type: 'thought', text: '已有的待确认理解。', evidenceIds: ['u1'], derivation: 'inferred', status: 'candidate' }];
  return { context, candidate: c01Candidate(context) };
}
const cases = [
  ['claim_shape', v => { v.claims[0][privateValue] = privateValue; }],
  ['claim_type', v => { v.claims[0].type = privateValue; }],
  ['claim_text', v => { v.claims[0].text = privateValue.repeat(12); }],
  ['claim_evidence', v => { v.claims[0].evidenceIds = [privateValue]; }],
  ['claim_derivation', v => { v.claims[0].derivation = privateValue; }],
  ['supersedes_shape', v => { v.claims[0].supersedes = privateValue; }],
  ['supersedes_unknown', v => { v.claims[0].supersedes = [privateValue]; }],
  ['supersedes_duplicate', v => { v.claims[0].supersedes = ['c_existing', 'c_existing']; }],
];
const shapes = [
  ['shape_fields', v => { v[privateValue] = privateValue; }],
  ['shape_mode', v => { v.modeId = privateValue; }],
  ['shape_goal', v => { v.goal = privateValue.repeat(3); }],
  ['shape_title', v => { v.title = privateValue.repeat(3); }],
  ['shape_reply', v => { v.reply = privateValue.repeat(12); }],
  ['shape_finish', v => { v.finish = privateValue; }],
  ['shape_claims', v => { v.claims = privateValue; }],
];

for (const [detail, mutate] of shapes) {
  test(`invalid shape retains the same rejection reason and only the fixed ${detail} detail`, () => {
    const { context, candidate } = fixture(); mutate(candidate);
    const result = validateClarityCandidate(candidate, context);
    assert.deepEqual(result, { ok: false, reason: 'invalid_shape', detail });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateValue));
  });
}

for (const [detail, mutate] of cases) {
  test(`invalid claims retain the same rejection reason and only the fixed ${detail} detail`, () => {
    const { context, candidate } = fixture(); mutate(candidate);
    const result = validateClarityCandidate(candidate, context);
    assert.deepEqual(result, { ok: false, reason: 'invalid_claim', detail });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateValue));
  });
}

test('a replacement reused across claims remains rejected without exposing the ID', () => {
  const { context, candidate } = fixture();
  candidate.claims[0].supersedes = ['c_existing'];
  candidate.claims.push(structuredClone(candidate.claims[0]));
  assert.deepEqual(validateClarityCandidate(candidate, context), { ok: false, reason: 'invalid_claim', detail: 'supersedes_duplicate' });
});

test('a validation failure notifies once with no candidate, fields, or source values', async () => {
  const { context, candidate } = fixture(); candidate.claims[0].evidenceIds = [privateValue];
  const notifications = []; let calls = 0;
  const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile, generate: async () => {
    calls++; return { status: 'completed', output: candidate };
  } };
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => true,
    onValidationFailure: (...args) => notifications.push(args) });
  assert.deepEqual(result, { status: 'fallback', reason: 'invalid_claim', candidate: null });
  assert.deepEqual(notifications, [['claim_evidence']]); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify([result, notifications]), new RegExp(privateValue));
});

test('an invalid shape notifies once using only its matching fixed enum', async () => {
  const { context, candidate } = fixture(); candidate[privateValue] = privateValue;
  const notifications = []; let calls = 0;
  const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile,
    generate: async () => { calls++; return { status: 'completed', output: candidate }; } };
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => true,
    onValidationFailure: (...args) => notifications.push(args) });
  assert.deepEqual(result, { status: 'fallback', reason: 'invalid_shape', candidate: null });
  assert.deepEqual(notifications, [['shape_fields']]); assert.equal(calls, 1);
});

test('synchronous or asynchronous diagnostic sink failure cannot change the result or retry', async () => {
  for (const onValidationFailure of [() => { throw Error(privateValue); }, () => Promise.reject(Error(privateValue))]) {
    const { context, candidate } = fixture(); candidate.claims[0].type = privateValue;
    let calls = 0;
    const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile,
      generate: async () => { calls++; return { status: 'completed', output: candidate }; } };
    const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => true, onValidationFailure });
    assert.deepEqual(result, { status: 'fallback', reason: 'invalid_claim', candidate: null });
    assert.equal(calls, 1);
  }
});

test('runtime ignores arbitrary contract detail and detail attached to other reasons', async () => {
  const { context, candidate } = fixture();
  for (const failure of [
    { ok: false, reason: 'invalid_claim', detail: privateValue },
    { ok: false, reason: 'invalid_claim', detail: { privateValue } },
    { ok: false, reason: 'invalid_shape', detail: privateValue },
    { ok: false, reason: 'invalid_shape', detail: 'claim_shape' },
    { ok: false, reason: 'invalid_claim', detail: 'shape_fields' },
    { ok: false, reason: 'invalid_evidence', detail: 'claim_evidence' },
  ]) {
    let calls = 0, notifications = 0;
    const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile,
      generate: async () => { calls++; return { status: 'completed', output: candidate }; } };
    const result = await runCandidate({ context, adapter, contract: { ...clarityContract, validateCandidate: () => failure },
      isCurrent: () => true, onValidationFailure: () => { notifications++; } });
    assert.deepEqual(result, { status: 'fallback', reason: failure.reason, candidate: null });
    assert.equal(calls, 1); assert.equal(notifications, 0);
  }
  assert.deepEqual(CLAIM_VALIDATION_DETAILS, cases.map(([detail]) => detail));
  assert.deepEqual(SHAPE_VALIDATION_DETAILS, shapes.map(([detail]) => detail));
});

test('successful validation never invokes the failure hook', async () => {
  const { context, candidate } = fixture(); let calls = 0, notifications = 0;
  const adapter = { profile: getPersonalRoute('deepseek', 'deepseek-flash').profile,
    generate: async () => { calls++; return { status: 'completed', output: candidate }; } };
  const result = await runCandidate({ context, adapter, contract: clarityContract, isCurrent: () => true,
    onValidationFailure: () => { notifications++; } });
  assert.equal(result.status, 'candidate'); assert.equal(calls, 1); assert.equal(notifications, 0);
  assert.equal(result.detail, undefined); assert.equal(result.validationDetail, undefined);
});
