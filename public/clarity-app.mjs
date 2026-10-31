import { createPersonalKeyPreference } from './personal-key.mjs';
import { emptyAiStatus, normalizeAiStatus, aiSelectionProfile, canUseAiSelection, createAiSettingsDraft, changeAiSettingsProvider, changeAiSettingsModel, CUSTOM_MODEL_OPTION, sameAiRoute, aiErrorMessage } from './ai-settings.mjs';
import { CLARITY_FLOW } from './clarity-contract.mjs';
import { createClaritySession, addExpression, reviseExpression, wireSession, beginClarityRequest, applyClarityReply, failClarityRequest, invalidateClarity, openClarityReview, editClarityBlock, addClarityNote, acknowledgeClarityReview, readClarityRecord, readRecordEntries, saveClarityRecord, recordText, RECORD_STORE } from './clarity-state.mjs';

const main = document.querySelector('#main'), modal = document.querySelector('#modal'), modalBody = document.querySelector('#modal-body');
const preference = createPersonalKeyPreference();
let session = createClaritySession(), status = { ...emptyAiStatus(), loading: true }, route = null, controller = null;
let draft = '', view = 'main', settings = null, editDraft = null, previousFocus = null, modalAction = null, localError = '', settingsGeneration = 0;
const e = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (text, action, primary = false, extra = '') => `<button type="button" data-action="${action}" class="${primary ? 'primary' : ''}" ${extra}>${text}</button>`;
const field = (value, label = '写下你想说的', id = 'expression', max = 4000) => `<label class="small" for="${id}">${label}</label><textarea id="${id}" rows="3" maxlength="${max}" ${session.pending && id === 'expression' ? 'readonly' : ''}>${e(value)}</textarea>`;
const usable = () => canUseAiSelection(preference.selection(), status, preference.hasKey());
const locked = () => session.statements.length > 0;
const notice = text => { document.querySelector('#notice').textContent = text; };
function focusMain() { main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function resizeFields() { document.querySelectorAll('textarea').forEach(el => { el.style.height = 'auto'; el.style.height = `${Math.max(132, el.scrollHeight + 3)}px`; }); }
function clearKeyFields() { document.querySelectorAll('[data-key]').forEach(el => { el.value = ''; }); }
function openModal(title, body, variant = '') { previousFocus = document.activeElement; clearKeyFields(); modal.dataset.variant = variant; document.querySelector('#modal-title').textContent = title; modalBody.innerHTML = body; if (!modal.open) modal.showModal(); resizeFields(); }
function closeModal() { settingsGeneration++; settings = null; modalAction = null; clearKeyFields(); modal.close(); previousFocus?.isConnected && previousFocus.focus(); }
function ask(title, text, action, { cancelLabel = '取消', confirmLabel = '确认' } = {}) { openModal(title, `<p>${e(text)}</p><div class="dialog-actions">${button(e(cancelLabel), 'close')}${button(e(confirmLabel), 'confirm', true)}</div>`, 'confirm'); modalAction = action; }
function abortRequest() { controller?.abort(); controller = null; if (session.pending) invalidateClarity(session); }
function cancelRequest() { abortRequest(); session.failure = 'inactive'; localError = '已停止等待，文字还在。已发出的请求仍可能计费。'; render(); }

function renderBlock(b) {
  const body = b.type === 'option-comparison' ? b.rows.map(r => `<div class="option-row"><h3>${e(r.option)}</h3><p>吸引我的：${e(r.benefit)}</p><p>需要付出：${e(r.cost)}</p><p>还不知道：${e(r.unknown)}</p></div>`).join('') : `<p>${e(b.text)}</p>`;
  return `<section class="review-block ${b.id === 'insight' ? 'insight' : ''}"><h3>${e(b.label)}</h3>${body}</section>`;
}
function render() {
  if (view === 'history') {
    main.innerHTML = `<article class="paper"><h1>前面说过的</h1>${session.messages.map(m => m.role === 'user' ? (() => { const u = session.statements.find(x => x.id === m.statementId); return `<section class="history-item"><p class="small">你</p><p>${e(u.text)}</p>${button('修改这段', `revise:${u.id}`)}</section>`; })() : `<section class="history-item"><p class="small">留白</p><p>${e(m.text)}</p>${m.question ? `<p>${e(m.question)}</p>` : ''}</section>`).join('')}${button('返回当前内容', 'return', true)}</article>`;
  } else if (view === 'edit') {
    main.innerHTML = `<article class="paper"><h1>改成你的意思</h1><label for="review-title">记录名字</label><input id="review-title" maxlength="200" value="${e(editDraft.title)}">${editDraft.blocks.map((b, i) => `<section>${field(b.type === 'text' ? b.text : b.rows.map(r => `${r.option}：${r.benefit}；${r.cost}；${r.unknown}`).join('\n'), e(b.label), `edit-${i}`, 20000)}${button('移除这段', `remove:${b.id}`)}</section>`).join('')}${editDraft.removed.length ? button('恢复刚才移除的段落', 'restore') : ''}${button('自己写一段', 'add-note')}${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}${button('完成修改', 'apply-edit', true)}${button('取消修改', 'cancel-edit')}</article>`;
  } else if (session.stage === 'express') {
    main.innerHTML = `<article class="paper welcome-paper"><div class="welcome"><h1>最近，<span>有什么想聊的？</span></h1><img src="/assets/cozy-room.svg" width="720" height="560" alt="" aria-hidden="true"></div><form id="expression-form">${field(draft, '零散的一两句，也可以。')}${status.loading ? '<p class="small">正在准备陪伴服务…</p>' : usable() ? `<p class="small">点击“开始聊聊”，会把本次文字发送给 AI。${preference.selection().sourceMode === 'personal' ? '费用由你的服务商账户承担。' : ''}</p>` : '<p class="small">陪伴服务暂未就绪，可以先把这件事记下来。</p>'}<button class="primary" ${status.loading ? 'disabled' : ''}>${usable() ? '开始聊聊' : '只记下来'}</button></form>${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}</article>`;
  } else if (session.stage === 'exploring') {
    const last = session.statements.at(-1), reply = session.messages.findLast(m => m.role === 'assistant');
    const quote = last.text.length <= 160 ? `<p>${e(last.text)}</p>` : `<p>${e(last.text.slice(0, 100))}…</p><details><summary>展开原话</summary><p>${e(last.text)}</p></details>`;
    main.innerHTML = `<article class="paper"><div class="actions">${button('查看前文', 'history')}${button('结束本次', 'end')}</div><blockquote class="last-word"><p class="small">你刚刚说</p>${quote}</blockquote>${session.pending ? `<p class="status" role="status">正在听你说，也在整理其中的线索…</p>${button('取消等待', 'cancel')}` : session.failure ? `<p class="error" role="alert">这次没有收到可用的回复。</p><p class="small">${e(aiErrorMessage(session.failure))}</p>${button('重新发送', 'retry', true)}` : `${reply ? `<p class="companion-reply">${e(reply.text)}</p>` : ''}${session.question ? `<h1 class="question">${e(session.question.text)}</h1>` : '<h1 class="question">还有什么想补充或纠正的？</h1>'}<form id="expression-form">${field(draft)}<button class="primary">发送</button></form>`}<div class="actions">${button('先整理', 'review')}</div>${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}</article>`;
  } else {
    const r = session.review;
    main.innerHTML = `<article class="paper">
      <div class="actions"><span class="small">${session.complete ? '这次的整理' : '目前的线索'}</span>${session.messages.length ? button('查看前文', 'history') : ''}</div>
      <h1>${e(r.title)}</h1>
      ${session.stale ? '<p class="help-note">表达有了变化，请再看一下这份整理。可以直接修改，也可以让 AI 重新理解。</p>' : ''}
      ${r.blocks.filter(b => b.group === 'main').map(renderBlock).join('')}
      ${r.blocks.filter(b => b.group === 'details').map(renderBlock).join('')}
      ${!r.blocks.length ? '<p class="error">还没有保留内容。可以修改并恢复段落，或自己写一段。</p>' : ''}
      ${session.actionProposal ? `<section class="help-note action-proposal"><h3>如果你愿意，可以这样说</h3><p>${e(session.actionProposal.text)}</p><div class="actions">${button('放进这次记录', 'adopt-action')}${button('先不用', 'dismiss-action')}</div></section>` : ''}
      ${session.pending ? `<p role="status">正在整理你的补充…</p>${button('取消等待', 'cancel')}` : session.stage === 'kept' ? '<p class="status" role="status">已保存在这台设备。</p>' : button('确认并保存', 'save', true)}
      ${session.failure ? `<p class="error">${e(aiErrorMessage(session.failure))}</p>${button('重新发送补充', 'retry')}` : ''}
      ${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}
      <div class="actions">${button('修改', 'edit')}${session.statements.length && route ? button('再聊一句', 'continue') : ''}</div>
      ${session.stale ? `${route ? button('让 AI 重新理解', 'reanalyze') : ''}<label class="small"><input id="review-rechecked" type="checkbox">我已重新核对这份整理</label>` : ''}
      ${session.stage === 'kept' ? `<details><summary>导出或继续整理</summary><label class="small"><input id="export-details" type="checkbox">包括补充内容</label><div class="actions">${button('下载文字', 'export-text')}${button('导出图片', 'export-image')}${route ? button('帮我想一句怎么说', 'request-action') : ''}${button('结束本次', 'end')}</div></details>` : ''}
    </article>`;
  }
  resizeFields();
}

async function loadStatus() {
  try { const res = await fetch('/api/ai/status', { cache: 'no-store' }); status = normalizeAiStatus(await res.json()); }
  catch { status = emptyAiStatus(); }
  if (session.stage === 'express' && view === 'main') render();
}
function routeNow() {
  const profile = aiSelectionProfile(preference.selection(), status);
  return profile ? { sourceMode: profile.sourceMode, providerId: profile.providerId, modelId: profile.modelId,
    ...(Number.isSafeInteger(profile.defaultRevision) ? { defaultRevision: profile.defaultRevision } : {}), configVersion: status.configVersion, consentVersion: status.consentVersion } : null;
}

async function sendToAi({ action = false } = {}) {
  if (session.pending) return;
  notice('');
  if (!route || !sameAiRoute(route, routeNow()) || route.sourceMode === 'personal' && !preference.hasKey()) { localError = '本页的 AI 服务已失效。可以先整理保存，再结束本次并重新设置。'; render(); return; }
  let ticket;
  try { ticket = beginClarityRequest(session, { action }); }
  catch { localError = '这次表达暂时无法发送，请先保留原话。'; render(); return; }
  const active = session, requestRoute = { ...route };
  controller = new AbortController(); const requestController = controller;
  localError = ''; render();
  try {
    const response = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: requestController.signal,
      body: JSON.stringify({ flow: CLARITY_FLOW, ...requestRoute, requestId: ticket.requestId, revision: ticket.revision,
        stage: ticket.context.stage, allowNextStep: action, session: wireSession(active),
        ...(requestRoute.sourceMode === 'personal' ? { personalApiKey: preference.forRequest().personalApiKey } : {}) }) });
    const body = await response.json();
    if (active !== session || requestController.signal.aborted) return;
    if (body.status !== 'candidate') failClarityRequest(active, ticket, body.reason ?? 'generation_failed');
    else if (!sameAiRoute(body.route, requestRoute)) failClarityRequest(active, ticket, 'config_changed');
    else applyClarityReply(active, ticket, body);
  } catch { if (active === session && !requestController.signal.aborted) failClarityRequest(active, ticket, 'network_error'); }
  finally { if (controller === requestController) controller = null; if (active === session) { render(); focusMain(); } }
}

async function submitExpression(event) {
  event.preventDefault(); if (session.pending) return;
  const text = draft.trim(); if (!text) { localError = '写下一点想说的，就可以继续。'; render(); document.querySelector('#expression')?.focus(); return; }
  const starting = session.stage === 'express';
  if (starting && !usable()) { addExpression(session, text); draft = ''; openClarityReview(session); render(); return; }
  if (starting) route = routeNow();
  try { addExpression(session, text, { kind: starting || session.question ? 'expression' : 'correction' }); draft = ''; }
  catch { localError = '这次内容已经比较多了，可以先整理已有表达。'; render(); return; }
  await sendToAi();
}

function settingsFields() {
  const p = status.providers.find(p => p.id === settings.providerId);
  return `<div class="fields-row"><div><label for="provider">服务商</label><select id="provider">${status.providers.map(p => `<option value="${e(p.id)}" ${settings.providerId === p.id ? 'selected' : ''}>${e(p.label)}</option>`).join('')}</select></div><div><label for="model">模型</label><select id="model">${(p?.models ?? []).map(m => `<option value="${e(m.id)}" ${settings.modelMode !== 'custom' && settings.modelId === m.id ? 'selected' : ''}>${e(m.label)}</option>`).join('')}${p?.allowCustomModels ? `<option value="${CUSTOM_MODEL_OPTION}" ${settings.modelMode === 'custom' ? 'selected' : ''}>填写模型 ID</option>` : ''}</select></div></div><div id="custom-field">${customField()}</div><label for="personal-key">API Key</label><input id="personal-key" data-key type="password" autocomplete="off" spellcheck="false" placeholder="${settings.retainExisting && preference.hasKey() ? '已在本页保留；留空继续使用' : '填写所选服务商的 API Key'}"><p class="small">${e(p?.keyHelp ?? '')}</p><p class="small">Key 只在本页临时使用，刷新或离开后清除。调用费用由你的服务商账户承担。</p>${preference.hasKey() ? button('移除本页 Key', 'clear-key') : ''}`;
}
const customField = () => settings.modelMode === 'custom' ? `<label for="custom-model">模型 ID</label><input id="custom-model" maxlength="100" value="${e(settings.modelId)}" placeholder="填写服务商提供的模型 ID">` : '';
async function showSettings() {
  const generation = ++settingsGeneration;
  await loadStatus(); if (generation !== settingsGeneration) return;
  if (locked()) { openModal('AI 设置', '<p>这次对话的服务已经固定。完成或结束本次后，可以更换服务。</p>'); return; }
  settings = createAiSettingsDraft(preference.selection(), status);
  openModal('AI 设置', `<p class="small">选择留白陪伴，或使用自己的服务。设置不会发送你的文字。</p><form id="settings-form"><fieldset><legend>使用哪种服务？</legend><label class="source-choice"><input type="radio" name="source" value="default" ${settings.sourceMode === 'default' ? 'checked' : ''}><span>留白陪伴<small>${status.defaultEnabled ? '为你准备，无需配置' : '暂未开放'}</small></span></label><label class="source-choice"><input type="radio" name="source" value="personal" ${settings.sourceMode === 'personal' ? 'checked' : ''}><span>使用个人 API Key<small>由你的服务商账户付费</small></span></label></fieldset><div id="settings-fields">${settings.sourceMode === 'personal' ? settingsFields() : '<p class="small">你可以先慢慢写，点击开始聊聊时才会发送。</p>'}</div><p id="settings-error" class="error" role="alert"></p><button class="primary" ${!status.providers.length ? 'disabled' : ''}>确认设置</button></form>`);
}

function captureEdits() {
  editDraft.title = document.querySelector('#review-title').value;
  editDraft.blocks.forEach((b, i) => { const value = document.querySelector(`#edit-${i}`)?.value; if (value !== undefined) { if (b.type !== 'text') { b.type = 'text'; delete b.rows; } b.text = value; } });
}
function applyEdits() {
  captureEdits();
  if (!editDraft.title.trim() || editDraft.blocks.some(b => !b.text.trim())) { localError = '请给记录起个名字；空白段落可以移除。'; render(); return; }
  abortRequest();
  for (const b of editDraft.blocks) if (session.review.blocks.some(old => old.id === b.id)) editClarityBlock(session, b.id, b.text);
  const old = new Map(session.review.blocks.map(b => [b.id, b]));
  session.review = { title: editDraft.title.trim(), blocks: editDraft.blocks.map(b => ({ ...b, edited: b.edited || old.get(b.id)?.edited || !old.has(b.id) })) };
  session.removed = editDraft.removed; invalidateClarity(session); session.stage = 'reviewing'; view = 'main'; localError = ''; render(); focusMain();
}
function savedRecord() { return readClarityRecord({ formatVersion: 2, id: session.id, modeId: session.modeId === 'auto' ? 'concern' : session.modeId, createdAt: session.createdAt, confirmed: true, review: session.review }); }
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
async function exportImage(details) {
  const record = savedRecord(); if (!record) return;
  // Measure and draw with the same loaded face; a slow font must not block export.
  const loaded = await Promise.race([
    document.fonts.load('400 28px "KN Maiyuan"', recordText(record, { details })).then(faces => faces.length > 0).catch(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), 2500)),
  ]);
  const fontFamily = loaded ? '"KN Maiyuan", "PingFang SC", "Microsoft YaHei", sans-serif' : 'system-ui, "Microsoft YaHei", sans-serif';
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); if (!ctx) throw Error();
  const width = 1000, pad = 70, lines = [];
  const add = (value, size, weight, gap = 0) => {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    for (const p of value.split('\n')) {
      let line = '';
      for (const ch of p) {
        const measured = ctx.measureText(line + ch).width;
        const hangingPunctuation = /^[，。！？；：、）》】”’]$/.test(ch) && measured <= width - pad;
        if (line && measured > width - pad * 2 && !hangingPunctuation) { lines.push({ text: line, size, weight }); line = ''; }
        line += ch;
      }
      lines.push({ text: line, size, weight });
    }
    if (gap) lines.push({ text: '', size: gap, weight: 400 });
  };
  add(record.review.title, 38, 400, 18);
  for (const b of record.review.blocks.filter(b => details || b.group === 'main')) { add(b.label, 26, 400, 6); add(b.type === 'text' ? b.text : b.rows.map(r => `${r.option}\n吸引我的：${r.benefit}\n需要付出：${r.cost}\n还不知道：${r.unknown}`).join('\n\n'), 28, 400, 20); }
  const height = pad * 2 + lines.reduce((n, l) => n + l.size * 1.8, 0); if (height > 24000) throw Error('long_record');
  canvas.width = width; canvas.height = height; ctx.fillStyle = '#fffaf3'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#3e2f3d'; let y = pad;
  for (const l of lines) { ctx.font = `${l.weight} ${l.size}px ${fontFamily}`; y += l.size * 1.4; ctx.fillText(l.text, pad, y); y += l.size * .4; }
  const blob = await new Promise((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(Error()), 'image/png')); download(blob, '留白.png');
}
function showRecords() {
  try { const entries = readRecordEntries(localStorage).filter(x => x.record); openModal('我的记录', `<p class="small">保存在这个浏览器中；内测版与旧版分开保存。</p>${entries.length ? entries.map(({ record: r }) => `<div class="record-row">${button(e(r.review.title), `open:${r.id}`)}<small>${e(new Date(r.createdAt).toLocaleDateString('zh-CN'))}</small>${button('删除', `delete:${r.id}`)}</div>`).join('') : '<p>还没有保存的记录。</p>'}`); }
  catch { notice('暂时无法读取本机记录。原有数据没有被覆盖。'); }
}
function reset() { abortRequest(); session = createClaritySession(); route = null; draft = ''; view = 'main'; editDraft = null; localError = ''; closeModal(); render(); }

document.addEventListener('submit', async event => {
  if (event.target.id === 'expression-form') return submitExpression(event);
  if (event.target.id === 'settings-form') {
    event.preventDefault(); if (!settings || locked()) return;
    const result = preference.apply({ ...settings, apiKey: document.querySelector('#personal-key')?.value ?? '' }, status.providers);
    if (!result.ok) { document.querySelector('#settings-error').textContent = result.reason === 'missing_personal_key' ? '请填写所选服务商的 API Key。' : '请检查模型 ID 和 Key 格式。'; return; }
    closeModal(); render(); notice('设置已确认，还没有发送你的文字。');
  }
  if (event.target.id === 'revise-form') {
    event.preventDefault(); const id = event.target.dataset.id, value = document.querySelector('#revised-expression').value;
    if (!value.trim()) { document.querySelector('#revise-error').textContent = '请保留一点想表达的内容。'; return; }
    abortRequest(); reviseExpression(session, id, value); closeModal(); render(); notice('表达已修改。已有整理保留，需重新核对；没有自动调用 AI。');
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'expression') { draft = event.target.value; session.dirty = true; }
  if (event.target.id === 'custom-model' && settings) { settings.modelId = event.target.value; settings.retainExisting = false; }
  if (event.target.tagName === 'TEXTAREA') { event.target.style.height = 'auto'; event.target.style.height = `${Math.max(132, event.target.scrollHeight + 3)}px`; }
});
document.addEventListener('change', event => {
  if (!settings || locked()) return;
  if (event.target.name === 'source') { clearKeyFields(); settings.sourceMode = event.target.value; document.querySelector('#settings-fields').innerHTML = settings.sourceMode === 'personal' ? settingsFields() : '<p class="small">点击开始聊聊时才会发送你的文字。</p>'; }
  if (event.target.id === 'provider') {
    clearKeyFields(); settings = changeAiSettingsProvider(settings, event.target.value, status);
    // Keep the native provider select mounted so selection closes normally.
    const p = status.providers.find(p => p.id === settings.providerId);
    document.querySelector('#model').innerHTML = p.models.map(m => `<option value="${e(m.id)}">${e(m.label)}</option>`).join('') + (p.allowCustomModels ? `<option value="${CUSTOM_MODEL_OPTION}">填写模型 ID</option>` : '');
    document.querySelector('#custom-field').innerHTML = ''; document.querySelector('#personal-key').placeholder = '填写所选服务商的 API Key';
    document.querySelector('#personal-key').nextElementSibling.textContent = p.keyHelp;
  }
  if (event.target.id === 'model') { settings = changeAiSettingsModel(settings, event.target.value, status); document.querySelector('#custom-field').innerHTML = customField(); }
});
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  const [action, id] = target.dataset.action.split(':');
  try {
    if (action === 'close') closeModal();
    else if (action === 'confirm') { const fn = modalAction; closeModal(); fn?.(); }
    else if (action === 'home' || action === 'end') { if (session.dirty || draft.trim()) ask('这次先到这里？', '尚未保存的内容会从本页清除。已保存的记录会保留。', reset, { cancelLabel: session.stage === 'express' ? '继续写' : session.stage === 'exploring' ? '继续聊聊' : '继续整理', confirmLabel: '结束本次' }); else reset(); }
    else if (action === 'settings') await showSettings();
    else if (action === 'clear-key') { preference.clear(); closeModal(); render(); notice('本页的个人 Key 已清除。'); }
    else if (action === 'cancel') cancelRequest();
    else if (action === 'retry' || action === 'reanalyze') await sendToAi({ action: action === 'retry' && session.lastRequestAction });
    else if (action === 'review') { abortRequest(); if (draft.trim()) { addExpression(session, draft, { kind: 'correction' }); draft = ''; } openClarityReview(session); view = 'main'; localError = ''; render(); focusMain(); }
    else if (action === 'history') { view = 'history'; render(); focusMain(); }
    else if (action === 'return') { view = 'main'; render(); focusMain(); }
    else if (action === 'revise') { const u = session.statements.find(s => s.id === id); openModal('修改前面的表达', `<form id="revise-form" data-id="${e(id)}">${field(u.text, '改成你想说的', 'revised-expression')}<p id="revise-error" class="error" role="alert"></p><button class="primary">保留修改</button></form>`); }
    else if (action === 'continue') { abortRequest(); session.stage = 'exploring'; localError = ''; view = 'main'; render(); document.querySelector('#expression')?.focus(); }
    else if (action === 'edit') { abortRequest(); editDraft = structuredClone({ ...session.review, removed: session.removed }); view = 'edit'; localError = ''; render(); }
    else if (action === 'cancel-edit') { view = 'main'; editDraft = null; localError = ''; render(); }
    else if (action === 'remove') { captureEdits(); const index = editDraft.blocks.findIndex(b => b.id === id); editDraft.removed.push({ index, block: editDraft.blocks.splice(index, 1)[0] }); render(); }
    else if (action === 'restore') { captureEdits(); if (editDraft.blocks.length >= 6) { notice('已有六段，请先移除一段再恢复。'); return; } const item = editDraft.removed.pop(); if (item) editDraft.blocks.splice(item.index, 0, item.block); render(); }
    else if (action === 'add-note') { captureEdits(); if (editDraft.blocks.length >= 6) { notice('这份记录已有六段，可以修改现有内容。'); return; } editDraft.blocks.push({ id: `note_${crypto.randomUUID()}`, type: 'text', group: 'details', label: '我的补充', text: '', edited: true, claimIds: [] }); render(); document.querySelector(`#edit-${editDraft.blocks.length - 1}`)?.focus(); }
    else if (action === 'apply-edit') applyEdits();
    else if (action === 'save') { if (session.stale && document.querySelector('#review-rechecked')?.checked) acknowledgeClarityReview(session); const result = saveClarityRecord(session, localStorage); localError = result.ok ? '' : ({ review_stale: '请先核对或修改这份整理，再勾选已重新核对。', empty_review: '至少保留一段内容，可以修改并恢复之前的段落。', records_full: '本机已有30份记录，请先删除部分记录。' }[result.reason] ?? '这次没有保存成功。内容仍在本页，可以重试。'); render(); }
    else if (action === 'records') showRecords();
    else if (action === 'open') { const load = () => { const record = readRecordEntries(localStorage).find(x => x.record?.id === id)?.record; if (!record) return; abortRequest(); session = { ...createClaritySession(), ...record, stage: 'kept', complete: true }; route = null; draft = ''; view = 'main'; closeModal(); render(); }; if (session.dirty || draft.trim()) ask('打开另一份记录？', '本次尚未保存的内容会被清除。', load, { cancelLabel: '留在这里', confirmLabel: '打开记录' }); else load(); }
    else if (action === 'delete') ask('删除这份记录？', '仅从内测版移除；旧版已有记录和导出文件会保留。', () => { const entries = readRecordEntries(localStorage); localStorage.setItem(RECORD_STORE, JSON.stringify(entries.filter(x => x.raw?.id !== id).map(x => x.raw))); showRecords(); }, { cancelLabel: '保留记录', confirmLabel: '删除记录' });
    else if (action === 'export-text') { download(new Blob([recordText(savedRecord(), { details: document.querySelector('#export-details')?.checked })], { type: 'text/plain;charset=utf-8' }), '留白.txt'); }
    else if (action === 'export-image') { target.disabled = true; try { await exportImage(document.querySelector('#export-details')?.checked); } finally { target.disabled = false; } }
    else if (action === 'request-action') { if (!route) { notice('这份记录来自本机。开始一次新的对话后可以请 AI 帮忙。'); return; } addExpression(session, '请根据刚才的期待，帮我想一句可以怎么说。', { kind: 'request' }); session.stage = 'reviewing'; await sendToAi({ action: true }); }
    else if (action === 'adopt-action') { addClarityNote(session, session.actionProposal.text); session.review.blocks.at(-1).label = '如果我愿意，可以这样说'; session.actionProposal = null; render(); }
    else if (action === 'dismiss-action') { session.actionProposal = null; render(); }
    else if (action === 'privacy') openModal('关于留白与隐私', '<p>留白用 AI 陪你回看表达、拆解事情。理解可能不准确，你可以随时纠正或停下。</p><p>点击发送后，本次表达与已聊到的内容会经留白交给所选 AI 服务。旧记录不会自动上传。</p><p>对话与个人 Key 暂留本页，刷新或离开会清除。点击确认并保存后，只把确认的整理留在这个浏览器中，不另存原始对话。共用设备的人可能看到本机记录。</p><p>页面不录音。设备键盘的语音输入由设备处理。API 调用可能收费，失败或取消也可能产生费用。</p>');
  } catch (error) { notice(error.message === 'long_record' ? '内容较长，暂时无法生成单张图片。可以选择下载文字，内容仍在本页。' : '这一步没有完成，内容仍在本页。请检查后重试。'); }
});
modal.addEventListener('cancel', () => { settingsGeneration++; settings = null; modalAction = null; clearKeyFields(); });
window.addEventListener('beforeunload', event => { if (session.dirty || draft.trim()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { abortRequest(); preference.clear(); route = null; clearKeyFields(); draft = ''; session = createClaritySession(); view = 'main'; editDraft = null; modal.close(); modalBody.replaceChildren(); main.replaceChildren(); });
window.addEventListener('pageshow', event => { if (event.persisted) { render(); loadStatus(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.open && session.pending) cancelRequest(); });
render(); loadStatus().then(() => { if (new URL(location.href).searchParams.get('settings') === 'ai' && !locked()) showSettings(); });
