import { aiErrorMessage } from './ai-settings.mjs';
import { isClarityValidationDetail } from './clarity-contract.mjs';

const formatReasons = new Set(['invalid_shape', 'invalid_claim', 'invalid_question', 'invalid_review_stage',
  'empty_review', 'unexpected_finish', 'invalid_action', 'invalid_response', 'incomplete_response',
  'provider_response_failed', 'response_too_large']);
const boundaryReasons = new Set(['question_in_reply', 'question_not_allowed', 'repeated_question',
  'interpretation_not_allowed', 'action_not_allowed', 'action_only', 'generation_not_allowed',
  'review_event_not_allowed', 'ungrounded_event', 'correction_not_applied']);
const otherReasons = new Set(['timeout', 'network_error', 'error', 'generation_failed', 'service_unavailable',
  'provider_auth_failed', 'provider_balance_low', 'provider_rate_limited', 'provider_access_denied',
  'provider_model_unavailable', 'provider_request_rejected', 'provider_unavailable', 'provider_redirect_rejected',
  'usage_out_of_bounds', 'config_changed', 'default_unavailable', 'concurrency_limit', 'rate_limited']);

// Only fixed enums and the locally generated request ID may appear in problem
// details. Never include response bodies, source text, keys or exception messages.
export function clarityFailureInfo(reason, { requestId, validationDetail } = {}) {
  const code = formatReasons.has(reason) || boundaryReasons.has(reason) || otherReasons.has(reason) ? reason : 'other';
  const message = reason === 'timeout'
    ? '这次等待太久，已停止等待。文字还在，可以稍后重新发送；已发出的请求仍可能计费。'
    : formatReasons.has(reason)
      ? '这次回复没能完整接上，文字还在。可以重新发送，或先保留已有内容。'
      : boundaryReasons.has(reason)
        ? '这次回复没有通过内容检查，暂未展示。文字还在，可以重新发送。'
        : aiErrorMessage(reason);
  return { code, message,
    ...(typeof requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? { requestId } : {}),
    ...(isClarityValidationDetail(reason, validationDetail) ? { validationDetail } : {}) };
}
