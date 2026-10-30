// Public catalog and page-choice helpers. No storage, network or credentials.
export const AI_CONFIG_VERSION = 'multi-v1';
export const AI_CONSENT_VERSION = 'multi-provider-v1';
const PROVIDERS = new Set(['deepseek', 'kimi', 'glm', 'openai']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const modelId = value => bounded(value, 100) && /^[a-zA-Z0-9_./:-]+$/.test(value);
export const emptyAiStatus = () => ({ enabled: false, loading: false, providers: [], defaultProfile: null, defaultAvailable: false, defaultEnabled: false, personalKeySupported: false });

export function findAiProfile(providers, providerId, selectedModelId) {
  const provider = Array.isArray(providers) ? providers.find(value => value.id === providerId) : null;
  const model = Array.isArray(provider?.models) ? provider.models.find(value => value.id === selectedModelId) : null;
  return provider && model ? { providerId: provider.id, modelId: model.id, providerLabel: provider.label, modelLabel: model.label, keyHelp: provider.keyHelp, modelNote: model.note } : null;
}

export function normalizeAiStatus(value) {
  if (!plain(value) || value.configVersion !== AI_CONFIG_VERSION || value.consentVersion !== AI_CONSENT_VERSION || !Array.isArray(value.providers)) return emptyAiStatus();
  const seen = new Set();
  const providers = value.providers.flatMap(provider => {
    if (!plain(provider) || !PROVIDERS.has(provider.id) || seen.has(provider.id) || !bounded(provider.label, 120) || !Array.isArray(provider.models)) return [];
    const modelIds = new Set();
    const models = provider.models.slice(0, 8).flatMap(model => {
      if (!plain(model) || !modelId(model.id) || modelIds.has(model.id) || !bounded(model.label, 120)) return [];
      modelIds.add(model.id);
      return [{ id: model.id, label: model.label, note: bounded(model.note, 1500) ? model.note : '' }];
    });
    if (!models.length || !models.some(model => model.id === provider.defaultModelId)) return [];
    seen.add(provider.id);
    return [{ id: provider.id, label: provider.label, keyHelp: bounded(provider.keyHelp, 1500) ? provider.keyHelp : '', defaultModelId: provider.defaultModelId, models }];
  });
  const defaultProfile = findAiProfile(providers, value.defaultProfile?.providerId, value.defaultProfile?.modelId);
  const defaultAvailable = value.defaultAvailable === true && Boolean(defaultProfile);
  return {
    enabled: value.enabled === true && providers.length > 0, loading: false, providers,
    configVersion: value.configVersion, consentVersion: value.consentVersion,
    personalKeySupported: value.personalKeySupported === true,
    defaultAvailable, defaultEnabled: value.defaultEnabled === true && defaultAvailable,
    defaultProfile: defaultAvailable ? defaultProfile : null,
    defaultReason: bounded(value.defaultReason, 100) ? value.defaultReason : null,
    reason: bounded(value.reason, 100) ? value.reason : null,
    remainingCalls: Number.isSafeInteger(value.remainingCalls) && value.remainingCalls >= 0 ? value.remainingCalls : null,
    remainingBudgetCny: Number.isFinite(value.remainingBudgetCny) && value.remainingBudgetCny >= 0 ? value.remainingBudgetCny : null,
  };
}

export function aiSelectionProfile(selection, status) {
  if (selection?.sourceMode === 'default') return status.defaultProfile ? { sourceMode: 'default', ...status.defaultProfile } : null;
  if (selection?.sourceMode !== 'personal') return null;
  const profile = findAiProfile(status.providers, selection.providerId, selection.modelId);
  return profile ? { sourceMode: 'personal', ...profile } : null;
}

export function canUseAiSelection(selection, status, hasKey) {
  return Boolean(status.enabled && aiSelectionProfile(selection, status) &&
    (selection.sourceMode === 'personal' ? status.personalKeySupported && hasKey : status.defaultEnabled));
}

// This draft contains public selection metadata only; key text stays in the form.
export function createAiSettingsDraft(applied, status) {
  const personal = applied?.sourceMode === 'personal' && findAiProfile(status.providers, applied.providerId, applied.modelId);
  const provider = status.providers.find(value => value.id === personal?.providerId) ?? status.providers[0];
  return {
    sourceMode: personal ? 'personal' : status.defaultAvailable ? 'default' : 'personal',
    providerId: provider?.id ?? '', modelId: personal?.modelId ?? provider?.defaultModelId ?? '',
    retainExisting: Boolean(personal),
  };
}

export function changeAiSettingsProvider(draft, providerId, status) {
  const provider = status.providers.find(value => value.id === providerId);
  return { ...draft, providerId: provider?.id ?? '', modelId: provider?.defaultModelId ?? '', retainExisting: false };
}

export function sameAiRoute(first, second) {
  return Boolean(first && second && ['default', 'personal'].includes(first.sourceMode) && PROVIDERS.has(first.providerId) && modelId(first.modelId) &&
    first.sourceMode === second.sourceMode && first.providerId === second.providerId && first.modelId === second.modelId);
}

export function aiErrorMessage(reason, providerLabel = '所选服务商') {
  if (reason === 'missing_personal_key') return '个人 API Key 尚未填写。本次没有改用默认服务，请保留原话后完成设置。';
  if (reason === 'invalid_personal_key') return 'API Key 格式不正确。请先保留原话，再结束本次并在 AI 设置中更换。';
  if (reason === 'provider_auth_failed') return `这次使用的 Key 未通过 ${providerLabel} 验证。没有改用其他 Key 重试，你的输入仍在本页。`;
  if (reason === 'provider_access_denied') return `${providerLabel} 暂未允许这次调用，请检查 Key 的平台、产品及访问权限。你的输入仍在本页。`;
  if (['provider_model_unavailable', 'unsupported_model'].includes(reason)) return `${providerLabel} 的所选模型暂不可用。请先保留原话，结束本次后检查模型或账户权限。`;
  if (['invalid_source', 'unsupported_provider'].includes(reason)) return '这次的服务选择不可用。请先保留原话，结束本次后重新选择 AI 服务。';
  if (reason === 'default_unavailable') return '组织者的默认服务还未就绪。请先保留原话，结束本次后可选择个人服务。';
  if (reason === 'usage_out_of_bounds') return '本轮用量需要组织者检查，AI 已暂停。你的输入仍在本页。';
  if (reason === 'provider_rate_limited') return `${providerLabel} 暂时繁忙，没有自动重试。你的输入仍在本页，可以按原话整理。`;
  if (reason === 'provider_balance_low') return `这次使用的 ${providerLabel} 账户余额或可用额度不足。你的输入仍在本页，可以按原话整理。`;
  if (['config_changed', 'consent_changed', 'consent_required', 'consent_mismatch'].includes(reason)) return 'AI 配置已变化，本次没有继续发送。请先保存原话，再回首页重新选择。';
  if (['budget_exhausted', 'call_limit', 'quota_exceeded'].includes(reason)) return '组织者的共享体验额度暂时不可用。你的输入仍在本页，可以继续本地记录，或结束本次后使用个人服务。';
  if (reason === 'session_limit') return '本次体验已达到 5 次调用上限。你的输入仍在本页，可以按原话整理。';
  if (['concurrency_limit', 'rate_limited'].includes(reason)) return '目前同时体验的人有些多，没有自动重试。你的输入仍在本页，可以按原话整理。';
  if (['disabled', 'not_configured', 'pricing_expired'].includes(reason)) return '本轮 AI 体验暂时不可用。你的输入仍在本页，可以继续本地记录。';
  if (['input_too_large_or_invalid', 'context_too_large'].includes(reason)) return '这次的表达有些长，AI 暂时没有继续。你可以先按原话保存，或返回把本次想聊的部分写得简短些。';
  return 'AI 暂时没有给出可用的整理。你的输入仍在本页，可以按原话继续。';
}
