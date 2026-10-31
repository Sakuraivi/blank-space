import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalKeyPreference } from './public/personal-key.mjs';

const providers = [
  { id: 'deepseek', label: 'DeepSeek', models: [{ id: 'deepseek-flash', label: 'DeepSeek Flash' }] },
  { id: 'kimi', label: 'Kimi', models: [{ id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' }] },
];
const key = 'synthetic-personal-key-only';
const personal = changes => ({ sourceMode: 'personal', providerId: 'deepseek', modelId: 'deepseek-flash', apiKey: key, ...changes });

test('personal key is page-local, can be cleared, and is not serialized', () => {
  const first = createPersonalKeyPreference();
  const otherPage = createPersonalKeyPreference();
  assert.deepEqual(first.apply(personal({ apiKey: `  ${key}  ` }), providers), { ok: true });
  assert.equal(first.forRequest().personalApiKey, key);
  assert.equal(otherPage.hasKey(), false);
  assert.doesNotMatch(JSON.stringify({ preference: first, choice: first.selection() }), /synthetic-personal/);
  first.clear();
  assert.equal(first.forRequest().personalApiKey, '');
});

test('invalid input cannot silently replace a personal key with the default choice', () => {
  const preference = createPersonalKeyPreference();
  preference.apply(personal(), providers);
  for (const invalid of ['short', 'x'.repeat(257), 'synthetic key with spaces', '\u4e2d'.repeat(20), null]) {
    assert.equal(preference.apply(personal({ apiKey: invalid }), providers).ok, false);
    assert.equal(preference.forRequest().personalApiKey, key);
  }
  assert.deepEqual(preference.apply({ sourceMode: 'default' }, providers), { ok: true });
  assert.equal(preference.hasKey(), false);
});

test('provider, model and credential apply atomically; missing or mismatched drafts never borrow the old key', () => {
  const preference = createPersonalKeyPreference();
  preference.apply(personal(), providers);
  const previous = preference.forRequest();
  for (const draft of [
    personal({ providerId: 'kimi', modelId: 'kimi-k3.1-pro', apiKey: '', retainExisting: true }),
    personal({ providerId: 'kimi', apiKey: 'different-synthetic-key' }),
    personal({ providerId: 'unknown' }),
    personal({ modelId: 'custom-model' }),
    personal({ sourceMode: 'automatic' }),
  ]) {
    assert.equal(preference.apply(draft, providers).ok, false);
    assert.deepEqual(preference.forRequest(), previous);
  }
  assert.equal(preference.apply(personal({ providerId: 'kimi', modelId: 'kimi-k3.1-pro', apiKey: 'synthetic-kimi-key-only' }), providers).ok, true);
  assert.equal(preference.selection().providerId, 'kimi');
  assert.equal(preference.forRequest().personalApiKey, 'synthetic-kimi-key-only');
  assert.equal(previous.providerId, 'deepseek');
  assert.equal(previous.personalApiKey, key);
});

test('retaining an existing key requires the identical profile and explicit unchanged-draft flag', () => {
  const preference = createPersonalKeyPreference();
  preference.apply(personal(), providers);
  assert.equal(preference.apply(personal({ apiKey: '', retainExisting: false }), providers).reason, 'missing_personal_key');
  assert.equal(preference.apply(personal({ apiKey: '', retainExisting: true }), providers).ok, true);
  const choice = preference.selection(); choice.providerId = 'kimi';
  assert.equal(preference.selection().providerId, 'deepseek');
  const snapshot = preference.forRequest(); snapshot.personalApiKey = 'mutated-copy';
  assert.equal(preference.forRequest().personalApiKey, key);
});

test('each supported personal provider can apply a custom model atomically without exposing or borrowing credentials', () => {
  const flexible = [
    ['deepseek', 'deepseek-flash'], ['kimi', 'kimi-k3.1-pro'], ['glm', 'glm-4.7-flash'], ['openai', 'gpt-6-luna'],
  ].map(([id, model]) => ({ id, label: id, allowCustomModels: true, defaultModelId: model, models: [{ id: model, label: model }] }));
  for (const provider of flexible) {
    const preference = createPersonalKeyPreference();
    const custom = { sourceMode: 'personal', providerId: provider.id, modelId: 'my-model:reflection/v2', apiKey: key };
    assert.equal(preference.apply(custom, flexible).ok, true);
    const before = preference.forRequest();
    assert.equal(preference.apply({ ...custom, apiKey: '', retainExisting: true }, flexible).ok, true);
    assert.equal(preference.apply({ ...custom, modelId: 'another-model', apiKey: '', retainExisting: true }, flexible).reason, 'missing_personal_key');
    assert.deepEqual(preference.forRequest(), before);
    assert.doesNotMatch(JSON.stringify({ preference, selection: preference.selection() }), /synthetic-personal/);
    const revoked = flexible.map(value => ({ ...value, allowCustomModels: false }));
    assert.equal(preference.apply({ ...custom, apiKey: '', retainExisting: true }, revoked).reason, 'unsupported_model');
    assert.deepEqual(preference.forRequest(), before);
    for (const modelId of ['https://api.example/text', ' model', 'model\n', 'model?key=value', '/model', 'm'.repeat(101)]) {
      assert.equal(preference.apply({ ...custom, modelId }, flexible).reason, 'unsupported_model');
      assert.deepEqual(preference.forRequest(), before);
    }
  }
});
