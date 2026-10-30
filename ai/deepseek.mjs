// Provider-specific transport. Never accepts caller-selected endpoints or tools.
export const DEEPSEEK_PROFILE = Object.freeze({
  providerId: 'deepseek',
  modelId: 'deepseek-flash',
  instructionChannel: 'system',
  structuredOutput: false,
});
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const MAX_REQUEST_BYTES = 12000;
export const MAX_RESPONSE_BYTES = 128 * 1024;
export const MAX_OUTPUT_TOKENS = 1000;
const encoder = new TextEncoder();

export function prepareDeepseekRequest(request) {
  if (request?.providerId !== DEEPSEEK_PROFILE.providerId || request?.modelId !== DEEPSEEK_PROFILE.modelId ||
      request?.instruction?.channel !== 'system' || typeof request.instruction.text !== 'string' || !request.instruction.text.trim() || !/json/i.test(request.instruction.text) ||
      request?.input?.role !== 'user' || typeof request.input.content !== 'string' || !request.input.content.trim()) {
    throw new TypeError('invalid_request');
  }
  const body = JSON.stringify({
    model: DEEPSEEK_PROFILE.modelId,
    messages: [
      { role: 'system', content: request.instruction.text },
      { role: 'user', content: request.input.content },
    ],
    thinking: { type: 'disabled' },
    stream: false,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
  });
  const byteLength = encoder.encode(body).byteLength;
  if (byteLength > MAX_REQUEST_BYTES) throw new RangeError('input_too_large');
  return Object.freeze({ body, byteLength });
}

function usageFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  if (![value.prompt_tokens, value.completion_tokens, value.total_tokens].every(integer) || value.total_tokens !== value.prompt_tokens + value.completion_tokens) return null;
  const hit = value.prompt_cache_hit_tokens;
  const miss = value.prompt_cache_miss_tokens;
  if (hit !== undefined && (!integer(hit) || hit > value.prompt_tokens)) return null;
  if (miss !== undefined && (!integer(miss) || miss > value.prompt_tokens)) return null;
  if (hit !== undefined && miss !== undefined && hit + miss !== value.prompt_tokens) return null;
  return Object.freeze({
    promptTokens: value.prompt_tokens,
    completionTokens: value.completion_tokens,
    totalTokens: value.total_tokens,
    promptCacheHitTokens: hit ?? 0,
    promptCacheMissTokens: miss ?? value.prompt_tokens,
  });
}

async function boundedJson(response, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
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
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error('aborted');
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
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

const providerFailure = status => ({ status: 'failed', reason: ({
  400: 'provider_request_rejected', 401: 'provider_auth_failed', 402: 'provider_balance_low',
  422: 'provider_request_rejected', 429: 'provider_rate_limited',
})[status] ?? 'provider_unavailable' });

export function createDeepseekAdapter({ apiKey, fetchImpl = globalThis.fetch, onUsage } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 || !/^[\x21-\x7e]+$/.test(apiKey)) throw new TypeError('invalid_api_key');
  if (typeof fetchImpl !== 'function' || (onUsage !== undefined && typeof onUsage !== 'function')) throw new TypeError('invalid_adapter_options');
  return Object.freeze({
    profile: DEEPSEEK_PROFILE,
    async generate(request, { signal } = {}) {
      if (signal?.aborted) return { status: 'failed', reason: 'aborted' };
      let prepared;
      try { prepared = prepareDeepseekRequest(request); }
      catch (error) { return { status: 'failed', reason: error?.message === 'input_too_large' ? 'input_too_large' : 'invalid_request' }; }
      try {
        const response = await fetchImpl(DEEPSEEK_ENDPOINT, {
          // Workers supports manual/follow, not redirect:error. Manual keeps the
          // authorization header on this endpoint; reject redirects below.
          method: 'POST', redirect: 'manual', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: prepared.body,
        });
        if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect' || response.redirected || (response.url && response.url !== DEEPSEEK_ENDPOINT)) {
          await response.body?.cancel().catch(() => {});
          return { status: 'failed', reason: 'provider_redirect_rejected' };
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return providerFailure(response.status);
        }
        const result = await boundedJson(response, signal);
        const usage = usageFrom(result?.usage);
        if (usage && onUsage) {
          // Observability failure must not expose errors or replace the result.
          try { await onUsage(usage); } catch {}
        }
        if (usage && (usage.completionTokens > MAX_OUTPUT_TOKENS || usage.promptTokens > MAX_REQUEST_BYTES + 1000)) {
          return { status: 'failed', reason: 'usage_out_of_bounds' };
        }
        if (!Array.isArray(result?.choices) || result.choices.length !== 1) return { status: 'failed', reason: 'invalid_response' };
        const choice = result.choices[0];
        if (choice?.finish_reason !== 'stop') return { status: 'failed', reason: 'incomplete_response' };
        const message = choice.message;
        if (!message || typeof message.content !== 'string' || !message.content.trim() ||
            (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length)) ||
            (message.reasoning_content !== undefined && message.reasoning_content !== null && message.reasoning_content !== '')) {
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
