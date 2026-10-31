import { isTrustedRoute } from './providers.mjs';

export const MAX_RESPONSE_BYTES = 128 * 1024;
export const MAX_ERROR_BYTES = 4096;
const encoder = new TextEncoder();
const trustedRoute = isTrustedRoute;

export function prepareProviderRequest(request, route) {
  if (!trustedRoute(route)) throw new TypeError('invalid_route');
  if (request?.providerId !== route.providerId || request?.modelId !== route.modelId ||
      request?.instruction?.channel !== route.profile.instructionChannel ||
      typeof request.instruction.text !== 'string' || !request.instruction.text.trim() || !/json/i.test(request.instruction.text) ||
      request?.input?.role !== 'user' || typeof request.input.content !== 'string' || !request.input.content.trim()) {
    throw new TypeError('invalid_request');
  }
  const body = {
    model: route.modelId,
    messages: [
      { role: route.profile.instructionChannel, content: request.instruction.text },
      { role: 'user', content: request.input.content },
    ],
    stream: false,
  };
  if (route.transportMode === 'generic-chat') {
    // A custom ID does not prove support for vendor/model-specific options.
    // The common platform instruction still requires JSON, and the same
    // candidate validator checks the result before it can reach the UI.
    if (route.providerId === 'bailian') {
      // These exact aliases are documented non-thinking Qwen configurations.
      // Unknown IDs may name models from other vendors on the same platform.
      const legacyQwen = ['qwen-plus', 'qwen-flash'].includes(route.modelId);
      body[legacyQwen ? 'max_tokens' : 'max_completion_tokens'] = route.maxOutputTokens;
      // Documented hybrid-thinking aliases. Keep unknown/custom IDs generic.
      // https://help.aliyun.com/en/model-studio/deep-thinking (2026-10-31)
      if (legacyQwen || ['qwen3.8-flash', 'qwen3.8-max', 'qwen3.8-max-0902'].includes(route.modelId)) body.enable_thinking = false;
    } else if (route.providerId === 'openai') {
      body.max_completion_tokens = route.maxOutputTokens;
      body.store = false;
    } else body.max_tokens = route.maxOutputTokens;
  } else if (route.providerId === 'kimi') {
    body.reasoning_effort = 'low';
    body.max_completion_tokens = route.maxOutputTokens;
    body.prompt_cache_options = { mode: 'implicit', ttl: '5m' };
  } else if (route.providerId === 'openai') {
    body.reasoning_effort = 'none';
    body.max_completion_tokens = route.maxOutputTokens;
    body.store = false;
    body.service_tier = 'default';
  } else {
    body.thinking = { type: 'disabled' };
    body.max_tokens = route.maxOutputTokens;
  }
  if (route.transportMode !== 'generic-chat') body.response_format = { type: 'json_object' };
  const serialized = JSON.stringify(body);
  const byteLength = encoder.encode(serialized).byteLength;
  if (byteLength > route.maxRequestBytes) throw new RangeError('input_too_large');
  return Object.freeze({ body: serialized, byteLength });
}

function normalizedUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  if (![value.prompt_tokens, value.completion_tokens, value.total_tokens].every(integer) || value.total_tokens !== value.prompt_tokens + value.completion_tokens) return null;
  const prompt = value.prompt_tokens, completion = value.completion_tokens;
  let hit = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens ?? value.cached_tokens ?? 0;
  let write = value.prompt_tokens_details?.cache_write_tokens ?? 0;
  let miss = value.prompt_cache_miss_tokens ?? (prompt - hit - write);
  let reasoning = value.completion_tokens_details?.reasoning_tokens ?? 0;
  // Bad optional detail must never hide valid billable totals or bypass the
  // per-request bounds. Ignore broken cache discounts conservatively instead.
  if (![hit, write, miss].every(integer) || hit + write + miss !== prompt) {
    hit = 0; write = 0; miss = prompt;
  }
  if (!integer(reasoning) || reasoning > completion) reasoning = 0;
  return Object.freeze({
    promptTokens: prompt, completionTokens: completion, totalTokens: value.total_tokens,
    promptCacheHitTokens: hit, promptCacheMissTokens: miss,
    promptCacheWriteTokens: write, reasoningTokens: reasoning,
  });
}

async function boundedJson(response, signal, maxBytes) {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('response_too_large');
  }
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let length = 0, content = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error('aborted');
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('response_too_large');
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Only fixed enum comparisons may escape this function. Never return/log the
// raw response message or body, even if a provider echoes credentials or prose.
async function providerFailure(response, route, signal) {
  const status = response.status;
  let reason = ({
    400: 'provider_request_rejected', 401: 'provider_auth_failed',
    402: 'provider_balance_low', 403: 'provider_access_denied',
    404: 'provider_model_unavailable', 422: 'provider_request_rejected', 429: 'provider_rate_limited',
  })[status] ?? 'provider_unavailable';
  if (!['kimi', 'glm', 'openai', 'bailian'].includes(route.providerId) || ![400, 403, 404, 429].includes(status)) {
    await response.body?.cancel().catch(() => {});
    return { status: 'failed', reason };
  }
  let error;
  try { error = (await boundedJson(response, signal, MAX_ERROR_BYTES))?.error; }
  catch {
    return { status: 'failed', reason: signal?.aborted ? 'aborted' : reason };
  }
  if (route.providerId === 'kimi' && status === 429 && error?.type === 'exceeded_current_quota_error') reason = 'provider_balance_low';
  if (route.providerId === 'glm') {
    if (status === 429 && (error?.code === '1113' || error?.code === 1113)) reason = 'provider_balance_low';
    if (status === 400 && ['1211', '1221', '1222'].includes(String(error?.code))) reason = 'provider_model_unavailable';
  }
  if (route.providerId === 'openai' && status === 429 && (error?.code === 'insufficient_quota' || error?.type === 'insufficient_quota')) reason = 'provider_balance_low';
  if (route.providerId === 'bailian' && ((status === 403 && error?.code === 'AllocationQuota.FreeTierOnly') || (status === 400 && error?.code === 'Arrearage'))) reason = 'provider_balance_low';
  return { status: 'failed', reason };
}

export function createProviderAdapter({ route, apiKey, fetchImpl = globalThis.fetch, onUsage } = {}) {
  if (!trustedRoute(route)) throw new TypeError('invalid_route');
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 || !/^[\x21-\x7e]+$/.test(apiKey)) throw new TypeError('invalid_api_key');
  if (typeof fetchImpl !== 'function' || (onUsage !== undefined && typeof onUsage !== 'function')) throw new TypeError('invalid_adapter_options');
  return Object.freeze({
    profile: route.profile,
    async generate(request, { signal } = {}) {
      if (signal?.aborted) return { status: 'failed', reason: 'aborted' };
      let prepared;
      try { prepared = prepareProviderRequest(request, route); }
      catch (error) { return { status: 'failed', reason: error?.message === 'input_too_large' ? 'input_too_large' : 'invalid_request' }; }
      try {
        const response = await fetchImpl(route.endpoint, {
          method: 'POST', redirect: 'manual', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: prepared.body,
        });
        if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect' || response.redirected || (response.url && response.url !== route.endpoint)) {
          await response.body?.cancel().catch(() => {});
          return { status: 'failed', reason: 'provider_redirect_rejected' };
        }
        if (!response.ok) return await providerFailure(response, route, signal);
        const result = await boundedJson(response, signal, MAX_RESPONSE_BYTES);
        const usage = normalizedUsage(result?.usage);
        if (usage && onUsage) {
          try { await onUsage(usage); } catch {}
        }
        // Known over-limit primary counters remain a stop signal even when a
        // contradictory total prevents them from becoming normalized usage.
        const exceeds = (value, maximum) => Number.isSafeInteger(value) && value > maximum;
        if (exceeds(result?.usage?.completion_tokens, route.maxOutputTokens) || exceeds(result?.usage?.prompt_tokens, route.maxPromptTokens)) {
          return { status: 'failed', reason: 'usage_out_of_bounds' };
        }
        if (!Array.isArray(result?.choices) || result.choices.length !== 1) return { status: 'failed', reason: 'invalid_response' };
        const choice = result.choices[0];
        if (choice?.finish_reason !== 'stop') return { status: 'failed', reason: 'incomplete_response' };
        const message = choice.message;
        if (!message || typeof message.content !== 'string' || !message.content.trim() ||
            (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length)) ||
            (message.refusal !== undefined && message.refusal !== null && message.refusal !== '') ||
            (message.reasoning_content !== undefined && message.reasoning_content !== null &&
              (typeof message.reasoning_content !== 'string' || (route.providerId !== 'kimi' && route.transportMode !== 'generic-chat' && message.reasoning_content !== '')))) {
          return { status: 'failed', reason: 'invalid_response' };
        }
        return { status: 'completed', output: JSON.parse(message.content) };
      } catch (error) {
        const reason = signal?.aborted ? 'aborted' : error?.message === 'response_too_large' ? 'response_too_large' : 'provider_response_failed';
        return { status: 'failed', reason };
      }
    },
  });
}
