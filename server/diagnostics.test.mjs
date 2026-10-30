import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAiResult } from './diagnostics.mjs';

test('operational result logs expose only bounded metadata, never supplied prose or credentials', () => {
  const logs = [];
  const secret = 'fake-secret-not-for-logs';
  recordAiResult({ requestId: secret, stage: secret, status: secret, reason: secret, personalApiKey: secret, story: secret }, line => logs.push(line));
  assert.deepEqual(JSON.parse(logs[0]), { event: 'liubai_ai_result', requestId: 'unavailable', stage: 'other', status: 'other', reason: 'other' });
  assert.ok(!logs[0].includes(secret));
  recordAiResult({ requestId: 'e16f2585-d17f-43eb-b121-07e1ce18c5ed', stage: 'reflect', status: 'fallback', reason: 'provider_response_failed' }, line => logs.push(line));
  assert.equal(JSON.parse(logs[1]).reason, 'provider_response_failed');
});

test('diagnostic sink failure never replaces an otherwise usable result', () => {
  assert.doesNotThrow(() => recordAiResult({ status: 'candidate', stage: 'review' }, () => { throw Error('sink unavailable'); }));
});

test('route metadata is logged only for an exact known provider and model', () => {
  const logs = [];
  const write = line => logs.push(JSON.parse(line));
  recordAiResult({ status: 'candidate', providerId: 'kimi', modelId: 'kimi-k3.1-pro', sourceMode: 'personal' }, write);
  assert.deepEqual(logs[0].route, { providerId: 'kimi', modelId: 'kimi-k3.1-pro', sourceMode: 'personal' });
  recordAiResult({ status: 'fallback', providerId: 'secret-not-a-provider', modelId: 'secret-not-a-model', sourceMode: 'personal' }, write);
  assert.equal(logs[1].route, undefined);
});
