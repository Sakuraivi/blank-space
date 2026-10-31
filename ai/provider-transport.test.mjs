import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getRoute, getPersonalRoute, publicProviders } from './providers.mjs';
import { prepareProviderRequest, createProviderAdapter, MAX_RESPONSE_BYTES, MAX_ERROR_BYTES } from './provider-transport.mjs';
import { buildContext, buildModelRequest } from './contract.mjs';
import { runCandidate } from './runtime.mjs';
import { createSession } from '../public/core.mjs';

const apiKey = 'fake-test-key-only-never-real';
const routes = publicProviders().map(p => getRoute(p.id, p.defaultModelId)).filter(Boolean);
const transportRoutes = [...routes, getPersonalRoute('bailian', 'qwen3.8-flash')];
const routeFor = provider => transportRoutes.find(r => r.providerId === provider);
const candidate = { reflection: { text: '你说散步很开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null };
const context = () => { const s = createSession(); s.story = '散步很开心。'; return buildContext({ session: s, revision: 1 }); };
const request = route => structuredClone(buildModelRequest(context(), route.profile));
const completion = (overrides = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }, ...overrides });
const response = (value, options) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...options });

test('four providers map the same platform policy to only their supported request parameters', () => {
  const instructions = new Set();
  for (const route of routes) {
    const input = request(route);
    const prepared = prepareProviderRequest({ ...input, tools: [{ name: 'shell' }], max_tokens: 999999, endpoint: 'http://localhost', apiKey }, route);
    const body = JSON.parse(prepared.body);
    instructions.add(body.messages[0].content);
    assert.equal(body.model, route.modelId);
    assert.equal(body.messages[0].role, route.providerId === 'openai' ? 'developer' : 'system');
    assert.deepEqual(body.messages[1], { role: 'user', content: input.input.content });
    assert.equal(body.stream, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.body).byteLength);
    assert.ok(prepared.byteLength <= route.maxRequestBytes);
    assert.doesNotMatch(prepared.body, /fake-test-key|localhost|shell/);
    if (['deepseek', 'glm'].includes(route.providerId)) {
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.max_tokens, 1000);
      assert.equal(body.max_completion_tokens, undefined);
    } else {
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.max_completion_tokens, route.maxOutputTokens);
      assert.equal(body.thinking, undefined);
      assert.equal(body.reasoning_effort, route.providerId === 'kimi' ? 'low' : 'none');
    }
    if (route.providerId === 'kimi') assert.deepEqual(body.prompt_cache_options, { mode: 'implicit', ttl: '5m' });
    if (route.providerId === 'openai') { assert.equal(body.store, false); assert.equal(body.service_tier, 'default'); }
  }
  assert.equal(instructions.size, 1);
});

test('request validation rejects mismatched routes, channels and UTF-8 overflow before any fetch', async () => {
  let calls = 0;
  for (const route of transportRoutes) {
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => { calls++; return response(completion()); } });
    const base = request(route);
    const room = route.maxRequestBytes - prepareProviderRequest(base, route).byteLength;
    const exact = { ...base, input: { role: 'user', content: base.input.content + 'a'.repeat(room) } };
    assert.equal(prepareProviderRequest(exact, route).byteLength, route.maxRequestBytes);
    assert.throws(() => prepareProviderRequest({ ...exact, input: { role: 'user', content: exact.input.content + '中' } }, route), /input_too_large/);
    const huge = { ...base, input: { role: 'user', content: '中'.repeat(4500) } };
    assert.deepEqual(await adapter.generate(huge), { status: 'failed', reason: 'input_too_large' });
    for (const altered of [{ ...base, modelId: 'other' }, { ...base, providerId: 'other' }, { ...base, instruction: { channel: 'user', text: 'JSON' } }, { ...base, instruction: { channel: route.profile.instructionChannel, text: '只写一些文字' } }]) assert.equal((await adapter.generate(altered)).reason, 'invalid_request');
    assert.throws(() => createProviderAdapter({ route: { ...route, endpoint: 'https://attacker.invalid' }, apiKey }), /invalid_route/);
    assert.throws(() => prepareProviderRequest(base, { ...route }), /invalid_route/);
  }
  assert.equal(calls, 0);
});

test('custom personal IDs use the common policy and generic chat options without assuming model capabilities', async () => {
  const instructions = new Set();
  for (const provider of publicProviders()) {
    const route = getPersonalRoute(provider.id, 'future-text-model');
    const prepared = JSON.parse(prepareProviderRequest(request(route), route).body);
    instructions.add(prepared.messages[0].content);
    assert.equal(prepared.messages[0].role, 'system');
    assert.match(prepared.messages[0].content, /JSON/);
    for (const option of ['reasoning_effort', 'thinking', 'enable_thinking', 'prompt_cache_options', 'response_format', 'service_tier']) assert.equal(prepared[option], undefined);
    assert.equal(prepared.model, 'future-text-model');
    assert.equal(prepared[['openai', 'bailian'].includes(provider.id) ? 'max_completion_tokens' : 'max_tokens'], route.maxOutputTokens);
    if (provider.id === 'openai') assert.equal(prepared.store, false);
    assert.throws(() => prepareProviderRequest(request(route), { ...route, endpoint: 'https://attacker.invalid' }), /invalid_route/);
    let calls = 0;
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, route.endpoint); assert.equal(options.redirect, 'manual');
      return response(completion({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate), reasoning_content: 'PRIVATE_THINKING' } }] }));
    } });
    const result = await runCandidate({ context: context(), adapter, isCurrent: () => true });
    assert.equal(result.status, 'candidate');
    assert.deepEqual(result.candidate, candidate);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_THINKING/);
    assert.equal(calls, 1);
  }
  assert.equal(instructions.size, 1);
});

test('Bailian uses exact Qwen capabilities and bounds unknown vendor models without invented options', () => {
  const instructions = new Set();
  for (const modelId of ['qwen3.8-flash', 'qwen-plus', 'qwen-flash', 'glm-5.3', 'kimi-k3', 'qwen3.8-flash-future', 'ft:private-model:team:review-1']) {
    const route = getPersonalRoute('bailian', modelId);
    const body = JSON.parse(prepareProviderRequest({ ...request(route), enable_thinking: true, max_completion_tokens: 999999 }, route).body);
    instructions.add(body.messages[0].content);
    const legacy = ['qwen-plus', 'qwen-flash'].includes(modelId);
    assert.equal(body.model, modelId);
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /JSON/);
    assert.equal(body.max_completion_tokens, legacy ? undefined : 2000);
    assert.equal(body.max_tokens, legacy ? 2000 : undefined);
    assert.equal(body.enable_thinking, legacy || modelId === 'qwen3.8-flash' ? false : undefined);
    for (const option of ['response_format', 'thinking', 'reasoning_effort', 'store', 'service_tier', 'prompt_cache_options']) assert.equal(body[option], undefined);
  }
  assert.equal(instructions.size, 1);
});

test('exact Bailian latency profiles control thinking without changing custom model routing or retrying', async () => {
  for (const [modelId, thinking, effort] of [
    ['qwen3.8-2.4t-a95b', undefined, 'low'],
    ['deepseek-v4-pro-0813', false, undefined],
    ['qwen3.8-2.4t-a95b-future', undefined, undefined],
    ['deepseek-v4-pro-0813-future', undefined, undefined],
  ]) {
    const route = getPersonalRoute('bailian', modelId), base = request(route); let calls = 0;
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async (url, options) => {
      calls++; const body = JSON.parse(options.body);
      assert.equal(url, route.endpoint); assert.equal(body.model, modelId);
      assert.equal(body.enable_thinking, thinking); assert.equal(body.reasoning_effort, effort);
      assert.equal(body.thinking_budget, undefined);
      assert.equal(body.max_completion_tokens, 2000);
      assert.deepEqual(body.messages[1], { role: 'user', content: base.input.content });
      return response(completion({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify(candidate), reasoning_content: 'PRIVATE_THINKING',
      } }] }));
    } });
    const result = await adapter.generate({ ...base, reasoning_effort: 'xhigh', enable_thinking: true });
    assert.equal(calls, 1); assert.equal(result.status, 'completed');
    assert.deepEqual(result.output, candidate);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_THINKING|fake-test-key/);
  }
  const outside = getPersonalRoute('deepseek', 'deepseek-v4-pro-0813');
  const body = JSON.parse(prepareProviderRequest(request(outside), outside).body);
  assert.equal(body.enable_thinking, undefined); assert.equal(body.reasoning_effort, undefined);
});

test('every transport makes one fixed authenticated request, reports numeric usage and passes the common runtime validator', async () => {
  for (const route of transportRoutes) {
    let calls = 0, observedUsage;
    const adapter = createProviderAdapter({ route, apiKey, onUsage: usage => { observedUsage = usage; }, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, route.endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
      assert.doesNotMatch(options.body, /fake-test-key/);
      return response(completion({ usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, leaked: apiKey } }));
    } });
    const result = await runCandidate({ context: context(), adapter, isCurrent: () => true });
    assert.equal(result.status, 'candidate');
    assert.deepEqual(result.candidate, candidate);
    assert.deepEqual(observedUsage, { promptTokens: 100, completionTokens: 30, totalTokens: 130, promptCacheHitTokens: 0, promptCacheMissTokens: 100, promptCacheWriteTokens: 0, reasoningTokens: 0 });
    assert.equal(calls, 1);
  }
});

test('safe provider errors distinguish authentication, quota, permissions and rate limit without echoing bodies or retrying', async () => {
  const cases = [
    ['deepseek', 401, {}, 'provider_auth_failed'], ['deepseek', 402, {}, 'provider_balance_low'],
    ['kimi', 429, { type: 'exceeded_current_quota_error' }, 'provider_balance_low'],
    ['kimi', 429, { type: 'rate_limit_reached_error' }, 'provider_rate_limited'],
    ['kimi', 429, { type: 'engine_overloaded_error' }, 'provider_rate_limited'],
    ['kimi', 403, {}, 'provider_access_denied'], ['kimi', 404, {}, 'provider_model_unavailable'],
    ['glm', 429, { code: '1113' }, 'provider_balance_low'], ['glm', 429, { code: 1113 }, 'provider_balance_low'],
    ['glm', 429, { code: '1302' }, 'provider_rate_limited'], ['glm', 429, { code: '1305' }, 'provider_rate_limited'],
    ['glm', 400, { code: '1211' }, 'provider_model_unavailable'], ['glm', 403, { code: '1220' }, 'provider_access_denied'],
    ['openai', 429, { code: 'insufficient_quota' }, 'provider_balance_low'],
    ['openai', 429, { type: 'insufficient_quota' }, 'provider_balance_low'],
    ['openai', 429, { code: 'rate_limit_exceeded' }, 'provider_rate_limited'],
    ['openai', 401, {}, 'provider_auth_failed'], ['glm', 500, {}, 'provider_unavailable'],
    ['bailian', 403, { code: 'AllocationQuota.FreeTierOnly' }, 'provider_balance_low'],
    ['bailian', 400, { code: 'Arrearage' }, 'provider_balance_low'],
    ['bailian', 403, { code: 'Arrearage' }, 'provider_access_denied'],
    ['bailian', 400, { code: 'AllocationQuota.FreeTierOnly' }, 'provider_request_rejected'],
    ['bailian', 403, { code: 'AccessDenied', message: 'AllocationQuota.FreeTierOnly' }, 'provider_access_denied'],
    ['bailian', 401, {}, 'provider_auth_failed'], ['bailian', 429, {}, 'provider_rate_limited'],
  ];
  for (const [provider, status, error, reason] of cases) {
    const route = routeFor(provider); let calls = 0;
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => { calls++; return response({ error: { ...error, message: `PRIVATE ${apiKey}` } }, { status }); } });
    const result = await adapter.generate(request(route));
    assert.deepEqual(result, { status: 'failed', reason });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|fake-test-key/);
    assert.equal(calls, 1);
  }
});

test('error parsing is bounded and cancelled; unrecognized or malformed bodies keep only the HTTP enum', async () => {
  for (const route of transportRoutes) {
    let cancelled = false;
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('X'.repeat(MAX_ERROR_BYTES + 1))); }, cancel() { cancelled = true; } });
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => new Response(body, { status: 429 }) });
    assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'provider_rate_limited' });
    assert.equal(cancelled, true);
    const malformed = createProviderAdapter({ route, apiKey, fetchImpl: async () => new Response('{broken PRIVATE', { status: 429 }) });
    assert.deepEqual(await malformed.generate(request(route)), { status: 'failed', reason: 'provider_rate_limited' });
  }
});

test('all manual 3xx and unexpected redirect signals are rejected once without forwarding credentials', async () => {
  for (const route of transportRoutes) {
    for (let status = 300; status < 400; status++) {
      let calls = 0;
      const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => { calls++; return new Response(null, { status, headers: { Location: 'https://attacker.invalid/collect' } }); } });
      assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'provider_redirect_rejected' });
      assert.equal(calls, 1);
    }
    for (const [property, value] of [['type', 'opaqueredirect'], ['redirected', true], ['url', 'https://attacker.invalid/collect']]) {
      const supplied = response(completion()); Object.defineProperty(supplied, property, { value });
      const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => supplied });
      assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'provider_redirect_rejected' });
    }
  }
});

test('Kimi reasoning stays private while its numeric completion count includes reasoning exactly once', async () => {
  for (const route of routes) {
    let observed;
    const adapter = createProviderAdapter({ route, apiKey, onUsage: usage => { observed = usage; }, fetchImpl: async () => response(completion({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate), reasoning_content: `PRIVATE ${apiKey}` } }],
      usage: { prompt_tokens: 309, completion_tokens: 82, total_tokens: 391, completion_tokens_details: { reasoning_tokens: 60 }, prompt_tokens_details: { cached_tokens: 10, cache_write_tokens: 256 } },
    })) });
    const result = await adapter.generate(request(route));
    assert.deepEqual(result, route.providerId === 'kimi' ? { status: 'completed', output: candidate } : { status: 'failed', reason: 'invalid_response' });
    assert.equal(observed.completionTokens, 82);
    assert.equal(observed.totalTokens, 391);
    assert.equal(observed.reasoningTokens, 60);
    assert.equal(observed.promptCacheMissTokens, 43);
    assert.doesNotMatch(JSON.stringify([result, observed]), /PRIVATE|fake-test-key/);
  }
});

test('usage normalization rejects invalid totals but keeps billable usage when optional details are malformed', async () => {
  for (const route of transportRoutes) {
    for (const usage of [
      { prompt_tokens: -1, completion_tokens: 30, total_tokens: 29 },
      { prompt_tokens: 100, completion_tokens: 30, total_tokens: 10 },
    ]) {
      let called = false;
      const adapter = createProviderAdapter({ route, apiKey, onUsage: () => { called = true; }, fetchImpl: async () => response(completion({ usage })) });
      assert.equal((await adapter.generate(request(route))).status, 'completed');
      assert.equal(called, false);
    }
    let observed;
    const adapter = createProviderAdapter({ route, apiKey, onUsage: usage => { observed = usage; }, fetchImpl: async () => response(completion({ usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 } })) });
    await adapter.generate(request(route));
    assert.equal(observed.promptCacheHitTokens, 20);
    assert.equal(observed.promptCacheMissTokens, 80);
    for (const optional of [
      { prompt_cache_hit_tokens: 999 },
      { prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 50 } },
      { prompt_tokens_details: { cached_tokens: 'PRIVATE', cache_write_tokens: -1 } },
      { completion_tokens_details: { reasoning_tokens: 31 } },
      { completion_tokens_details: { reasoning_tokens: 'PRIVATE' } },
    ]) {
      let observed;
      const adapter = createProviderAdapter({ route, apiKey, onUsage: usage => { observed = usage; }, fetchImpl: async () => response(completion({ usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, ...optional } })) });
      assert.equal((await adapter.generate(request(route))).status, 'completed');
      assert.deepEqual(observed, { promptTokens: 100, completionTokens: 30, totalTokens: 130, promptCacheHitTokens: 0, promptCacheMissTokens: 100, promptCacheWriteTokens: 0, reasoningTokens: 0 });
    }
  }
});

test('malformed optional cache or reasoning data cannot conceal an over-limit billable total', async () => {
  for (const route of transportRoutes) for (const optional of [
    { prompt_tokens_details: { cached_tokens: 101 } },
    { prompt_cache_hit_tokens: 'PRIVATE' },
    { completion_tokens_details: { reasoning_tokens: Number.MAX_SAFE_INTEGER } },
  ]) {
    let observed;
    const adapter = createProviderAdapter({ route, apiKey, onUsage: usage => { observed = usage; }, fetchImpl: async () => response(completion({ usage: {
      prompt_tokens: 100, completion_tokens: route.maxOutputTokens + 1, total_tokens: route.maxOutputTokens + 101, ...optional,
    } })) });
    assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'usage_out_of_bounds' });
    assert.equal(observed.completionTokens, route.maxOutputTokens + 1);
    assert.equal(observed.totalTokens, route.maxOutputTokens + 101);
    assert.doesNotMatch(JSON.stringify(observed), /PRIVATE/);
  }
});

test('well-formed usage above either route bound fails closed and stays observable for durable stop', async () => {
  for (const route of transportRoutes) {
    for (const usage of [
      { prompt_tokens: route.maxPromptTokens + 1, completion_tokens: 20, total_tokens: route.maxPromptTokens + 21 },
      { prompt_tokens: 100, completion_tokens: route.maxOutputTokens + 1, total_tokens: route.maxOutputTokens + 101 },
    ]) {
      let observed;
      const adapter = createProviderAdapter({ route, apiKey, onUsage: u => { observed = u; }, fetchImpl: async () => response(completion({ usage })) });
      assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'usage_out_of_bounds' });
      assert.ok(observed);
    }
    const adapter = createProviderAdapter({ route, apiKey, onUsage: () => { throw Error('PRIVATE'); }, fetchImpl: async () => response(completion()) });
    assert.deepEqual(await adapter.generate(request(route)), { status: 'completed', output: candidate });
  }
});

test('known over-limit primary counters stop generation even when contradictory totals cannot be stored', async () => {
  for (const route of transportRoutes) for (const usage of [
    { prompt_tokens: route.maxPromptTokens + 1, completion_tokens: 0, total_tokens: 0 },
    { prompt_tokens: 100, completion_tokens: route.maxOutputTokens + 1, total_tokens: 'PRIVATE' },
    { prompt_tokens: 2000000000, completion_tokens: 1, total_tokens: null },
  ]) {
    let observed = null;
    const adapter = createProviderAdapter({ route, apiKey, onUsage: value => { observed = value; }, fetchImpl: async () => response(completion({ usage })) });
    assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'usage_out_of_bounds' });
    assert.equal(observed, null);
  }
});

test('incomplete, malformed, refusal and tool responses never become usable output', async () => {
  const variants = [
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '  ' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{ name: 'tool' }] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', refusal: 'PRIVATE' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', reasoning_content: {} } }] },
    { choices: [] }, { choices: [completion().choices[0], completion().choices[0]] },
  ];
  for (const route of transportRoutes) for (const variant of variants) {
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => response(variant) });
    assert.equal((await adapter.generate(request(route))).status, 'failed');
  }
});

test('success response byte bound applies to declared and streamed length', async () => {
  for (const route of transportRoutes) {
    let cancelled = false;
    const huge = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); }, cancel() { cancelled = true; } }));
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => huge });
    assert.deepEqual(await adapter.generate(request(route)), { status: 'failed', reason: 'response_too_large' });
    assert.equal(cancelled, true);
    const declared = createProviderAdapter({ route, apiKey, fetchImpl: async () => new Response('{}', { headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } }) });
    assert.equal((await declared.generate(request(route))).reason, 'response_too_large');
  }
});

test('abort before send makes no request; abort during success/error stream closes the body', async () => {
  for (const route of transportRoutes) {
    const pre = new AbortController(); pre.abort(); let calls = 0;
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: async () => { calls++; return response(completion()); } });
    assert.deepEqual(await adapter.generate(request(route), { signal: pre.signal }), { status: 'failed', reason: 'aborted' });
    assert.equal(calls, 0);
    for (const status of [200, 429]) {
      const mid = new AbortController(); let cancelled = false;
      const waiting = createProviderAdapter({ route, apiKey, fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('\n')); }, cancel() { cancelled = true; } }), { status }) });
      const pending = waiting.generate(request(route), { signal: mid.signal });
      await Promise.resolve(); await Promise.resolve(); mid.abort();
      const result = await pending;
      // DeepSeek never reads error JSON; it can return before the abort.
      assert.ok(result.reason === 'aborted' || (route.providerId === 'deepseek' && status === 429 && result.reason === 'provider_rate_limited'));
      assert.equal(cancelled, true);
    }
  }
});

test('timeout discards an uncooperative supplier without retries or secret exception propagation', async () => {
  for (const route of transportRoutes) {
    let calls = 0, resolveFetch;
    const waiting = new Promise(resolve => { resolveFetch = resolve; });
    const adapter = createProviderAdapter({ route, apiKey, fetchImpl: () => { calls++; return waiting; } });
    assert.deepEqual(await runCandidate({ context: context(), adapter, isCurrent: () => true, timeoutMs: 5 }), { status: 'fallback', reason: 'timeout', candidate: null });
    resolveFetch(response(completion())); await Promise.resolve();
    assert.equal(calls, 1);
    const broken = createProviderAdapter({ route, apiKey, fetchImpl: async () => { throw Error(`PRIVATE ${apiKey}`); } });
    assert.deepEqual(await broken.generate(request(route)), { status: 'failed', reason: 'provider_response_failed' });
  }
});

test('invalid key and adapter options are rejected with fixed messages', () => {
  const route = routes[0];
  for (const invalid of ['', 'short', 'unsafe\r\nAuthorization: secret', '空白密钥']) assert.throws(() => createProviderAdapter({ route, apiKey: invalid }), error => error.message === 'invalid_api_key');
  assert.throws(() => createProviderAdapter({ route, apiKey, fetchImpl: {} }), /invalid_adapter_options/);
  assert.throws(() => createProviderAdapter({ route, apiKey, onUsage: {} }), /invalid_adapter_options/);
});

test('known and custom personal routes use Workerd-compatible manual fetch and reject 302 without a second outbound request', { timeout: 30000 }, async t => {
  const { Miniflare, Response: WorkerResponse } = await import('miniflare');
  const paths = ['providers.mjs', 'provider-transport.mjs', 'clarity-schema.mjs', 'clarity-turn.mjs', '../public/clarity-contract.mjs'];
  let mode = 'success'; const calls = [];
  const worker = new Miniflare({
    modulesRoot: fileURLToPath(new URL('../', import.meta.url)), compatibilityDate: '2026-05-01', cf: false,
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('./provider-workerd-test-entry.mjs', import.meta.url)), contents: `
      import { getRoute, getPersonalRoute } from './providers.mjs';
      import { createProviderAdapter } from './provider-transport.mjs';
      export default { async fetch(incoming) {
        const params = new URL(incoming.url).searchParams;
        const route = params.get('source') === 'personal' ? getPersonalRoute(params.get('provider'), params.get('model')) : getRoute(params.get('provider'), params.get('model'));
        if (!route) return Response.json({ status: 'failed', reason: 'unsupported_model' }, { status: 400 });
        const adapter = createProviderAdapter({ route, apiKey: ${JSON.stringify(apiKey)} });
        const request = ${JSON.stringify(request(routes[0]))};
        request.providerId = route.providerId; request.modelId = route.modelId; request.instruction.channel = route.profile.instructionChannel;
        return Response.json(await adapter.generate(request));
      } };`
    }, ...paths.map(path => ({ type: 'ESModule', path: fileURLToPath(new URL(`./${path}`, import.meta.url)), contents: readFileSync(new URL(`./${path}`, import.meta.url), 'utf8') }))],
    outboundService: async outgoing => {
      calls.push({ url: outgoing.url, authorization: outgoing.headers.get('Authorization') });
      if (!transportRoutes.some(r => r.endpoint === outgoing.url)) return new WorkerResponse(null, { status: 418 });
      const body = await outgoing.json();
      if (outgoing.url === routeFor('bailian').endpoint) {
        assert.equal(body.max_completion_tokens, 2000);
        assert.equal(body.enable_thinking, ['qwen3.8-flash', 'deepseek-v4-pro-0813'].includes(body.model) ? false : undefined);
        assert.equal(body.reasoning_effort, body.model === 'qwen3.8-2.4t-a95b' ? 'low' : undefined);
        assert.equal(body.messages[0].role, 'system');
        assert.match(body.messages[0].content, /JSON/);
        for (const option of ['max_tokens', 'response_format', 'thinking', 'store']) assert.equal(body[option], undefined);
      }
      if (mode === 'redirect') return new WorkerResponse(null, { status: 302, headers: { Location: 'https://attacker.invalid/collect' } });
      return new WorkerResponse(JSON.stringify(completion()), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  t.after(() => worker.dispose());
  const cases = [...routes.map(route => ({ route, source: 'default' })), ...publicProviders().map(provider => ({ route: getPersonalRoute(provider.id, 'future-custom-chat-model'), source: 'personal' })),
    ...['qwen3.8-flash', 'qwen3.8-2.4t-a95b', 'deepseek-v4-pro-0813', 'deepseek-v4-pro-0813-future', 'glm-5.3', 'kimi-k3'].map(modelId => ({ route: getPersonalRoute('bailian', modelId), source: 'personal' }))];
  for (const { route, source } of cases) for (const testMode of ['success', 'redirect']) {
    mode = testMode; calls.length = 0;
    const result = await worker.dispatchFetch(`https://worker.test/?provider=${route.providerId}&model=${route.modelId}&source=${source}`);
    assert.deepEqual(await result.json(), mode === 'success' ? { status: 'completed', output: candidate } : { status: 'failed', reason: 'provider_redirect_rejected' });
    assert.deepEqual(calls, [{ url: route.endpoint, authorization: `Bearer ${apiKey}` }]);
  }
  calls.length = 0;
  const denied = await worker.dispatchFetch('https://worker.test/?provider=bailian&model=qwen3.8-flash&source=default');
  assert.equal(denied.status, 400);
  assert.deepEqual(await denied.json(), { status: 'failed', reason: 'unsupported_model' });
  assert.deepEqual(calls, []);
});
