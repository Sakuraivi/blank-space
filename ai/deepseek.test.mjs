import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDeepseekAdapter, prepareDeepseekRequest, DEEPSEEK_PROFILE, DEEPSEEK_ENDPOINT, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from './deepseek.mjs';
import { buildContext, buildModelRequest } from './contract.mjs';
import { runCandidate } from './runtime.mjs';
import { createSession } from '../public/core.mjs';

const apiKey = 'test-key-never-real';
const request = () => ({ providerId: 'deepseek', modelId: 'deepseek-flash', instruction: { channel: 'system', text: '仅输出 JSON。' }, input: { role: 'user', content: '{"text":"散步很开心"}' } });
const candidate = { reflection: { text: '这次散步让你开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null };
const completion = overrides => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }, ...overrides });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('request preparation fixes endpoint protocol, disables thinking and excludes tools or extra fields', () => {
  const prepared = prepareDeepseekRequest({ ...request(), tools: [{ name: 'shell' }], max_tokens: 100000, endpoint: 'http://localhost', apiKey });
  const body = JSON.parse(prepared.body);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'stream', 'thinking']);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.max_tokens, 1000);
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.body).byteLength);
  assert.ok(prepared.byteLength <= MAX_REQUEST_BYTES);
  assert.doesNotMatch(prepared.body, /test-key|localhost|shell/);
});

test('byte limit counts UTF-8 and invalid provider/channel never starts a network call', async () => {
  let calls = 0;
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => { calls++; return response(completion()); } });
  const large = request(); large.input.content = '中'.repeat(4500);
  assert.throws(() => prepareDeepseekRequest(large), /input_too_large/);
  assert.deepEqual(await adapter.generate(large), { status: 'failed', reason: 'input_too_large' });
  for (const altered of [{ ...request(), modelId: 'other' }, { ...request(), providerId: 'other' }, { ...request(), instruction: { channel: 'user', text: 'JSON' } }, { ...request(), instruction: { channel: 'system', text: '返回一些文字' } }]) {
    assert.equal((await adapter.generate(altered)).reason, 'invalid_request');
  }
  assert.equal(calls, 0);
});

test('transport uses one fixed HTTPS POST and reports normalized numeric usage only', async () => {
  let calls = 0, observedUsage;
  const adapter = createDeepseekAdapter({ apiKey, onUsage: u => { observedUsage = u; }, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, DEEPSEEK_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    assert.doesNotMatch(options.body, /test-key/);
    return response(completion({ usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, leaked: apiKey } }));
  } });
  assert.equal(adapter.profile, DEEPSEEK_PROFILE);
  assert.deepEqual(await adapter.generate(request()), { status: 'completed', output: candidate });
  assert.deepEqual(observedUsage, { promptTokens: 100, completionTokens: 30, totalTokens: 130, promptCacheHitTokens: 20, promptCacheMissTokens: 80 });
  assert.equal(calls, 1);
});

test('upstream failures are sanitized without reading body or retrying', async () => {
  for (const status of [400, 401, 402, 422, 429, 500, 503]) {
    let calls = 0;
    const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => { calls++; return new Response(`PRIVATE_PROVIDER_ERROR ${apiKey}`, { status }); } });
    const result = await adapter.generate(request());
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|test-key/);
    assert.equal(calls, 1);
  }
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => { throw new Error(`PRIVATE_ERROR ${apiKey}`); } });
  assert.deepEqual(await adapter.generate(request()), { status: 'failed', reason: 'provider_response_failed' });
});

test('manual redirect responses, including every 3xx status, never follow or retry', async () => {
  for (let status = 300; status < 400; status++) {
    let calls = 0;
    const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, DEEPSEEK_ENDPOINT);
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://untrusted.invalid/collect' } });
    } });
    assert.deepEqual(await adapter.generate(request()), { status: 'failed', reason: 'provider_redirect_rejected' });
    assert.equal(calls, 1);
  }
});

test('opaque redirects, followed redirects and changed URLs are rejected even with an injected transport', async () => {
  for (const [property, value] of [['type', 'opaqueredirect'], ['redirected', true], ['url', 'https://untrusted.invalid/completion']]) {
    const supplied = response(completion());
    Object.defineProperty(supplied, property, { value });
    let calls = 0;
    const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => { calls++; return supplied; } });
    assert.deepEqual(await adapter.generate(request()), { status: 'failed', reason: 'provider_redirect_rejected' });
    assert.equal(calls, 1);
  }
});

test('truncated, empty, malformed, tool and reasoning results never become completed outputs', async () => {
  const variants = [
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '  ' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{ name: 'tool' }] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}', reasoning_content: 'unexpected hidden reasoning' } }] },
    { choices: [] },
    { choices: [completion().choices[0], completion().choices[0]] },
  ];
  for (const variant of variants) {
    const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => response(variant) });
    assert.equal((await adapter.generate(request())).status, 'failed');
  }
  const malformed = createDeepseekAdapter({ apiKey, fetchImpl: async () => new Response('not JSON') });
  assert.equal((await malformed.generate(request())).status, 'failed');
});

test('response byte bound applies to both declared length and streamed bytes', async () => {
  let cancelled = false;
  const huge = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); }, cancel() { cancelled = true; } }));
  let adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => huge });
  assert.deepEqual(await adapter.generate(request()), { status: 'failed', reason: 'response_too_large' });
  assert.equal(cancelled, true);
  adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => new Response('{}', { headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } }) });
  assert.equal((await adapter.generate(request())).reason, 'response_too_large');
});

test('invalid usage is not forwarded, usage callback failure does not expose or replace model output', async () => {
  for (const usage of [{ prompt_tokens: -1, completion_tokens: 30, total_tokens: 29 }, { prompt_tokens: 100, completion_tokens: 30, total_tokens: 10 }, { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 999 }]) {
    let called = false;
    const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => response(completion({ usage })), onUsage() { called = true; } });
    assert.equal((await adapter.generate(request())).status, 'completed');
    assert.equal(called, false);
  }
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => response(completion()), onUsage: async () => { throw new Error('PRIVATE'); } });
  assert.deepEqual(await adapter.generate(request()), { status: 'completed', output: candidate });
});

test('reported usage violating configured output maximum fails closed and remains observable', async () => {
  let usage;
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => response(completion({ usage: { prompt_tokens: 100, completion_tokens: 1001, total_tokens: 1101 } })), onUsage: u => { usage = u; } });
  assert.deepEqual(await adapter.generate(request()), { status: 'failed', reason: 'usage_out_of_bounds' });
  assert.equal(usage.completionTokens, 1001);
});

test('abort before send performs no call and abort during response cancels the body', async () => {
  const controller = new AbortController();
  let calls = 0;
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => { calls++; return response(completion()); } });
  controller.abort();
  assert.deepEqual(await adapter.generate(request(), { signal: controller.signal }), { status: 'failed', reason: 'aborted' });
  assert.equal(calls, 0);
  const mid = new AbortController();
  let cancelled = false;
  const streamAdapter = createDeepseekAdapter({ apiKey, fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('\n')); }, cancel() { cancelled = true; } })) });
  const pending = streamAdapter.generate(request(), { signal: mid.signal });
  await Promise.resolve(); await Promise.resolve();
  mid.abort();
  assert.deepEqual(await pending, { status: 'failed', reason: 'aborted' });
  assert.equal(cancelled, true);
});

test('runtime timeout returns a fallback without retries even when upstream ignores abort', async () => {
  let calls = 0, resolveFetch;
  const waiting = new Promise(resolve => { resolveFetch = resolve; });
  const adapter = createDeepseekAdapter({ apiKey, fetchImpl: () => { calls++; return waiting; } });
  const session = createSession(); session.story = '散步很开心。';
  const context = buildContext({ session, revision: 1 });
  const requestBody = prepareDeepseekRequest(buildModelRequest(context, adapter.profile));
  assert.ok(requestBody.byteLength < MAX_REQUEST_BYTES);
  const result = await runCandidate({ context, adapter, isCurrent: () => true, timeoutMs: 5 });
  assert.deepEqual(result, { status: 'fallback', reason: 'timeout', candidate: null });
  resolveFetch(response(completion()));
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('invalid key options are rejected without reflecting secret values', () => {
  for (const invalid of ['', 'short', 'unsafe\r\nAuthorization: secret', '空白密钥']) {
    assert.throws(() => createDeepseekAdapter({ apiKey: invalid }), error => error.message === 'invalid_api_key');
  }
});

test('Workerd rejects the former redirect mode; native manual fetch succeeds and never follows a 302', { timeout: 30000 }, async t => {
  const { Miniflare, Response: WorkerResponse } = await import('miniflare');
  const source = readFileSync(new URL('./deepseek.mjs', import.meta.url), 'utf8');
  let mode = 'success';
  const calls = [];
  const worker = new Miniflare({
    modulesRoot: fileURLToPath(new URL('./', import.meta.url)),
    compatibilityDate: '2026-05-01',
    cf: false,
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('./workerd-test-entry.mjs', import.meta.url)), contents: `
    import { createDeepseekAdapter, DEEPSEEK_ENDPOINT } from './deepseek.mjs';
    export default { async fetch(incoming) {
      if (new URL(incoming.url).pathname === '/old-mode') {
        try { new Request(DEEPSEEK_ENDPOINT, { redirect: 'error' }); return Response.json({ accepted: true }); }
        catch (error) { return Response.json({ name: error.name }); }
      }
      const adapter = createDeepseekAdapter({ apiKey: ${JSON.stringify(apiKey)} });
      return Response.json(await adapter.generate(${JSON.stringify(request())}));
    } };` }, { type: 'ESModule', path: fileURLToPath(new URL('./deepseek.mjs', import.meta.url)), contents: source }],
    // Every outbound request is intercepted in-process. No real provider access.
    outboundService: async outgoing => {
      calls.push({ url: outgoing.url, authorization: outgoing.headers.get('Authorization') });
      if (outgoing.url !== DEEPSEEK_ENDPOINT) return new WorkerResponse(null, { status: 418 });
      if (mode === 'redirect') return new WorkerResponse(null, { status: 302, headers: { Location: 'https://untrusted.invalid/collect' } });
      return new WorkerResponse(JSON.stringify(completion()), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  t.after(() => worker.dispose());
  const old = await worker.dispatchFetch('https://worker.test/old-mode');
  assert.deepEqual(await old.json(), { name: 'TypeError' });
  assert.equal(calls.length, 0);
  const success = await worker.dispatchFetch('https://worker.test/generate');
  assert.deepEqual(await success.json(), { status: 'completed', output: candidate });
  assert.deepEqual(calls, [{ url: DEEPSEEK_ENDPOINT, authorization: `Bearer ${apiKey}` }]);
  calls.length = 0;
  mode = 'redirect';
  const rejected = await worker.dispatchFetch('https://worker.test/generate');
  assert.deepEqual(await rejected.json(), { status: 'failed', reason: 'provider_redirect_rejected' });
  assert.deepEqual(calls, [{ url: DEEPSEEK_ENDPOINT, authorization: `Bearer ${apiKey}` }]);
});
