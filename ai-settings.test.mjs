import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_CONFIG_VERSION, CUSTOM_MODEL_OPTION, normalizeAiStatus, findAiProfile, aiSelectionProfile, canUseAiSelection, createAiSettingsDraft, changeAiSettingsProvider, changeAiSettingsModel, sameAiRoute, aiErrorMessage } from './public/ai-settings.mjs';
import { createPersonalKeyPreference } from './public/personal-key.mjs';

const providers = [
  ['deepseek', 'DeepSeek', 'deepseek-flash'], ['kimi', 'Kimi', 'kimi-k3.1-pro'],
  ['glm', 'GLM', 'glm-4.7-flash'], ['openai', 'OpenAI', 'gpt-6-luna'],
].map(([id, label, model]) => ({ id, label, defaultModelId: model, allowCustomModels: true, keyHelp: `${label} 官方 API Key`, models: [{ id: model, label: model, note: `${label} 试用边界` }] }));
const status = changes => normalizeAiStatus({ enabled: true, personalKeySupported: true, configVersion: AI_CONFIG_VERSION, consentVersion: 'multi-provider-v1', providers, defaultProfile: { providerId: 'deepseek', modelId: 'deepseek-flash' }, defaultAvailable: true, defaultEnabled: true, remainingCalls: 16, remainingBudgetCny: 0.8, ...changes });
const route = (provider = providers[0], sourceMode = 'personal') => ({ sourceMode, providerId: provider.id, modelId: provider.defaultModelId });

test('catalog rejects old consent/configuration and unknown provider/model routes without guessing from a key', () => {
  assert.equal(status({ consentVersion: 'deepseek-v1' }).enabled, false);
  assert.equal(status({ configVersion: 'public-v1' }).enabled, false);
  assert.equal(status({ configVersion: 'multi-v1' }).enabled, false);
  const current = status({ providers: [...providers, { ...providers[0], id: 'proxy' }], defaultProfile: { providerId: 'kimi', modelId: 'deepseek-flash' } });
  assert.equal(current.providers.length, 4);
  assert.equal(current.defaultAvailable, false);
  assert.equal(current.defaultProfile, null);
  assert.equal(aiSelectionProfile({ sourceMode: 'personal', providerId: 'proxy', modelId: 'deepseek-flash' }, current), null);
  assert.equal(findAiProfile(current.providers, 'kimi', 'deepseek-flash'), null);
  const fixed = status({ providers: providers.map(value => ({ ...value, allowCustomModels: false })) });
  assert.equal(aiSelectionProfile({ sourceMode: 'personal', providerId: 'kimi', modelId: 'deepseek-flash' }, fixed), null);
});

test('all four personal sources accept custom model IDs only when the server advertises the capability', () => {
  const current = status();
  for (const provider of providers) {
    const selected = { sourceMode: 'personal', providerId: provider.id, modelId: 'my-text-model:v2' };
    assert.equal(findAiProfile(current.providers, provider.id, selected.modelId), null);
    const profile = aiSelectionProfile(selected, current);
    assert.equal(profile.providerId, provider.id);
    assert.equal(profile.modelId, selected.modelId);
    assert.equal(profile.modelLabel, selected.modelId);
    assert.equal(profile.modelNote, '');
    assert.equal(canUseAiSelection(selected, current, true), true);
    assert.equal(canUseAiSelection(selected, current, false), false);
    for (const flag of [false, undefined, 'true']) {
      const disabled = status({ providers: providers.map(value => ({ ...value, allowCustomModels: flag })) });
      assert.equal(aiSelectionProfile(selected, disabled), null);
    }
  }
});

test('custom capability never widens the server default profile', () => {
  for (const provider of providers) {
    const current = status({ defaultProfile: { providerId: provider.id, modelId: 'my-text-model:v2' } });
    assert.equal(current.defaultAvailable, false);
    assert.equal(current.defaultProfile, null);
    assert.equal(canUseAiSelection({ sourceMode: 'default', providerId: provider.id, modelId: 'my-text-model:v2' }, current, false), false);
  }
});

test('custom IDs and route comparisons use the server model alphabet rather than accepting URLs or control text', () => {
  const current = status();
  const ids = ['ft:text-model:account:reflection:abc', 'vendor/family.model-1_2', '_private-model'];
  for (const id of ids) {
    const selected = { sourceMode: 'personal', providerId: 'openai', modelId: id };
    assert.ok(aiSelectionProfile(selected, current));
    assert.equal(sameAiRoute(selected, { ...selected }), true);
  }
  for (const id of ['', ' ', ' model', 'model ', 'model\n', 'model\t', 'https://api.example/model', 'model?x=1', '<script>', ':model', '/model', '.model', '-model', 'm'.repeat(101), CUSTOM_MODEL_OPTION, '模型']) {
    const selected = { sourceMode: 'personal', providerId: 'openai', modelId: id };
    assert.equal(aiSelectionProfile(selected, current), null, id);
    assert.equal(sameAiRoute(selected, { ...selected }), false, id);
  }
});

test('reopening a custom selection restores its model but editing model or provider does not authorize old-key reuse', () => {
  const current = status();
  const preference = createPersonalKeyPreference();
  const selected = { sourceMode: 'personal', providerId: 'openai', modelId: 'ft:text-model:reflection' };
  assert.equal(preference.apply({ ...selected, apiKey: 'synthetic-custom-model-key' }, current.providers).ok, true);
  const draft = createAiSettingsDraft(preference.selection(), current);
  assert.equal(draft.modelMode, 'custom');
  assert.equal(draft.modelId, selected.modelId);
  assert.equal(draft.retainExisting, true);
  assert.equal(Object.hasOwn(draft, 'apiKey'), false);
  const changed = changeAiSettingsModel(draft, providers[3].defaultModelId, current);
  assert.equal(changed.modelMode, 'preset');
  assert.equal(changed.retainExisting, false);
  assert.equal(preference.apply({ ...changed, apiKey: '' }, current.providers).reason, 'missing_personal_key');
  const manual = changeAiSettingsModel(changed, CUSTOM_MODEL_OPTION, current);
  assert.equal(manual.modelMode, 'custom');
  assert.equal(manual.modelId, '');
  assert.equal(manual.retainExisting, false);
  assert.equal(preference.apply({ ...manual, apiKey: 'synthetic-new-model-key' }, current.providers).reason, 'unsupported_model');
  const otherProvider = changeAiSettingsProvider(draft, 'kimi', current);
  assert.equal(otherProvider.modelMode, 'preset');
  assert.equal(otherProvider.modelId, providers[1].defaultModelId);
  assert.equal(otherProvider.retainExisting, false);
  assert.deepEqual(preference.selection(), selected);
  const invalid = changeAiSettingsModel(draft, 'missing-option', current);
  assert.equal(invalid.modelId, '');
});

test('personal eligibility remains independent of exhausted or missing shared default', () => {
  for (const current of [status({ defaultEnabled: false, remainingCalls: 0, remainingBudgetCny: 0 }), status({ defaultAvailable: false, defaultEnabled: false, defaultProfile: null })]) {
    for (const provider of providers) {
      assert.equal(canUseAiSelection(route(provider), current, true), true);
      assert.equal(canUseAiSelection(route(provider), current, false), false);
    }
    assert.equal(canUseAiSelection({ sourceMode: 'default' }, current, false), false);
  }
  const current = status({ enabled: false, defaultEnabled: false });
  assert.equal(canUseAiSelection(route(), current, true), false);
});

test('default recipient comes exclusively from the server default profile', () => {
  const current = status({ defaultProfile: { providerId: 'glm', modelId: 'glm-4.7-flash' } });
  const profile = aiSelectionProfile({ sourceMode: 'default', providerId: 'deepseek', modelId: 'deepseek-flash' }, current);
  assert.equal(profile.providerId, 'glm');
  assert.equal(profile.providerLabel, 'GLM');
  assert.equal(canUseAiSelection({ sourceMode: 'default' }, current, false), true);
});

test('editing and cancelling a draft never changes applied selection; switching requires a new key', () => {
  const preference = createPersonalKeyPreference();
  const current = status();
  preference.apply({ ...route(), apiKey: 'synthetic-deepseek-key-only' }, current.providers);
  const before = preference.forRequest();
  const draft = createAiSettingsDraft(preference.selection(), current);
  assert.equal(draft.retainExisting, true);
  const changed = changeAiSettingsProvider(draft, 'kimi', current);
  assert.equal(changed.providerId, 'kimi');
  assert.equal(changed.modelId, 'kimi-k3.1-pro');
  assert.equal(changed.retainExisting, false);
  assert.deepEqual(preference.forRequest(), before);
  assert.equal(preference.apply({ ...changed, apiKey: '' }, current.providers).reason, 'missing_personal_key');
  assert.deepEqual(preference.forRequest(), before);
  assert.equal(preference.apply({ ...changed, apiKey: 'synthetic-kimi-key-only' }, current.providers).ok, true);
  assert.equal(preference.selection().providerId, 'kimi');
});

test('reply acceptance binds payer, service provider and model rather than only request identity', () => {
  const expected = route();
  assert.equal(sameAiRoute(expected, { ...expected }), true);
  for (const actual of [undefined, {}, { sourceMode: 'personal' }, { ...expected, sourceMode: 'default' }, { ...expected, providerId: 'kimi' }, { ...expected, modelId: 'other-model' }]) {
    assert.equal(sameAiRoute(actual, expected), false);
  }
  assert.equal(sameAiRoute({ sourceMode: 'default' }, { sourceMode: 'default' }), false);
});

test('safe errors name the selected provider and preserve the local fallback without raw vendor errors', () => {
  for (const provider of providers) {
    for (const reason of ['provider_auth_failed', 'provider_access_denied', 'provider_model_unavailable', 'provider_balance_low', 'provider_rate_limited']) {
      assert.ok(aiErrorMessage(reason, provider.label).includes(provider.label));
    }
  }
  assert.match(aiErrorMessage('missing_personal_key', 'Kimi'), /没有改用默认服务/);
  assert.match(aiErrorMessage('budget_exhausted', 'DeepSeek'), /共享体验额度/);
  assert.doesNotMatch(aiErrorMessage('RAW_PRIVATE_PROVIDER_SECRET', 'GLM'), /RAW_PRIVATE_PROVIDER_SECRET/);
});
