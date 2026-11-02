import { aiErrorMessage } from './ai-settings.mjs';
import { isClarityValidationDetail } from './clarity-contract.mjs';

const formatReasons = new Set(['invalid_shape', 'invalid_model_json']);
const boundaryReasons = new Set(['question_in_reply', 'question_not_allowed', 'repeated_question',
  'interpretation_not_allowed', 'action_not_allowed', 'action_only', 'generation_not_allowed',
  'review_event_not_allowed', 'invalid_review_stage', 'empty_review', 'unexpected_finish', 'invalid_action']);
const sourceReasons = new Set(['ungrounded_event', 'correction_not_applied']);
const sourceDetails = new Set(['claim_evidence', 'supersedes_unknown', 'supersedes_duplicate', 'question_evidence']);
const otherReasons = new Set(['timeout', 'network_error', 'error', 'generation_failed', 'service_unavailable',
  'provider_auth_failed', 'provider_balance_low', 'provider_rate_limited', 'provider_access_denied',
  'provider_model_unavailable', 'provider_request_rejected', 'provider_unavailable', 'provider_redirect_rejected',
  'provider_response_failed',
  'usage_out_of_bounds', 'config_changed', 'default_unavailable', 'concurrency_limit', 'rate_limited',
  'invalid_claim', 'invalid_question', 'invalid_response', 'incomplete_response', 'response_too_large']);
const labels = { format: '回复格式', source: '来源核对', conversation: '交流约定', validation: '内容核对',
  capacity: '接收容量', service: '服务或连接', unknown: '尚未分类' };

function categoryFor(reason, detail) {
  if (sourceReasons.has(reason)) return 'source';
  if (boundaryReasons.has(reason)) return 'conversation';
  if (formatReasons.has(reason)) return 'format';
  if (['invalid_claim', 'invalid_question'].includes(reason)) {
    if (!isClarityValidationDetail(reason, detail)) return 'validation';
    return sourceDetails.has(detail) ? 'source' : 'format';
  }
  if (['response_too_large', 'usage_out_of_bounds'].includes(reason)) return 'capacity';
  return otherReasons.has(reason) ? 'service' : 'unknown';
}

// Only fixed enums and the locally generated request ID may appear in problem
// details. Never include response bodies, source text, keys or exception messages.
export function clarityFailureInfo(reason, { requestId, validationDetail } = {}) {
  const code = formatReasons.has(reason) || boundaryReasons.has(reason) || sourceReasons.has(reason) || otherReasons.has(reason) ? reason : 'other';
  const detail = isClarityValidationDetail(reason, validationDetail) ? validationDetail : undefined;
  const category = categoryFor(reason, detail);
  const message = reason === 'timeout'
    ? '这次等待太久，已停止等待。文字还在，可以稍后重新发送；已发出的请求仍可能计费。'
    : category === 'format' ? '这次回复的格式没能完整读出。文字还在，可以重新发送，或先保留已有内容。'
      : category === 'source' ? '这次整理的来源或修正没能核对好，暂未采用。输入的文字还在。'
        : category === 'conversation' ? '这次回复没有符合当前的交流约定，暂未采用。输入的文字还在。'
          : category === 'validation' ? '这次回复有内容没能核对好，暂未采用。输入的文字还在。'
            : category === 'capacity' ? '这次回复超过当前接收容量，没有截断采用。输入的文字还在。'
              : aiErrorMessage(reason);
  return { code, category, categoryLabel: labels[category], message,
    ...(typeof requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? { requestId } : {}),
    ...(detail ? { validationDetail: detail } : {}) };
}
