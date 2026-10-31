import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAiResult } from './diagnostics.mjs';
import { CLAIM_VALIDATION_DETAILS } from '../public/clarity-contract.mjs';

test('operational result logs expose only bounded metadata, never supplied prose or credentials', () => {
  const logs = [];
  const secret = 'fake-secret-not-for-logs';
  recordAiResult({ requestId: secret, stage: secret, status: secret, reason: secret, personalApiKey: secret, story: secret }, line => logs.push(line));
  assert.deepEqual(JSON.parse(logs[0]), { event: 'liubai_ai_result', requestId: 'unavailable', stage: 'other', status: 'other', reason: 'other' });
  assert.ok(!logs[0].includes(secret));
  recordAiResult({ requestId: 'e16f2585-d17f-43eb-b121-07e1ce18c5ed', stage: 'reflect', status: 'fallback', reason: 'provider_response_failed' }, line => logs.push(line));
  assert.equal(JSON.parse(logs[1]).reason, 'provider_response_failed');
  for (const reason of ['ungrounded_event', 'correction_not_applied']) {
    recordAiResult({ status:'fallback', stage:'review', reason }, line => logs.push(line));
    assert.equal(JSON.parse(logs.at(-1)).reason,reason);
  }
});

test('diagnostic sink failure never replaces an otherwise usable result', () => {
  assert.doesNotThrow(() => recordAiResult({ status: 'candidate', stage: 'review' }, () => { throw Error('sink unavailable'); }));
});

test('claim validation diagnostics accept only fixed codes for the matching failure', () => {
  const logs = [], write = line => logs.push(JSON.parse(line));
  for (const validationDetail of CLAIM_VALIDATION_DETAILS) {
    recordAiResult({ status: 'fallback', reason: 'invalid_claim', validationDetail }, write);
    assert.equal(logs.at(-1).validationDetail, validationDetail);
  }
  for (const validationDetail of ['synthetic-private-value', { message: 'synthetic-private-value' }, null]) {
    recordAiResult({ status: 'fallback', reason: 'invalid_claim', validationDetail }, write);
    assert.equal(logs.at(-1).validationDetail, undefined);
  }
  for (const result of [{ status: 'candidate', reason: 'invalid_claim' }, { status: 'fallback', reason: 'provider_response_failed' }]) {
    recordAiResult({ ...result, validationDetail: 'claim_shape' }, write);
    assert.equal(logs.at(-1).validationDetail, undefined);
  }
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-private-value/);
});

test('timing diagnostics contain only finite bounded stage numbers', () => {
  const logs = [];
  const write = line => logs.push(JSON.parse(line));
  const timings = { prepareMs: 12.34, modelMs: 4000, finalizeMs: 2, totalMs: 4014.34, privateKey: 'fake-secret' };
  recordAiResult({ status: 'candidate', timings }, write);
  assert.deepEqual(logs[0].timings, { prepareMs: 12.3, modelMs: 4000, finalizeMs: 2, totalMs: 4014.3 });
  assert.doesNotMatch(JSON.stringify(logs), /privateKey|fake-secret/);
  for (const invalid of [Infinity, -1, 600001, 'fake-secret']) {
    recordAiResult({ status: 'candidate', timings: { ...timings, modelMs: invalid } }, write);
    assert.equal(logs.at(-1).timings, undefined);
    assert.equal(logs.at(-1).status, 'candidate');
  }
});

test('route metadata is logged only for an exact known provider and model', () => {
  const logs = [];
  const write = line => logs.push(JSON.parse(line));
  recordAiResult({ status: 'candidate', providerId: 'kimi', modelId: 'kimi-k3.1-pro', sourceMode: 'personal' }, write);
  assert.deepEqual(logs[0].route, { providerId: 'kimi', modelId: 'kimi-k3.1-pro', sourceMode: 'personal' });
  recordAiResult({ status: 'fallback', providerId: 'secret-not-a-provider', modelId: 'secret-not-a-model', sourceMode: 'personal' }, write);
  assert.equal(logs[1].route, undefined);
});

test('custom personal route diagnostics never echo caller-supplied model names', () => {
  const logs = [];
  const privateName = 'ft:PRIVATE_NAME:team:secret';
  recordAiResult({ status: 'candidate', providerId: 'openai', modelId: privateName, sourceMode: 'personal' }, line => logs.push(line));
  assert.deepEqual(JSON.parse(logs[0]).route, { providerId: 'openai', modelId: 'custom', sourceMode: 'personal' });
  assert.doesNotMatch(logs[0], /PRIVATE_NAME|secret/);
  recordAiResult({ status: 'candidate', providerId: 'openai', modelId: privateName, sourceMode: 'default' }, line => logs.push(line));
  assert.equal(JSON.parse(logs[1]).route, undefined);
});

test('Bailian personal metadata is bounded and cannot appear as a shared route', () => {
  const logs = [];
  for (const modelId of ['qwen3.8-flash', 'ft:PRIVATE_NAME:team:secret']) {
    recordAiResult({ status: 'candidate', providerId: 'bailian', modelId, sourceMode: 'personal' }, line => logs.push(JSON.parse(line)));
    assert.deepEqual(logs.at(-1).route, { providerId: 'bailian', modelId: 'custom', sourceMode: 'personal' });
    recordAiResult({ status: 'candidate', providerId: 'bailian', modelId, sourceMode: 'default' }, line => logs.push(JSON.parse(line)));
    assert.equal(logs.at(-1).route, undefined);
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_NAME|secret/);
});
