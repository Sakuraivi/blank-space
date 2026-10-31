// Server-owned provider targets. Personal callers can choose a model ID, never
// an endpoint or shared-budget price. Shared routes remain a closed catalog.
export const PRICE_VALID_UNTIL = Date.parse('2026-11-06T00:00:00+08:00');
const PRICE_VERSION = 'official-2026-10-30-v1';
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const definitions = [
  {
    id: 'deepseek', label: 'DeepSeek', keyHelp: '使用 DeepSeek 开放平台的 API Key。',
    modelId: 'deepseek-flash', modelLabel: 'DeepSeek Flash',
    note: '轻量复盘，关闭深度思考；每次最多生成 1000 tokens。',
    endpoint: 'https://api.deepseek.com/chat/completions', instructionChannel: 'system',
    maxOutputTokens: 1000, inputRate: 2, outputRate: 8, reserveMicros: 50000,
  },
  {
    id: 'kimi', label: 'Kimi', keyHelp: '使用 Kimi 开放平台中国站的按量 API Key；Kimi 会员、Kimi Code 和国际站 Key 不适用。',
    modelId: 'kimi-k3.1-pro', modelLabel: 'Kimi K3.1 Pro',
    note: '低推理强度，费用较高；每次最多生成 2000 tokens（含思考），实际效果待验证。',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions', instructionChannel: 'system',
    maxOutputTokens: 2000, inputRate: 13, outputRate: 68, reserveMicros: 400000,
  },
  {
    id: 'glm', label: 'GLM（智谱）', keyHelp: '使用智谱开放平台中国站的标准 API Key；GLM Coding Plan 和 Z.ai 国际站 Key 不适用。',
    modelId: 'glm-4.7-flash', modelLabel: 'GLM 4.7 Flash',
    note: '轻量复盘，关闭深度思考；当前官方免费，仍有平台调用边界。',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', instructionChannel: 'system',
    maxOutputTokens: 1000, inputRate: 0, outputRate: 0, reserveMicros: 50000,
  },
  {
    id: 'openai', label: 'OpenAI', keyHelp: '使用 OpenAI API 项目的 API Key；ChatGPT 或 Codex 登录令牌不适用。',
    modelId: 'gpt-6-luna', modelLabel: 'GPT-6 Luna',
    note: '轻量复盘，关闭推理；按 OpenAI API 账户计费，与订阅分开。',
    endpoint: 'https://api.openai.com/v1/chat/completions', instructionChannel: 'developer',
    // Budget assumption: USD 1 = CNY 10, including 1.25x cache-write input.
    maxOutputTokens: 1000, inputRate: 1.25, outputRate: 5, reserveMicros: 50000,
  },
  {
    id: 'bailian', label: '阿里云百炼', keyHelp: '使用阿里云百炼标准 API Key；模型权限与费用由你的百炼账户承担。',
    modelId: 'qwen3.8-flash', modelLabel: 'Qwen3.8 Flash', personalOnly: true,
    note: '轻量复盘，关闭思考；每次完整输出最多 2000 tokens，实际效果待验证。',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    maxOutputTokens: 2000,
  },
];

const trustedRoutes = new WeakSet();
const issueRoute = value => { const route = freeze(value); trustedRoutes.add(route); return route; };
const routes = definitions.filter(d => !d.personalOnly).map(d => issueRoute({
  providerId: d.id, modelId: d.modelId, providerLabel: d.label, modelLabel: d.modelLabel,
  endpoint: d.endpoint,
  profile: { providerId: d.id, modelId: d.modelId, instructionChannel: d.instructionChannel, structuredOutput: false },
  maxRequestBytes: 12000, maxPromptTokens: 13000, maxOutputTokens: d.maxOutputTokens,
  inputRateCnyPerMillion: d.inputRate, outputRateCnyPerMillion: d.outputRate,
  reserveMicros: d.reserveMicros, priceVersion: PRICE_VERSION,
}));

const catalog = freeze(definitions.map(d => ({
  id: d.id, label: d.label, keyHelp: d.keyHelp, defaultModelId: d.modelId,
  allowCustomModels: true,
  ...(d.personalOnly ? { personalOnly: true } : {}),
  models: [{ id: d.modelId, label: d.modelLabel, note: d.note }],
})));

export function getRoute(providerId, modelId) {
  return routes.find(route => route.providerId === providerId && route.modelId === modelId) ?? null;
}

export function validPersonalModelId(modelId) {
  return typeof modelId === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_./:-]{0,99}$/.test(modelId) && !modelId.includes('://');
}

export function getPersonalRoute(providerId, modelId) {
  const definition = definitions.find(value => value.id === providerId);
  if (!definition || !validPersonalModelId(modelId)) return null;
  const known = getRoute(providerId, modelId);
  if (known) return known;
  return issueRoute({
    providerId, modelId, providerLabel: definition.label, modelLabel: modelId,
    endpoint: definition.endpoint, transportMode: 'generic-chat',
    profile: { providerId, modelId, instructionChannel: 'system', structuredOutput: false },
    maxRequestBytes: 12000, maxPromptTokens: 13000, maxOutputTokens: definition.maxOutputTokens,
    // Unpriced means unknown, never a zero-cost claim or a shared-budget route.
    inputRateCnyPerMillion: null, outputRateCnyPerMillion: null,
    reserveMicros: 0, priceVersion: 'personal-unpriced-v1',
  });
}

export const isTrustedRoute = route => !!route && trustedRoutes.has(route);

// No endpoints, credentials, caller-provided models or private source data.
export function publicProviders() { return catalog; }
