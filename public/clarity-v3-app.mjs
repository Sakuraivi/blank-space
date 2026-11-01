import { createPersonalKeyPreference } from './personal-key.mjs';
import { emptyAiStatus, normalizeAiStatus, aiSelectionProfile, canUseAiSelection, createAiSettingsDraft, changeAiSettingsProvider, changeAiSettingsModel, CUSTOM_MODEL_OPTION, sameAiRoute, aiErrorMessage } from './ai-settings.mjs';
import { CLARITY_FLOW } from './clarity-v3-contract.mjs';
import { expressionPartsV3 } from './clarity-v3-intent.mjs';
import { ClarityWaitError, waitForClarityRequest } from './clarity-wait.mjs';
import { createClaritySession, keepClarityVerbatim, addExpression, reviseExpression, wireSession, beginClarityRequest, applyClarityReply, failClarityRequest, isCurrentClarity, invalidateClarity, openClarityReview, editClarityBlock, addClarityNote, acknowledgeClarityReview, readClarityRecord, readRecordEntries, saveClarityRecord, recordText, RECORD_STORE, pauseClaritySession, resumeClaritySession, conversationControl, exportWorkingText, currentClarityReply, currentClarityUnderstanding, historicalClarityUnderstanding, reviewPresentation } from './clarity-v3-state.mjs';

const main = document.querySelector('#main'), modal = document.querySelector('#modal'), modalBody = document.querySelector('#modal-body');
const preference = createPersonalKeyPreference();
let session = createClaritySession(), status = { ...emptyAiStatus(), loading: true }, route = null, controller = null;
let draft = '', view = 'main', settings = null, editDraft = null, previousFocus = null, modalAction = null, localError = '', capacityMessage = '', settingsGeneration = 0, statusGeneration = 0, waitingSlow = false;
const e = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (text, action, primary = false, extra = '') => `<button type="button" data-action="${action}" class="${primary ? 'primary' : ''}" ${extra}>${text}</button>`;
const field = (value, label = '写下你想说的', id = 'expression', max = 4000) => `<label class="small" for="${id}">${label}</label><textarea id="${id}" rows="3" maxlength="${max}" ${session.pending && id === 'expression' ? 'readonly' : ''}>${e(value)}</textarea>`;
const usable = () => canUseAiSelection(preference.selection(), status, preference.hasKey());
function startAction() {
  const policy=conversationControl(session,draft);
  if (policy.recordOnly) return { label:'只记这句话', hint:'会原样留下，不发送给 AI。',disabled:false };
  if (policy.endRequested || policy.pauseRequested) return { label:policy.intentAction.discard?'结束，不保存':'先停在这里',hint:policy.intentAction.discard?'按你的选择结束，本次未保存内容会清除。':'不会发送新的 AI 请求，当前内容仍会保留。',disabled:false };
  return { label:usable() ? '开始聊聊' : '只记下来', disabled:status.loading,
    hint:status.loading ? '正在准备陪伴服务…' : usable() ? `点击“开始聊聊”，会把本次文字发送给 AI。${preference.selection().sourceMode === 'personal' ? '费用由你的服务商账户承担。' : ''}` : '陪伴服务暂未就绪，可以先把这件事记下来。' };
}
function updateStartAction() {
  if (session.stage !== 'express') return;
  const submit=document.querySelector('#start-submit'), hint=document.querySelector('#start-hint');
  if (!submit || !hint) return;
  const action=startAction(); submit.textContent=action.label; submit.disabled=action.disabled; hint.textContent=action.hint;
}
const clarityError = reason => reason === 'timeout' ? '这次等待有些久，已停止等待，文字仍在本页。可以重新发送，也可以先整理；已发出的请求仍可能计费。' : aiErrorMessage(reason);
const waitMessage = () => waitingSlow ? '这次回复有些慢，你可以继续等，也可以先整理。' : '正在等待回复…';
const locked = () => session.statements.length > 0;
const notice = text => { document.querySelector('#notice').textContent = text; };
function focusMain() { main.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
function resizeFields() { document.querySelectorAll('textarea').forEach(el => { el.style.height = 'auto'; el.style.height = `${Math.max(132, el.scrollHeight + 3)}px`; }); }
function clearKeyFields() { document.querySelectorAll('[data-key]').forEach(el => { el.value = ''; }); }
function openModal(title, body, variant = '') { previousFocus = document.activeElement; clearKeyFields(); modal.dataset.variant = variant; document.querySelector('#modal-title').textContent = title; modalBody.innerHTML = body; if (!modal.open) modal.showModal(); resizeFields(); }
function closeModal() { settingsGeneration++; settings = null; modalAction = null; clearKeyFields(); modal.close(); previousFocus?.isConnected && previousFocus.focus(); }
function ask(title, text, action, { cancelLabel = '取消', confirmLabel = '确认' } = {}) { openModal(title, `<p>${e(text)}</p><div class="dialog-actions">${button(e(cancelLabel), 'close')}${button(e(confirmLabel), 'confirm', true)}</div>`, 'confirm'); modalAction = action; }
function abortRequest() { controller?.abort(); controller = null; waitingSlow = false; if (session.pending) invalidateClarity(session); }
function pauseConversation() {
  controller?.abort(); controller = null; waitingSlow = false;
  pauseClaritySession(session); localError = ''; notice('先停在这里。原文和草稿还在，没有发送新的请求。'); render();
}
function cancelRequest() { pauseConversation(); }
function resumeConversation() {
  const text=draft.trim();
  if(text){
    const policy=conversationControl(session,text);
    if(['pause','end'].includes(policy.intentAction.kind)){
      try{addExpression(session,draft,{kind:expressionPartsV3(draft).content?'expression':'request'});}
      catch{capacityMessage='这次表达已到当前容量，暂停前写下的全文仍在。可以下载后再决定如何收尾。';render();return false;}
      draft='';
    }
  }
  resumeClaritySession(session);localError='';notice('');view='main';
  const hasMaterials=conversationControl(session,'').materials.length>0;
  session.stage=hasMaterials?'exploring':'express';
  if(hasMaterials&&!route&&session.callCount===0&&usable())route=routeNow();
  render();document.querySelector('#expression')?.focus();return true;
}
function endConversation() {
  pauseConversation();
  if (session.dirty || draft.trim()) ask('这次先到这里？', '还没保存的表达会从本页清除，已保存的记录会保留。', reset,
    { cancelLabel: '留在这里', confirmLabel: '结束，不保存' });
  else reset();
}
function handleLocalControl(text) {
  const policy = conversationControl(session, text);
  if (policy.intentAction.kind === 'pause') { pauseConversation(); return true; }
  if (policy.intentAction.kind === 'end') {
    if (policy.intentAction.discard) reset(); else endConversation();
    return true;
  }
  return false;
}
const workingDownload = () => button('下载这次表达', 'download-working');
const capacityNotice = () => capacityMessage ? `<p class="help-note" role="status">${e(capacityMessage)}</p>${workingDownload()}` : '';
function showLocalReview() {
  const result=openClarityReview(session);
  if(!result.ok){notice(result.reason==='no_materials'?'还没有要留下的生活内容，可以先写一点。':'当前内容还在，可以下载完整表达后再整理。');render();return false;}
  view='main';localError='';render();focusMain();return true;
}

function renderBlock(b) {
  const body = b.type === 'option-comparison' ? b.rows.map(r => `<div class="option-row"><h3>${e(r.option)}</h3><p>吸引我的：${e(r.benefit)}</p><p>需要付出：${e(r.cost)}</p><p>还不知道：${e(r.unknown)}</p></div>`).join('') : `<p>${e(b.text)}</p>`;
  const section = `<section class="review-block ${b.id === 'insight' ? 'insight' : ''}"><h3>${e(b.label)}</h3>${body}</section>`;
  // Only Host-owned original words may start collapsed. Model claims and
  // their manual edits remain visible before the single confirmation.
  return b.id==='source'&&b.group==='details'&&!b.edited ? `<details><summary>回看我的原话</summary>${section}</details>` : section;
}
function renderUnderstanding(claims,historical=false){
  return claims.length?`<section class="review-block insight"><h3>${historical?'当时一点可能的理解':'一点可能的理解'}</h3>${claims.map(c=>`<p>${e(c.text)}</p>`).join('')}</section>`:'';
}
function render() {
  if (view === 'history') {
    main.innerHTML = `<article class="paper"><h1>前面说过的</h1>${session.messages.map(m => m.role === 'user' ? (() => { const u = session.statements.find(x => x.id === m.statementId); return `<section class="history-item"><p class="small">你</p><p>${e(u.text)}</p>${button('修改这段', `revise:${u.id}`)}</section>`; })() : `<section class="history-item"><p class="small">留白</p><p>${e(m.text)}</p>${renderUnderstanding(historicalClarityUnderstanding(m),true)}${m.question ? `<p>${e(m.question)}</p>` : ''}</section>`).join('')}${button('返回当前内容', 'return', true)}</article>`;
  } else if (view === 'edit') {
    main.innerHTML = `<article class="paper"><h1>改成你的意思</h1><label for="review-title">记录名字</label><input id="review-title" maxlength="200" value="${e(editDraft.title)}">${editDraft.blocks.map((b, i) => `<section>${field(b.type === 'text' ? b.text : b.rows.map(r => `${r.option}：${r.benefit}；${r.cost}；${r.unknown}`).join('\n'), e(b.label), `edit-${i}`, 20000)}${button('移除这段', `remove:${b.id}`)}</section>`).join('')}${editDraft.removed.length ? button('恢复刚才移除的段落', 'restore') : ''}${button('自己写一段', 'add-note')}${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}${button('完成修改', 'apply-edit', true)}${button('取消修改', 'cancel-edit')}</article>`;
  } else if (session.stage === 'express') {
    const action=startAction();
    const content=session.paused
      ? `<p class="pause-note" role="status">先停在这里。原文和草稿还在，没有发送新的请求。</p>${field(draft,'暂停前写下的内容，可以修改。')}${button('继续说','resume',true)}<div class="actions">${workingDownload()}${button('结束本次','end')}</div>`
      : `<form id="expression-form">${field(draft, '零散的一两句，也可以。')}<p class="small" id="start-hint">${e(action.hint)}</p><button id="start-submit" class="primary" ${action.disabled ? 'disabled' : ''}>${action.label}</button></form>`;
    main.innerHTML = `<article class="paper welcome-paper"><div class="welcome"><h1>${session.paused?'先停在这里。':'最近，<span>有什么想聊的？</span>'}</h1><img src="/assets/cozy-room.svg" width="720" height="560" alt="" aria-hidden="true"></div>${content}${capacityNotice()}${localError ? `<p class="error" role="alert">${e(localError)}</p>` : ''}</article>`;
  } else if (session.stage === 'exploring') {
    const last = session.statements.at(-1), reply = currentClarityReply(session);
    const quote = last ? (last.text.length <= 160 ? '<p>'+e(last.text)+'</p>' : '<p>'+e(last.text.slice(0, 100))+'…</p><details><summary>展开原话</summary><p>'+e(last.text)+'</p></details>') : '';
    const pause = session.paused ? '<p class="pause-note" role="status">先停在这里。你的表达还在，没有发送新的请求。</p>'+button('继续说', 'resume', true) : '';
    const conversation = session.pending
      ? '<p class="status" role="status" data-wait-status>'+waitMessage()+'</p>'+button('暂停等待', 'cancel')
      : session.paused ? pause
      : (reply ? '<p class="companion-reply">'+e(reply.text)+'</p>' : '')+
        renderUnderstanding(currentClarityUnderstanding(session))+
        (session.failure ? '<p class="error" role="alert">这次没有收到可用的回复。</p><p class="small">'+e(clarityError(session.failure))+'</p>'+button('重新发送', 'retry') : '')+
        (session.question && !session.failure ? '<h1 class="question">'+e(session.question.text)+'</h1>' : '')+
        '<form id="expression-form">'+field(draft, '还想说的话，可以接着写。')+'<button class="primary">发送</button></form>';
    main.innerHTML = '<article class="paper"><div class="actions">'+button('查看前文', 'history')+button('结束本次', 'end')+'</div>'+
      (last ? '<blockquote class="last-word"><p class="small">你刚刚说</p>'+quote+'</blockquote>' : '')+conversation+
      capacityNotice()+(localError ? '<p class="error" role="alert">'+e(localError)+'</p>' : '')+
      '<div class="actions conversation-actions">'+button('先看已有内容', 'review')+(route && !session.pending ? button('请AI整理成一份', 'generate-review') : '')+'</div>'+
      '<details><summary>保留这次表达</summary>'+workingDownload()+'</details></article>';
  } else {
    const r = session.review;
    if (!r) { main.innerHTML='<article class="paper"><h1>先停在这里，也可以。</h1><p>还没有需要保存的整理，你可以接着说。</p>'+button('继续说', 'continue', true)+workingDownload()+button('结束本次', 'end')+'</article>'; resizeFields(); return; }
    const presentation=reviewPresentation(session);
    main.innerHTML = '<article class="paper"><div class="actions"><span class="small">'+e(presentation.label)+'</span>'+ (session.messages.length ? button('查看前文', 'history') : '')+'</div><h1>'+e(r.title)+'</h1>'+
      (session.stale ? '<p class="help-note">表达有了变化，可以直接修改并重新核对。需要时再请留白整理。</p>' : '')+
      (presentation.note ? '<p class="status" role="status">'+e(presentation.note)+'</p>' : '')+
      r.blocks.filter(b=>b.group==='main').map(renderBlock).join('')+r.blocks.filter(b=>b.group==='details').map(renderBlock).join('')+
      (!r.blocks.length ? '<p class="help-note">还没有保留内容。可以修改并恢复段落，或自己写一段。</p>' : '')+
      (session.actionProposal ? '<section class="help-note action-proposal"><h3>如果你愿意，可以这样说</h3><p>'+e(session.actionProposal.text)+'</p><div class="actions">'+button('放进这次记录', 'adopt-action')+button('先不用', 'dismiss-action')+'</div></section>' : '')+
      (session.pending ? '<p class="status" role="status" data-wait-status>'+waitMessage()+'</p>'+button('暂停等待', 'cancel') : session.stage==='kept' ? '<p class="status" role="status">已保存在这台设备。</p>' : '<p class="small">'+e(presentation.privacy)+'</p>'+button('确认并保存', 'save', true))+
      (session.paused ? '<p class="pause-note" role="status">已暂停，当前内容还在。</p>'+button('继续说', 'resume') : '')+
      (session.failure ? '<p class="error">'+e(clarityError(session.failure))+'</p>'+button('重新发送', 'retry') : '')+
      capacityNotice()+(localError ? '<p class="error" role="alert">'+e(localError)+'</p>' : '')+
      '<div class="actions">'+button('修改', 'edit')+(session.statements.length ? button('再聊一句', 'continue') : '')+button('结束本次', 'end')+'</div>'+
      (session.stale ? (route ? button('请AI重新整理成一份', 'generate-review') : '')+'<label class="small"><input id="review-rechecked" type="checkbox">我已重新核对这份整理</label>' : '')+
      (session.stage==='kept' ? '<details><summary>导出或保留表达</summary>'+(r.blocks.some(b=>b.group==='details')?'<label class="small"><input id="export-details" type="checkbox">包括原话和补充</label>':'')+'<div class="actions">'+button('下载整理文字', 'export-text')+button('导出整理图片', 'export-image')+workingDownload()+
      (route ? button('帮我想一句怎么说', 'request-action') : '')+'</div></details>' : '<details><summary>保留这次表达</summary>'+workingDownload()+'</details>')+'</article>';
  }
  resizeFields();
}

async function loadStatus() {
  const generation = ++statusGeneration;
  let nextStatus;
  try {
    const body = await waitForClarityRequest(async signal => {
      const res = await fetch('/api/ai/status', { cache: 'no-store', signal });
      return res.json();
    }, { timeoutMs: 10000 });
    nextStatus = normalizeAiStatus(body);
  } catch { nextStatus = emptyAiStatus(); }
  if (generation !== statusGeneration) return;
  status = nextStatus;
  if (session.stage === 'express' && view === 'main') render();
}
function routeNow() {
  const profile = aiSelectionProfile(preference.selection(), status);
  return profile ? { sourceMode: profile.sourceMode, providerId: profile.providerId, modelId: profile.modelId,
    ...(Number.isSafeInteger(profile.defaultRevision) ? { defaultRevision: profile.defaultRevision } : {}), configVersion: status.configVersion, consentVersion: status.consentVersion } : null;
}

async function sendToAi({ action = false, review = false } = {}) {
  if (session.pending) return;
  notice('');
  if (!route || !sameAiRoute(route, routeNow()) || route.sourceMode === 'personal' && !preference.hasKey()) { localError = '本页的 AI 服务已失效。可以先整理保存，再结束本次并重新设置。'; render(); return; }
  let ticket;
  try { ticket = beginClarityRequest(session, { action, review }); }
  catch (error) {
    if (error.message === 'no_materials') notice('先写下一点你想保留的内容，再请留白整理。');
    else if (error.message === 'generation_not_allowed' || error.message === 'local_control_required') notice('已保留你刚才的交流要求，当前没有发送新的请求。');
    else capacityMessage = '这次内容暂时无法发给留白。表达仍在，可以先看已有内容，或下载完整文字。';
    render(); return;
  }
  const active = session, requestRoute = { ...route };
  controller = new AbortController(); const requestController = controller;
  localError = ''; capacityMessage = ''; waitingSlow = false; render();
  try {
    const body = await waitForClarityRequest(async signal => {
      const requestBody = JSON.stringify({ flow: CLARITY_FLOW, ...requestRoute, requestId: ticket.requestId, revision: ticket.revision,
        stage: ticket.context.stage, allowNextStep: action, session: wireSession(active),
        ...(requestRoute.sourceMode === 'personal' ? { personalApiKey: preference.forRequest().personalApiKey } : {}) });
      // Match the API's existing JSON ingress bound before sending. Its trusted
      // provider-body bound is checked separately by the server; neither slices sources.
      if (new TextEncoder().encode(requestBody).byteLength > 24000) return { status:'fallback', reason:'context_capacity' };
      const response = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: requestBody });
      return response.json();
    }, { controller: requestController, onSlow() {
      if (active !== session || controller !== requestController || active.pending?.requestId !== ticket.requestId) return;
      waitingSlow = true;
      const message = document.querySelector('[data-wait-status]');
      if (message) message.textContent = waitMessage();
    } });
    if (active !== session || requestController.signal.aborted) return;
    if (body.status !== 'candidate') {
      const current=isCurrentClarity(active,ticket),reason=body.reason??'generation_failed';
      failClarityRequest(active,ticket,reason);
      if(current&&reason==='context_capacity'){
        active.failure=null;capacityMessage='完整内容暂时超过当前请求容量，原话仍在。可以先查看已有内容，或下载全文。';
      }
    }
    else if (!sameAiRoute(body.route, requestRoute)) failClarityRequest(active, ticket, 'config_changed');
    else {
      const current=isCurrentClarity(active,ticket),result=applyClarityReply(active,ticket,body);
      if(current&&!result.ok&&['active_claims_limit','review_capacity_exceeded'].includes(result.reason)){
        active.failure=null;capacityMessage='当前整理超过可用容量，原文和修改仍在，可以下载完整表达。';
      }
    }
  } catch (error) {
    if (active === session && controller === requestController) {
      if (error instanceof ClarityWaitError && error.reason === 'timeout') failClarityRequest(active, ticket, 'timeout');
      else if (!requestController.signal.aborted) failClarityRequest(active, ticket, 'network_error');
    }
  } finally {
    if (controller === requestController) { controller = null; if (active === session) { render(); focusMain(); } }
  }
}

async function submitExpression(event) {
  event.preventDefault(); if (session.pending || !['express','exploring'].includes(session.stage)) return;
  const text = draft.trim(); if (!text) { localError = '写下一点想说的，就可以继续。'; render(); document.querySelector('#expression')?.focus(); return; }
  if (handleLocalControl(text)) return;
  const starting = session.stage === 'express', policy = conversationControl(session,text), parts = expressionPartsV3(text);
  if (starting) {
    const local=keepClarityVerbatim(session,text);
    if (local.handled) { localError=local.ok?'':'先写下想留下的话。'; if(local.ok){draft='';route=null;notice('');} render(); if(local.ok)focusMain(); return; }
  }
  if (!starting && policy.recordOnly) {
    notice('还没有替你选择哪一句。刚写的内容仍在，可以写清想留下的原句，或在已有内容中编辑。'); render(); return;
  }
  if (starting) route = usable() ? routeNow() : null;
  try { addExpression(session,text,{kind:'expression'}); }
  catch { capacityMessage='这次内容已经比较多了，刚写的话还在输入框里。可以先保留已有内容，或下载这次完整表达。'; render(); return; }
  draft=''; capacityMessage=''; localError='';
  if (!parts.content && !policy.reviewRequested && !policy.recordOnly) {
    notice('已保留你的交流要求。可以继续说，也可以先停在这里。'); render(); return;
  }
  if (!route) { showLocalReview(); return; }
  await sendToAi({review:policy.reviewRequested});
}
async function requestReview() {
  if (session.pending) return;
  if(draft.trim()&&handleLocalControl(draft))return;
  const text=draft.trim(),policy=conversationControl(session,text||session.statements.at(-1)?.text||'');
  const needsRequest=!policy.reviewRequested;
  if (session.statements.length+(text?1:0)+(needsRequest?1:0)>12) {
    capacityMessage='这次表达已经比较多，刚写的内容仍在。可以先看已有内容，或下载这次完整表达。'; render(); return;
  }
  if (draft.trim()) {
    try { addExpression(session,draft,{kind:'expression'}); }
    catch { capacityMessage='刚写的内容还在输入框里。暂时无法生成整理，可以下载完整表达。'; render(); return; }
    draft='';
  }
  if (!route) { localError='当前没有可用的陪伴服务。可以先看已有内容，或保留原话。'; render(); return; }
  if(needsRequest) addExpression(session,'请AI整理成一份。',{kind:'request'});
  resumeClaritySession(session); await sendToAi({review:true});
}
function downloadWorking() {
  if (view==='edit') captureEdits();
  const parts=[exportWorkingText(session)];
  if (draft) parts.push('尚未发送的表达\n'+draft);
  if (editDraft) parts.push('尚未应用的修改\n'+editDraft.title+'\n'+editDraft.blocks.map(b=>b.label+'\n'+(b.text??'')).join('\n\n'));
  download(new Blob([parts.filter(Boolean).join('\n\n')],{type:'text/plain;charset=utf-8'}),'留白-这次表达.txt');
}

function settingsFields() {
  const p = status.providers.find(p => p.id === settings.providerId);
  return `<div class="fields-row"><div><label for="provider">服务商</label><select id="provider">${status.providers.map(p => `<option value="${e(p.id)}" ${settings.providerId === p.id ? 'selected' : ''}>${e(p.label)}</option>`).join('')}</select></div><div><label for="model">模型</label><select id="model">${(p?.models ?? []).map(m => `<option value="${e(m.id)}" ${settings.modelMode !== 'custom' && settings.modelId === m.id ? 'selected' : ''}>${e(m.label)}</option>`).join('')}${p?.allowCustomModels ? `<option value="${CUSTOM_MODEL_OPTION}" ${settings.modelMode === 'custom' ? 'selected' : ''}>填写模型 ID</option>` : ''}</select></div></div><div id="custom-field">${customField()}</div><label for="personal-key">API Key</label><input id="personal-key" data-key type="password" autocomplete="off" spellcheck="false" placeholder="${settings.retainExisting && preference.hasKey() ? '已在本页保留；留空继续使用' : '填写所选服务商的 API Key'}"><p class="small">${e(p?.keyHelp ?? '')}</p><p class="small">Key 只在本页临时使用，刷新或离开后清除。调用费用由你的服务商账户承担。</p>${preference.hasKey() ? button('移除本页 Key', 'clear-key') : ''}`;
}
const customField = () => settings.modelMode === 'custom' ? `<label for="custom-model">模型 ID</label><input id="custom-model" maxlength="100" value="${e(settings.modelId)}" placeholder="填写服务商提供的模型 ID">` : '';
async function showSettings() {
  if (locked()) { openModal('AI 设置', '<p>这次对话的服务已经固定。完成或结束本次后，可以更换服务。</p>'); return; }
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
  session.removed = editDraft.removed; invalidateClarity(session); session.stage = 'reviewing'; view = 'main'; editDraft = null; localError = ''; render(); focusMain();
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
function reset() { abortRequest(); session = createClaritySession(); route = null; draft = ''; view = 'main'; editDraft = null; localError = ''; capacityMessage = ''; notice(''); closeModal(); render(); }

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
  if (event.target.id === 'expression') { draft = event.target.value; session.dirty = true; updateStartAction(); }
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
    else if (action === 'home' || action === 'end') endConversation();
    else if (action === 'settings') await showSettings();
    else if (action === 'clear-key') { preference.clear(); closeModal(); render(); notice('本页的个人 Key 已清除。'); }
    else if (action === 'cancel') cancelRequest();
    else if (action === 'retry') await sendToAi({ action:session.lastRequestKind==='action',review:session.lastRequestKind==='review' });
    else if (action === 'generate-review') await requestReview();
    else if (action === 'resume') resumeConversation();
    else if (action === 'download-working') downloadWorking();
    else if (action === 'review') { abortRequest(); if (draft.trim()) { if(handleLocalControl(draft))return; if(conversationControl(session,draft).recordOnly){if(showLocalReview())notice('还未替你选择某一句。刚写的原文仍保留在草稿中，可以先编辑已有内容。');return;} try{addExpression(session,draft,{kind:'expression'});draft='';}catch{capacityMessage='刚写的话还在输入框里，可以下载完整表达。';render();return;} } showLocalReview(); }
    else if (action === 'history') { view = 'history'; render(); focusMain(); }
    else if (action === 'return') { view = 'main'; render(); focusMain(); }
    else if (action === 'revise') { const u = session.statements.find(s => s.id === id); openModal('修改前面的表达', `<form id="revise-form" data-id="${e(id)}">${field(u.text, '改成你想说的', 'revised-expression')}<p id="revise-error" class="error" role="alert"></p><button class="primary">保留修改</button></form>`); }
    else if (action === 'continue') { abortRequest(); resumeConversation(); }
    else if (action === 'edit') { abortRequest(); editDraft = structuredClone({ ...session.review, removed: session.removed }); view = 'edit'; localError = ''; render(); }
    else if (action === 'cancel-edit') { view = 'main'; editDraft = null; localError = ''; render(); }
    else if (action === 'remove') { captureEdits(); const index = editDraft.blocks.findIndex(b => b.id === id); editDraft.removed.push({ index, block: editDraft.blocks.splice(index, 1)[0] }); render(); }
    else if (action === 'restore') { captureEdits(); if (editDraft.blocks.length >= 6) { notice('已有六段，请先移除一段再恢复。'); return; } const item = editDraft.removed.pop(); if (item) editDraft.blocks.splice(item.index, 0, item.block); render(); }
    else if (action === 'add-note') { captureEdits(); if (editDraft.blocks.length >= 6) { notice('这份记录已有六段，可以修改现有内容。'); return; } editDraft.blocks.push({ id: `note_${crypto.randomUUID()}`, type: 'text', group: 'details', label: '我的补充', text: '', edited: true, claimIds: [] }); render(); document.querySelector(`#edit-${editDraft.blocks.length - 1}`)?.focus(); }
    else if (action === 'apply-edit') applyEdits();
    else if (action === 'save') { if (session.stale && document.querySelector('#review-rechecked')?.checked) acknowledgeClarityReview(session); const result = saveClarityRecord(session, localStorage); if(['review_capacity_exceeded','records_full'].includes(result.reason)){localError='';capacityMessage=result.reason==='records_full'?'本机记录空间已满，原文和修改仍在，可以下载完整表达或管理已有记录。':'这次整理超过保存容量，原文和修改还在，可以下载完整表达。';}else{localError = result.ok ? '' : ({ review_stale: '请先核对或修改这份整理，再勾选已重新核对。', empty_review: '至少保留一段内容，可以修改并恢复之前的段落。', records_full: '本机已有30份记录，请先删除部分记录。' }[result.reason] ?? '这次没有保存成功。内容仍在本页，可以重试。');if(result.ok)capacityMessage='';} render(); }
    else if (action === 'records') showRecords();
    else if (action === 'open') { const load = () => { const record = readRecordEntries(localStorage).find(x => x.record?.id === id)?.record; if (!record) return; abortRequest(); session = { ...createClaritySession(), ...record, stage: 'kept', complete: true }; route = null; draft = ''; view = 'main'; closeModal(); render(); }; if (session.dirty || draft.trim()) ask('打开另一份记录？', '本次尚未保存的内容会被清除。', load, { cancelLabel: '留在这里', confirmLabel: '打开记录' }); else load(); }
    else if (action === 'delete') ask('删除这份记录？', '仅从内测版移除；旧版已有记录和导出文件会保留。', () => { const entries = readRecordEntries(localStorage); localStorage.setItem(RECORD_STORE, JSON.stringify(entries.filter(x => x.raw?.id !== id).map(x => x.raw))); showRecords(); }, { cancelLabel: '保留记录', confirmLabel: '删除记录' });
    else if (action === 'export-text') { download(new Blob([recordText(savedRecord(), { details: document.querySelector('#export-details')?.checked })], { type: 'text/plain;charset=utf-8' }), '留白.txt'); }
    else if (action === 'export-image') { target.disabled = true; try { await exportImage(document.querySelector('#export-details')?.checked); } finally { target.disabled = false; } }
    else if (action === 'request-action') { if (!route) { notice('这份记录来自本机。开始一次新的对话后可以请 AI 帮忙。'); return; } addExpression(session, '请根据刚才的期待，帮我想一句可以怎么说。', { kind: 'request' }); session.stage = 'reviewing'; await sendToAi({ action: true }); }
    else if (action === 'adopt-action') { addClarityNote(session, session.actionProposal.text); session.review.blocks.at(-1).label = '如果我愿意，可以这样说'; session.actionProposal = null; render(); }
    else if (action === 'dismiss-action') { session.actionProposal = null; render(); }
    else if (action === 'privacy') openModal('关于留白与隐私', '<p>留白用 AI 陪你回看表达、拆解事情。理解可能不准确，你可以随时纠正或停下。</p><p>点击发送后，本次表达与已聊到的内容会经留白交给所选 AI 服务。旧记录不会自动上传。</p><p>对话与个人 Key 暂留本页，刷新或离开会清除。点击确认并保存后，确认的记录与保留的生活原话一起存在这个浏览器中；原话可在修改时移除，不保存问答过程、交流指令或 Key。共用设备的人可能看到本机记录。</p><p>默认导出主文，可自行选择包括补充区的原话与内容。页面不录音。设备键盘的语音输入由设备处理。API 调用可能收费，失败或取消也可能产生费用。</p>');
  } catch (error) {
    if(['review_capacity_exceeded','active_claims_limit','manual_context_too_large'].includes(error.message)){
      capacityMessage='这次内容超过当前整理容量，原文和修改还在，可以下载完整表达。';render();
    } else notice(error.message === 'long_record' ? '内容较长，暂时无法生成单张图片。可以选择下载文字，内容仍在本页。' : '这一步没有完成，内容仍在本页。请检查后重试。');
  }
});
modal.addEventListener('cancel', () => { settingsGeneration++; settings = null; modalAction = null; clearKeyFields(); });
window.addEventListener('beforeunload', event => { if (session.dirty || draft.trim()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { abortRequest(); preference.clear(); route = null; clearKeyFields(); draft = ''; session = createClaritySession(); view = 'main'; editDraft = null; modal.close(); modalBody.replaceChildren(); main.replaceChildren(); });
window.addEventListener('pageshow', event => { if (event.persisted) { render(); loadStatus(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.open && session.pending) cancelRequest(); });
render(); loadStatus().then(() => { if (new URL(location.href).searchParams.get('settings') === 'ai' && !locked()) showSettings(); });
