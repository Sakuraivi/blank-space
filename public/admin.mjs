import { AI_CONFIG_VERSION, AI_CONSENT_VERSION, CUSTOM_MODEL_OPTION, normalizeAiStatus } from './ai-settings.mjs';

const $ = selector => document.querySelector(selector);
const modelIdValid = value => typeof value === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_./:-]{0,99}$/.test(value) && !value.includes('://');
const rateValid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const countValid = value => Number.isSafeInteger(value) && value >= 0;
const optionalRate = value => value === null || rateValid(value);
const optionalCount = value => value === null || countValid(value);
const money = value => `¥${value.toFixed(2)}`;
const number = value => new Intl.NumberFormat('zh-CN').format(value);
let snapshot = null;
let busy = false;
let conflict = false;

const errors = {
  invalid_password: '管理口令不正确，请重新输入。',
  rate_limited: '尝试次数较多，请稍后再验证。',
  admin_unconfigured: '管理入口尚未开通，请联系站点组织者。',
  service_unavailable: '暂时无法读取服务，请稍后重试。',
  maintenance: '服务正在维护，请稍后重试。',
  origin_rejected: '验证来源不匹配，请从本站重新打开管理页面。',
  invalid_config: '配置尚不完整，请检查服务商、模型和使用上限。',
  invalid_key: 'Key 格式不正确；更换服务商时需填写新的 Key。',
  invalid_pricing: '单价可同时留空，或填写两项有效值；设置金额上限时需提供完整参考单价。',
  config_conflict: '配置已在别处更新。请点击「重新读取配置」，再继续修改。',
};
const passwordErrors = {
  current_password_invalid: '当前管理口令不正确，请重新输入。',
  invalid_password: '新口令需为 15–128 个字符，请重新输入。',
  password_mismatch: '两次输入的新口令不一致，请重新输入。',
  password_unchanged: '新口令需与当前口令不同，请重新输入。',
  credentials_conflict: '管理口令已在别处更新，请退出后使用最新口令重新登录。',
  rate_limited: '修改尝试较多，请稍后再试。',
  service_unavailable: '暂时无法修改口令，请稍后重试。',
};

function clearSensitiveDrafts() {
  for (const id of ['password', 'api-key', 'current-password', 'new-password', 'confirm-password']) $(`#${id}`).value = '';
}

function message(target, text = '', error = false) {
  $(target).textContent = text;
  $(target).dataset.error = String(error);
}

function setBusy(value) {
  busy = value;
  if (value) clearSensitiveDrafts();
  $('#login-fields').disabled = value;
  $('#config-fields').disabled = value || conflict;
  $('#password-fields').disabled = value;
  $('#logout').disabled = value;
  $('#refresh-config').disabled = value;
  $('#toggle-service').disabled = value || conflict || !snapshot?.config.hasKey;
  $('#clear-key').disabled = value || conflict || !snapshot?.config.hasKey;
  $('#config-form').setAttribute('aria-busy', String(value));
  $('#password-form').setAttribute('aria-busy', String(value));
}

function showLogin(text = '', error = Boolean(text)) {
  snapshot = null;
  conflict = false;
  clearSensitiveDrafts();
  $('#security-settings').open = false;
  message('#password-message');
  $('#boot-status').hidden = true;
  $('#console-view').hidden = true;
  $('#login-view').hidden = false;
  $('#logout').hidden = true;
  message('#login-message', text, error);
  setBusy(false);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/organizer/${path}`, {
    method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errors[result.reason] || '操作暂未完成，请稍后重试。');
    error.status = response.status;
    error.reason = result.reason;
    throw error;
  }
  return result;
}

function readStatus(value) {
  const catalog = normalizeAiStatus({ configVersion: AI_CONFIG_VERSION, consentVersion: AI_CONSENT_VERSION, enabled: true, providers: value?.catalog }).providers.map(provider => ({
    ...provider, models: provider.models.map(model => {
      const price = value.catalog.find(item => item.id === provider.id)?.models?.find(item => item.id === model.id);
      return { ...model, inputRate: rateValid(price?.inputRate) ? price.inputRate : null, outputRate: rateValid(price?.outputRate) ? price.outputRate : null };
    }),
  }));
  const config = value?.config;
  const budget = value?.budget;
  if (!catalog.length || !countValid(config?.revision) || !catalog.some(provider => provider.id === config.providerId) || !modelIdValid(config.modelId) || !['catalog', 'manual'].includes(config.pricingMode) || typeof config.enabled !== 'boolean' || typeof config.hasKey !== 'boolean' || !optionalCount(config.callLimit) || !optionalRate(config.budgetCny) || !optionalCount(budget?.remainingCalls) || !optionalRate(budget.remainingBudgetCny) || !countValid(budget.usedCalls) || !countValid(budget.sharedPromptTokens) || !countValid(budget.sharedCompletionTokens) || !rateValid(budget.reservedCny)) throw new Error('invalid_status');
  return { ...value, catalog };
}

function selectedProvider() { return snapshot?.catalog.find(provider => provider.id === $('#provider').value); }
function selectedModel() { return selectedProvider()?.models.find(model => model.id === $('#model').value); }
function appendOption(select, value, label, selected = false) {
  const option = document.createElement('option');
  option.value = value; option.textContent = label; option.selected = selected;
  select.append(option);
}

function updateKeyHelp() {
  const provider = selectedProvider();
  const retained = snapshot.config.hasKey && snapshot.config.providerId === provider?.id;
  $('#api-key').placeholder = retained ? '留空保留服务端已有 Key' : '填写所选服务商的 API Key';
  $('#api-key').required = !retained;
  $('#key-help').textContent = provider?.keyHelp || '填写所选服务商官方平台的 API Key。';
  $('#key-retention').textContent = retained ? 'Key 已加密保存，不会回填。同一服务商更换模型时，留空即可保留。' : 'Key 加密保存在服务端，不会回填。更换服务商需要提供新的 Key。';
  $('#key-state').textContent = retained ? '已有 Key' : '需要填写';
}

function updatePricing() {
  const manual = $('#pricing-mode').value === 'manual';
  const budgetLimited = $('#budget-limit').value !== '';
  $('#manual-pricing').hidden = !manual;
  $('#input-rate').required = manual && budgetLimited;
  $('#output-rate').required = manual && budgetLimited;
  $('#input-rate').disabled = !manual;
  $('#output-rate').disabled = !manual;
  const model = selectedModel();
  $('#catalog-price').textContent = !manual && model ? `预设参考价：输入 ${model.inputRate} 元、输出 ${model.outputRate} 元 / 百万 tokens。` : '两项单价都留空时，继续监控调用和 tokens，不估算未知价格。';
}

function updateModelFields({ saved = false } = {}) {
  const custom = $('#model').value === CUSTOM_MODEL_OPTION;
  $('#custom-model-field').hidden = !custom;
  $('#custom-model').required = custom;
  $('#custom-model').disabled = !custom;
  if (!custom) $('#custom-model').value = '';
  const model = selectedModel();
  const catalogPrice = model && rateValid(model.inputRate) && rateValid(model.outputRate);
  $('#pricing-mode').replaceChildren();
  if (catalogPrice) appendOption($('#pricing-mode'), 'catalog', '使用预设参考价');
  appendOption($('#pricing-mode'), 'manual', '填写参考单价');
  $('#pricing-mode').value = saved && snapshot.config.pricingMode === 'manual' ? 'manual' : catalogPrice ? 'catalog' : 'manual';
  $('#input-rate').value = saved && rateValid(snapshot.config.inputRate) ? String(snapshot.config.inputRate) : '';
  $('#output-rate').value = saved && rateValid(snapshot.config.outputRate) ? String(snapshot.config.outputRate) : '';
  if (!catalogPrice) $('#pricing-details').open = true;
  updatePricing();
  updateKeyHelp();
}

function updateProviderFields({ saved = false } = {}) {
  const provider = selectedProvider();
  $('#model').replaceChildren();
  const modelId = saved ? snapshot.config.modelId : provider.defaultModelId;
  for (const model of provider.models) appendOption($('#model'), model.id, model.label, model.id === modelId);
  if (provider.allowCustomModels) appendOption($('#model'), CUSTOM_MODEL_OPTION, '填写其他模型 ID', !provider.models.some(model => model.id === modelId));
  $('#custom-model').value = saved ? modelId : '';
  updateModelFields({ saved });
}

function renderStatus() {
  const { config, budget, availability } = snapshot;
  $('#provider').replaceChildren();
  for (const provider of snapshot.catalog) appendOption($('#provider'), provider.id, provider.label, provider.id === config.providerId);
  $('#api-key').value = '';
  $('#enabled').checked = config.enabled;
  $('#call-limit').value = config.callLimit === null ? '' : String(config.callLimit);
  $('#budget-limit').value = config.budgetCny === null ? '' : String(config.budgetCny);
  $('#pricing-details').open = config.pricingMode === 'manual';
  $('#limits-details').open = config.callLimit !== null || config.budgetCny !== null;
  updateProviderFields({ saved: true });
  const provider = selectedProvider();
  $('#saved-profile').textContent = config.hasKey ? `${provider.label} · ${provider.models.find(model => model.id === config.modelId)?.label || config.modelId}` : '尚未保存共享 Key';
  $('#service-state').textContent = availability?.enabled ? '已开放' : '未开放';
  $('#service-state').dataset.active = String(availability?.enabled === true);
  const reasons = { budget_exhausted: '已达到设置的共享参考预算，个人 Key 仍可使用。', call_limit: '已达到设置的共享调用上限，个人 Key 仍可使用。', pricing_expired: '参考价格已过期，请更新服务配置。', not_configured: '先填写服务商、模型和 Key，再选择是否启用。', disabled: '默认服务已停用；访客仍可使用个人 Key 或轻引导。' };
  $('#availability-note').textContent = availability?.enabled ? '访客可以选择这项服务，并在开始前确认发送和费用说明。' : reasons[availability?.reason] || (config.enabled ? '配置已启用，服务暂不可用。请检查配置与已设置的上限。' : '默认服务暂未开放；保存设置时可选择启用。');
  $('#toggle-service').textContent = config.enabled ? '停用默认 AI' : '启用默认 AI';
  $('#used-calls').textContent = number(budget.usedCalls);
  $('#used-tokens').textContent = `${number(budget.sharedPromptTokens)} / ${number(budget.sharedCompletionTokens)}`;
  $('#reserved-budget').textContent = money(budget.reservedCny);
  const remainingCalls = budget.remainingCalls === null ? '不限' : `${number(budget.remainingCalls)} 次`;
  const remainingBudget = budget.remainingBudgetCny === null ? '不限' : money(budget.remainingBudgetCny);
  $('#remaining-summary').textContent = `剩余调用：${remainingCalls}；参考预算：${remainingBudget}。`;
  $('#updated-at').textContent = Number.isFinite(config.updatedAt) ? `最近保存：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(config.updatedAt))}` : '尚未保存后台配置。';
  $('#boot-status').hidden = true;
  $('#login-view').hidden = true;
  $('#console-view').hidden = false;
  $('#logout').hidden = false;
}

async function loadStatus(text = '') {
  snapshot = readStatus(await api('status'));
  conflict = false;
  renderStatus();
  message('#config-message', text);
}

function handleError(error, target = '#config-message') {
  if (error.status === 401) { showLogin('登录已过期，请重新验证。'); return; }
  if (error.status === 409) conflict = true;
  message(target, error instanceof TypeError || error.name === 'TimeoutError' ? '连接暂未完成，请稍后重试。' : errors[error.reason] || '操作暂未完成，请稍后重试。', true);
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const password = $('#password').value;
  $('#password').value = '';
  setBusy(true); message('#login-message');
  try { await api('login', { method: 'POST', body: { password } }); await loadStatus(); }
  catch (error) { if (error.reason === 'invalid_password') message('#login-message', errors.invalid_password, true); else handleError(error, '#login-message'); }
  finally { setBusy(false); }
});

$('#provider').addEventListener('change', () => {
  if (busy || conflict || !snapshot) return;
  $('#api-key').value = '';
  updateProviderFields(); message('#config-message');
});
$('#model').addEventListener('change', () => { if (!busy && !conflict && snapshot) { updateModelFields(); message('#config-message'); } });
$('#pricing-mode').addEventListener('change', updatePricing);
$('#budget-limit').addEventListener('input', updatePricing);

$('#config-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || conflict || !snapshot) return;
  const provider = selectedProvider();
  const modelId = $('#model').value === CUSTOM_MODEL_OPTION ? $('#custom-model').value : $('#model').value;
  if (!modelIdValid(modelId)) { message('#config-message', '模型 ID 需为 1–100 位英文、数字或 _ . / : -，不能填写网址或空格。', true); return; }
  const pricingMode = $('#pricing-mode').value;
  if (['#call-limit', '#budget-limit'].some(id => $(id).validity.badInput)) { $('#limits-details').open = true; message('#config-message', errors.invalid_config, true); return; }
  if (pricingMode === 'manual' && ['#input-rate', '#output-rate'].some(id => $(id).validity.badInput)) { $('#pricing-details').open = true; message('#config-message', errors.invalid_pricing, true); return; }
  const inputRate = pricingMode === 'catalog' ? selectedModel()?.inputRate : $('#input-rate').value === '' ? null : Number($('#input-rate').value);
  const outputRate = pricingMode === 'catalog' ? selectedModel()?.outputRate : $('#output-rate').value === '' ? null : Number($('#output-rate').value);
  const callLimit = $('#call-limit').value === '' ? null : Number($('#call-limit').value);
  const budgetCny = $('#budget-limit').value === '' ? null : Number($('#budget-limit').value);
  if (!optionalCount(callLimit) || !optionalRate(budgetCny)) { $('#limits-details').open = true; message('#config-message', '次数上限需为非负整数，预算需为非负金额；留空可不设上限。', true); return; }
  if (!(inputRate === null && outputRate === null || rateValid(inputRate) && rateValid(outputRate)) || budgetCny !== null && (inputRate === null || outputRate === null)) { $('#pricing-details').open = true; message('#config-message', errors.invalid_pricing, true); return; }
  const apiKey = $('#api-key').value.trim();
  if (!apiKey && !(snapshot.config.hasKey && snapshot.config.providerId === provider.id)) { message('#config-message', '更换服务商时，请填写对应的新 Key。', true); return; }
  if (apiKey && !/^[\x21-\x7e]{16,256}$/.test(apiKey)) { message('#config-message', errors.invalid_key, true); return; }
  const body = { expectedRevision: snapshot.config.revision, providerId: provider.id, modelId, pricingMode, inputRate, outputRate, apiKey, enabled: $('#enabled').checked, callLimit, budgetCny };
  $('#api-key').value = ''; setBusy(true); message('#config-message');
  try { await api('config', { method: 'POST', body }); await loadStatus('设置已保存，尚未调用模型。'); }
  catch (error) { handleError(error); }
  finally { setBusy(false); }
});

$('#toggle-service').addEventListener('click', async () => {
  if (busy || conflict || !snapshot?.config.hasKey) return;
  setBusy(true); $('#api-key').value = '';
  try { const enabled = !snapshot.config.enabled; await api('enabled', { method: 'POST', body: { expectedRevision: snapshot.config.revision, enabled } }); await loadStatus(enabled ? '默认 AI 已启用。' : '默认 AI 已停用。'); }
  catch (error) { handleError(error); }
  finally { setBusy(false); }
});
$('#clear-key').addEventListener('click', async () => {
  if (busy || conflict || !snapshot?.config.hasKey || !window.confirm('清除服务端共享 Key 并停用默认 AI？历史使用记录和预算消耗会保留。')) return;
  setBusy(true); $('#api-key').value = '';
  try { await api('config', { method: 'DELETE', body: { expectedRevision: snapshot.config.revision } }); await loadStatus('共享 Key 已清除，默认 AI 已停用。'); }
  catch (error) { handleError(error); }
  finally { setBusy(false); }
});
$('#refresh-config').addEventListener('click', async () => {
  if (busy) return; setBusy(true); $('#api-key').value = '';
  try { await loadStatus('已重新读取服务端配置。'); }
  catch (error) { handleError(error); }
  finally { setBusy(false); }
});
$('#logout').addEventListener('click', async () => {
  if (busy) return; setBusy(true); $('#api-key').value = ''; $('#password').value = '';
  try { await api('logout', { method: 'POST', body: {} }); showLogin(); }
  catch (error) { handleError(error); }
  finally { setBusy(false); }
});
$('#security-settings').addEventListener('toggle', () => {
  if (!$('#security-settings').open) { clearSensitiveDrafts(); message('#password-message'); }
});
$('#cancel-password').addEventListener('click', () => {
  if (busy) return;
  clearSensitiveDrafts(); message('#password-message');
  $('#security-settings').open = false;
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !snapshot || $('#console-view').hidden) return;
  const currentPassword = $('#current-password').value;
  const newPassword = $('#new-password').value;
  const confirmPassword = $('#confirm-password').value;
  // Keep exact Unicode input only in this request scope; never trim or normalize.
  clearSensitiveDrafts(); message('#password-message');
  if (!currentPassword) { message('#password-message', '请输入当前管理口令后重试。', true); return; }
  const length = [...newPassword].length;
  if (length < 15 || length > 128) { message('#password-message', passwordErrors.invalid_password, true); return; }
  if (newPassword !== confirmPassword) { message('#password-message', passwordErrors.password_mismatch, true); return; }
  if (newPassword === currentPassword) { message('#password-message', passwordErrors.password_unchanged, true); return; }
  setBusy(true);
  try {
    const result = await api('password', { method: 'POST', body: { currentPassword, newPassword, confirmPassword } });
    if (result.changed !== true || result.authenticated !== false) throw new Error('invalid_password_response');
    showLogin('管理口令已更新，请用新口令登录', false);
  } catch (error) {
    if (error.status === 401 && error.reason !== 'current_password_invalid') handleError(error, '#password-message');
    else message('#password-message', passwordErrors[error.reason] || (error instanceof TypeError || error.name === 'TimeoutError' ? '暂时未能确认修改结果，请重新登录核实。' : '口令修改暂未完成，请稍后重试。'), true);
  } finally {
    clearSensitiveDrafts();
    setBusy(false);
  }
});
window.addEventListener('pagehide', clearSensitiveDrafts);
window.addEventListener('pageshow', event => { if (event.persisted) initialize(); });

async function initialize() {
  setBusy(true);
  try { const session = await api('session'); if (session.authenticated === true) await loadStatus(); else showLogin(); }
  catch (error) { showLogin(errors[error.reason] || '暂时无法确认管理会话，请稍后重新验证。'); }
  finally { setBusy(false); }
}
initialize();
