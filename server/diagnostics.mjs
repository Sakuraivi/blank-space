// Bounded operational metadata only. Never pass requests, credentials, user
// expressions, model output, or provider error bodies into production logs.
const REASONS = new Set([
  'inactive', 'timeout', 'error', 'incomplete_response', 'generation_failed',
  'invalid_shape', 'invalid_claim', 'invalid_evidence', 'question_not_allowed', 'action_not_allowed',
  'provider_auth_failed', 'provider_balance_low', 'provider_rate_limited',
  'provider_request_rejected', 'provider_unavailable', 'provider_redirect_rejected',
  'provider_response_failed', 'response_too_large', 'invalid_response', 'usage_out_of_bounds',
  'config_changed',
]);

export function recordAiResult({ requestId, stage, status, reason }, write = console.info) {
  const event = {
    event: 'liubai_ai_result',
    requestId: typeof requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? requestId : 'unavailable',
    stage: ['reflect', 'review'].includes(stage) ? stage : 'other',
    status: ['candidate', 'fallback', 'discarded'].includes(status) ? status : 'other',
    reason: status === 'candidate' ? null : REASONS.has(reason) ? reason : 'other',
  };
  // Logging failure must not change the model result or invite another call.
  try { write(JSON.stringify(event)); } catch {}
}
