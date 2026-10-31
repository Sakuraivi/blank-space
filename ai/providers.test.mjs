import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoute, getPersonalRoute, isTrustedRoute, publicProviders, PRICE_VALID_UNTIL } from './providers.mjs';

test('public catalog exposes four complete selections without private endpoints or mutable objects', () => {
  const catalog = publicProviders();
  assert.deepEqual(catalog.map(p => p.id), ['deepseek', 'kimi', 'glm', 'openai']);
  assert.ok(Object.isFrozen(catalog));
  for (const provider of catalog) {
    assert.deepEqual(Object.keys(provider).sort(), ['allowCustomModels', 'defaultModelId', 'id', 'keyHelp', 'label', 'models']);
    assert.equal(provider.allowCustomModels, true);
    assert.equal(provider.models.length, 1);
    assert.equal(provider.models[0].id, provider.defaultModelId);
    assert.ok(provider.label && provider.keyHelp && provider.models[0].note);
    assert.ok(Object.isFrozen(provider) && Object.isFrozen(provider.models) && Object.isFrozen(provider.models[0]));
  }
  assert.doesNotMatch(JSON.stringify(catalog), /https:|apiKey|Authorization|reserveMicros/);
  assert.throws(() => { catalog[0].models[0].id = 'other'; }, TypeError);
});

test('personal model IDs get only server-issued fixed-provider routes and no shared price', () => {
  for (const provider of publicProviders()) {
    const modelId = 'ft:future-text-model:team:review-1';
    const route = getPersonalRoute(provider.id, modelId);
    assert.ok(isTrustedRoute(route));
    assert.ok(Object.isFrozen(route) && Object.isFrozen(route.profile));
    assert.equal(route.endpoint, getRoute(provider.id, provider.defaultModelId).endpoint);
    assert.equal(route.modelId, modelId);
    assert.equal(route.transportMode, 'generic-chat');
    assert.equal(route.profile.instructionChannel, 'system');
    assert.equal(route.reserveMicros, 0);
    assert.equal(route.inputRateCnyPerMillion, null);
    assert.equal(route.outputRateCnyPerMillion, null);
    assert.equal(route.priceVersion, 'personal-unpriced-v1');
    assert.equal(getRoute(provider.id, modelId), null);
    assert.equal(isTrustedRoute({ ...route }), false);
    assert.equal(getPersonalRoute(provider.id, provider.defaultModelId), getRoute(provider.id, provider.defaultModelId));
  }
  for (const id of ['', ' spaced ', 'bad\nmodel', 'https://attacker.invalid/model', 'model?key=private', 'a'.repeat(101), null, {}]) assert.equal(getPersonalRoute('openai', id), null);
  assert.equal(getPersonalRoute('__proto__', 'valid-model'), null);
});

test('unknown provider/model pairs and cross-provider model selection never grant a route', () => {
  for (const provider of publicProviders()) {
    const route = getRoute(provider.id, provider.defaultModelId);
    assert.ok(Object.isFrozen(route) && Object.isFrozen(route.profile));
    assert.equal(route, getRoute(provider.id, provider.defaultModelId));
    assert.equal(route.providerId, provider.id);
    assert.equal(route.modelId, provider.defaultModelId);
    assert.ok(route.endpoint.startsWith('https://'));
    assert.equal(route.profile.structuredOutput, false);
    assert.throws(() => { route.endpoint = 'https://attacker.invalid'; }, TypeError);
    for (const other of publicProviders().filter(p => p.id !== provider.id)) assert.equal(getRoute(provider.id, other.defaultModelId), null);
  }
  for (const [p, m] of [[undefined, undefined], ['deepseek', undefined], ['__proto__', 'deepseek-flash'], ['kimi', 'kimi-k2.6'], ['openai', 'https://localhost'], [{ toString: () => 'openai' }, 'gpt-6-luna']]) assert.equal(getRoute(p, m), null);
});

test('shared per-model reservation covers documented conservative request/completion bounds', () => {
  assert.equal(PRICE_VALID_UNTIL, Date.parse('2026-11-06T00:00:00+08:00'));
  for (const provider of publicProviders()) {
    const route = getRoute(provider.id, provider.defaultModelId);
    assert.equal(route.maxRequestBytes, 12000);
    assert.equal(route.maxPromptTokens, 13000);
    assert.equal(route.maxOutputTokens, provider.id === 'kimi' ? 2000 : 1000);
    assert.ok(route.priceVersion);
    const worstMicros = route.maxPromptTokens * route.inputRateCnyPerMillion + route.maxOutputTokens * route.outputRateCnyPerMillion;
    assert.ok(worstMicros <= route.reserveMicros, `${provider.id} reservation must cover its bounded estimate`);
    assert.equal(route.reserveMicros, provider.id === 'kimi' ? 400000 : 50000);
  }
  assert.equal(getRoute('openai', 'gpt-6-luna').inputRateCnyPerMillion, 1.25);
  assert.equal(getRoute('glm', 'glm-4.7-flash').outputRateCnyPerMillion, 0);
});
