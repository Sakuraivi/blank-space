// Bounded operational metadata only. Never pass requests, credentials, user
// expressions, model output, or provider error bodies into production logs.
import { getRoute, getPersonalRoute } from '../ai/providers.mjs';
import { sanitizedRequestTimings } from './request-timing.mjs';
import { isClaimValidationDetail } from '../public/clarity-contract.mjs';
const REASONS = new Set([
  'inactive', 'timeout', 'error', 'incomplete_response', 'generation_failed',
  'invalid_shape', 'invalid_claim', 'invalid_evidence', 'question_not_allowed', 'action_not_allowed',
  'provider_auth_failed', 'provider_balance_low', 'provider_rate_limited',
  'provider_access_denied', 'provider_model_unavailable',
  'provider_request_rejected', 'provider_unavailable', 'provider_redirect_rejected',
  'provider_response_failed', 'response_too_large', 'invalid_response', 'usage_out_of_bounds',
  'config_changed', 'ungrounded_event', 'correction_not_applied',
]);

export function recordAiResult({ requestId, stage, status, reason, providerId, modelId, sourceMode, timings, validationDetail }, write = console.info) {
  const event = {
    event: 'liubai_ai_result',
    requestId: typeof requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? requestId : 'unavailable',
    stage: ['reflect', 'review'].includes(stage) ? stage : 'other',
    status: ['candidate', 'fallback', 'discarded'].includes(status) ? status : 'other',
    reason: status === 'candidate' ? null : REASONS.has(reason) ? reason : 'other',
  };
  const route = getRoute(providerId, modelId);
  if (route && ['default', 'personal'].includes(sourceMode)) event.route = { providerId: route.providerId, modelId: route.modelId, sourceMode };
  else if (sourceMode === 'personal' && getPersonalRoute(providerId, modelId)) {
    // A caller may put a private fine-tune name or even a secret in this field.
    // Ledger/request matching retain the ID; operational logs do not echo it.
    event.route = { providerId, modelId: 'custom', sourceMode };
  }
  const safeTimings = sanitizedRequestTimings(timings);
  if (safeTimings) event.timings = safeTimings;
  if (status === 'fallback' && reason === 'invalid_claim' && isClaimValidationDetail(validationDetail)) event.validationDetail = validationDetail;
  // Logging failure must not change the model result or invite another call.
  try { write(JSON.stringify(event)); } catch {}
}
