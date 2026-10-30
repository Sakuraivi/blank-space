import { MODES, CARDS, createSession, makeReview, validateSavedRecord, shouldWarnBeforeUnload, aiEvidence, validateUiCandidate, makeAiReview, confirmedRecord, aiRequestSession, acceptsAiReply } from './core.mjs';
import { createPersonalKeyPreference } from './personal-key.mjs';
import { emptyAiStatus, normalizeAiStatus, aiSelectionProfile, canUseAiSelection, createAiSettingsDraft, changeAiSettingsProvider, findAiProfile, sameAiRoute, aiErrorMessage as providerErrorMessage } from './ai-settings.mjs';

const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
const STORE = 'liubai.records.v1';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = '<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const windowIcon = '<svg viewBox="0 0 70 85" aria-hidden="true"><path d="M12 73V35a23 23 0 0 1 46 0v38M35 12v61M12 45h46M6 73h58"/><path d="M22 63c3-9 10-9 13 0m6-8h8"/></svg>';
let state = { screen: 'home', modeId: 'moment', session: null, question: 0 };
let noticeTimer;
let pendingAction = null;
let focusBeforeModal = null;
let feedbackDraft = {};
let aiStatus = { ...emptyAiStatus(), loading: true };
let aiSettingsDraft = null;
let pendingAiConsent = null;
let activeAiController = null;
const personalKey = createPersonalKeyPreference();
const aiState = options => ({ enabled: Boolean(options), revision: 0, requestId: null, status: 'idle', candidate: null, answer: '', verdict: '', correction: '', allowNextStep: false, reviewKind: 'local', reviewSources: {}, ...options });
const hasAI = () => Boolean(state.ai?.enabled);
const getMode = () => MODES.find(m => m.id === (state.session?.modeId || state.modeId));
const getCard = () => CARDS.find(c => c.id === state.session?.cardId);
const dateLabel = value => new Intl.DateTimeFormat('zh-CN', { year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Shanghai' }).format(new Date(value));
const fileDate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function notify(message) { clearTimeout(noticeTimer); const n=document.querySelector('#notice'); n.textContent=message; n.classList.add('show'); noticeTimer=setTimeout(()=>{n.classList.remove('show');n.textContent='';},4200); }
function invalidateAI() { activeAiController?.abort(); activeAiController=null;if(state.ai){state.ai.revision++;state.ai.requestId=null;if(state.ai.status==='loading')state.ai.status='idle';} }
function go(screen) { invalidateAI();state.screen=screen; render(); window.scrollTo({top:0,behavior:'instant'}); main.focus({preventScroll:true}); }
function capture() {
  if(!state.session) return;
  const input=document.querySelector('#entry');
  if(input) {
    if(state.screen==='story')state.session.story=input.value;
    if(state.screen==='focus')state.session.focus=input.value;
    if(state.screen==='card')state.session.cardReflection=input.value;
    if(state.screen==='reflect'){if(hasAI())state.ai.answer=input.value;else state.session.answers[getMode().questions[state.question].id]=input.value;}
  }
  const correction=document.querySelector('#ai-correction');if(correction && hasAI())state.ai.correction=correction.value;
  const allowNextStep=document.querySelector('#ai-allow-step');if(allowNextStep && hasAI())state.ai.allowNextStep=allowNextStep.checked;
  if(state.screen==='review' && state.session.review) {
    const title=document.querySelector('#review-title'); if(title)state.session.review.title=title.value;
    document.querySelectorAll('[data-review-index]').forEach(input=>{const section=state.session.review.sections[Number(input.dataset.reviewIndex)];if(section)section.text=input.value;});
  }
}
function start(modeId=state.modeId, options=null) { invalidateAI();state={screen:'story',modeId,session:createSession(modeId),question:0,ai:aiState(options)};feedbackDraft={};render();window.scrollTo(0,0);main.focus(); }
function home() { invalidateAI();state={screen:'home',modeId:state.modeId,session:null,question:0,ai:aiState()};feedbackDraft={};render();window.scrollTo(0,0);main.focus(); }
async function loadAiStatus() {
  try {
    const response=await fetch('/api/ai/status',{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw Error();
    const value=await response.json();
    aiStatus=normalizeAiStatus(value);
  }catch{aiStatus=emptyAiStatus();}
  if(state.screen==='home')render();
}
function selectedAiProfile(){return aiSelectionProfile(personalKey.selection(),aiStatus);}
function aiProviderLabel(){return state.ai?.providerLabel||selectedAiProfile()?.providerLabel||'所选服务商';}
function aiSourceLabel(){const profile=hasAI()?state.ai:selectedAiProfile();return profile?`${profile.sourceMode==='personal'?'本页个人服务':'组织者默认服务'} · ${profile.providerLabel} · ${profile.modelLabel}`:'尚未配置可用服务';}
function sharedBudgetNote(){return `${typeof aiStatus.remainingCalls==='number'?`共享剩余 ${aiStatus.remainingCalls} 次`:'共享额度暂不可读'}${typeof aiStatus.remainingBudgetCny==='number'?`，保守可用预算 ¥${aiStatus.remainingBudgetCny.toFixed(2)}`:''}；实际可用还受所选模型费用限制。`;}
function aiHomeMarkup(){
  const selection=personalKey.selection();const profile=selectedAiProfile();const available=canUseAiSelection(selection,aiStatus,personalKey.hasKey());
  const note=aiStatus.loading?'正在查看 AI 是否可用…':!aiStatus.enabled?'本轮 AI 暂不可用，仍可按原话慢慢整理。':selection.sourceMode==='personal'&&profile?`已选择 ${profile.providerLabel} · ${profile.modelLabel}。个人账户付费，不占组织者共享额度。`:aiStatus.defaultEnabled&&profile?`可以使用组织者提供的 ${profile.providerLabel} 服务。共享剩余 ${aiStatus.remainingCalls??'—'} 次，另受费用上限限制。`:aiStatus.defaultAvailable?'组织者的共享体验暂不可用，也可以选择个人服务。':'选择 DeepSeek、Kimi、GLM 或 OpenAI，填入自己的 API Key，试试智能追问。';
  return `<div class="ai-entry"><div><span class="aside-label">也可以，让 AI 陪你一起想</span><p>${e(note)}</p></div><div class="actions"><button class="secondary" data-action="${available?'ai-start':'ai-settings'}" ${aiStatus.loading?'disabled':''}>${available?'开始 AI 体验':'设置 AI 服务'}</button>${available?'<button class="text-button" data-action="ai-settings">更换服务</button>':''}</div></div>`;
}
function aiSettingsFields(){
  const draft=aiSettingsDraft;const locked=Boolean(state.session);const disabled=locked?'disabled':'';
  if(!draft)return '';
  if(draft.sourceMode==='default'){
    const profile=aiStatus.defaultProfile;
    return `<div class="ai-default-summary"><p>${profile?`使用 <strong>${e(profile.providerLabel)} · ${e(profile.modelLabel)}</strong>，费用由组织者承担。`:'组织者尚未配置默认服务。你可以选择个人服务，或先用本地记录。'}</p>${profile?.modelNote?`<p class="gentle-note">${e(profile.modelNote)}</p>`:''}<p class="gentle-note">${e(sharedBudgetNote())}</p>${aiStatus.defaultAvailable&&!aiStatus.defaultEnabled?`<p class="gentle-note">${e(providerErrorMessage(aiStatus.defaultReason,profile?.providerLabel))}</p>`:''}</div>`;
  }
  const provider=aiStatus.providers.find(value=>value.id===draft.providerId);const profile=findAiProfile(aiStatus.providers,draft.providerId,draft.modelId);
  return `<div class="ai-provider-grid"><div><label class="field-label" for="ai-provider">服务商</label><select class="ai-select" id="ai-provider" ${disabled}>${aiStatus.providers.map(value=>`<option value="${e(value.id)}" ${value.id===draft.providerId?'selected':''}>${e(value.label)}</option>`).join('')}</select></div><div><label class="field-label" for="ai-model">试用模型</label><select class="ai-select" id="ai-model" aria-describedby="ai-model-help" ${disabled}>${(provider?.models??[]).map(value=>`<option value="${e(value.id)}" ${value.id===draft.modelId?'selected':''}>${e(value.label)}</option>`).join('')}</select></div></div><p id="ai-model-help" class="gentle-note">${e(profile?.modelNote||'仅提供已适配的试用模型。')}</p><label class="field-label" for="personal-key">API Key</label><input id="personal-key" class="title-input" type="password" maxlength="256" autocomplete="off" spellcheck="false" data-sensitive-key aria-describedby="provider-key-help personal-key-help" placeholder="${draft.retainExisting&&personalKey.hasKey()?'本页已填写；留空保留':'填写所选服务商的 API Key'}" ${disabled}><p id="provider-key-help" class="gentle-note">${e(provider?.keyHelp||'请填写所选服务商官方平台的 API Key。')}</p><p id="personal-key-help" class="gentle-note">Key 只留在当前页面内存中，刷新或关闭页面即清除。调用时经留白后台发送给 ${e(provider?.label||'所选服务商')}，不写入记录或浏览器存储。</p><p class="gentle-note">个人账户付费，不占组织者共享次数或金额。每次体验最多调用 5 次，失败和超时可能已计费，不自动重试。</p>`;
}
function renderAiSettingsFields(){const fields=document.querySelector('#ai-source-fields');if(fields)fields.innerHTML=aiSettingsFields();document.querySelector('#key-settings-error')?.replaceChildren();}
async function aiSettings(){
  const settingsState=state;
  capture();
  await loadAiStatus();
  if(state!==settingsState)return;
  const locked=Boolean(state.session);
  aiSettingsDraft=createAiSettingsDraft(personalKey.selection(),aiStatus);
  openModal('AI 设置',`<p>使用组织者提供的服务，或选择自己的服务商。应用设置不会调用模型。</p><p class="gentle-note">当前选择：${e(aiSourceLabel())}。</p>${locked?'<p class="gentle-note">本次体验进行中，服务选择已锁定。请先完成或结束本次，再更换配置。</p>':''}${!aiStatus.providers.length?'<p class="gentle-note">暂时没有取得服务商目录，请稍后重新打开设置。本地记录仍可使用。</p>':''}<form id="ai-settings-form"><fieldset class="ai-source-options" ${locked?'disabled':''}><legend>使用哪种服务？</legend><label class="ai-source-option"><input type="radio" name="sourceMode" value="default" ${aiSettingsDraft.sourceMode==='default'?'checked':''}><span><strong>组织者默认服务</strong><small>${aiStatus.defaultAvailable?'使用共享体验额度':'尚未配置默认服务'}</small></span></label><label class="ai-source-option"><input type="radio" name="sourceMode" value="personal" ${aiSettingsDraft.sourceMode==='personal'?'checked':''}><span><strong>使用个人 API Key</strong><small>自行付费，不占共享额度</small></span></label></fieldset><div id="ai-source-fields">${aiSettingsFields()}</div><p id="key-settings-error" class="error-text" role="alert"></p><div class="modal-actions"><button type="button" class="secondary" data-action="clear-personal-key" ${locked?'disabled':''}>清除个人 Key</button><button type="button" class="text-button" data-action="close-modal">取消</button><button type="submit" class="primary" ${locked||!aiStatus.providers.length?'disabled':''}>应用到本页</button></div></form>`);
}
async function aiConsent(){
  if(state.session)return;
  const consentState=state;
  await loadAiStatus();
  if(state!==consentState||state.session)return;
  if(!canUseAiSelection(personalKey.selection(),aiStatus,personalKey.hasKey())){aiSettings();return;}
  const profile=selectedAiProfile();
  pendingAiConsent={sourceMode:profile.sourceMode,providerId:profile.providerId,modelId:profile.modelId,providerLabel:profile.providerLabel,modelLabel:profile.modelLabel,configVersion:aiStatus.configVersion,consentVersion:aiStatus.consentVersion};
  openModal('开始前，由你选择',`<p>这次使用<strong>${e(aiSourceLabel())}</strong>。</p><p>${profile.sourceMode==='personal'?`费用由你的 ${e(profile.providerLabel)} 账户承担，不占组织者共享额度。`:`费用由组织者承担。${e(sharedBudgetNote())}`}每次体验最多调用 5 次，失败或超时不自动重试。</p>${profile.modelNote?`<p class="gentle-note">${e(profile.modelNote)}</p>`:''}<p>本次故事、关注点、卡片联想、实际问答和纠正将经留白后台发送给 <strong>${e(profile.providerLabel)}</strong>，用于追问和整理。旧记录不会自动上传。</p><p>AI 的理解可能不准确，你可以纠正、跳过或结束。卡片只提供联想，不作诊断或预测。</p><form id="ai-consent-form"><label class="check-row"><input id="ai-consent" type="checkbox" required><span>我了解费用承担方式，并同意将本次表达发送给 ${e(profile.providerLabel)}。</span></label><div id="ai-consent-error" class="error-text" role="alert"></div><div class="modal-actions"><button class="secondary" type="button" data-action="local-from-consent">只做本地记录</button><button class="primary" type="submit">同意并开始 AI 体验</button></div></form>`);
}
function hypothesisMarkup(){
  const claim=state.ai.candidate?.hypothesis;if(!claim)return '';
  const labels={accepted:'贴近',rejected:'不太对',uncertain:'暂不确定'};
  return `<section class="ai-understanding"><h2>一个可能的理解</h2><p>${e(claim.text)}</p><div class="ai-feedback" aria-label="这个理解贴近吗">${Object.entries(labels).map(([verdict,label])=>`<button class="chip" type="button" data-action="ai-verdict" data-verdict="${verdict}" aria-pressed="${state.ai.verdict===verdict}">${label}</button>`).join('')}</div>${state.ai.verdict==='rejected'||state.ai.verdict==='uncertain'?`<label class="field-label" for="ai-correction">${state.ai.verdict==='rejected'?'我更想表达的是…':'我还不确定的是…'}</label><textarea id="ai-correction" class="review-text" maxlength="1000" placeholder="可以补充，也可以先留空。">${e(state.ai.correction)}</textarea><p class="gentle-note">你的选择和补充会随下一轮一起带给 AI，不会单独发起请求。</p>`:''}</section>`;
}
function renderAiReflect(){
  const ai=state.ai;
  if(ai.status==='loading')return layout(`<div class="ai-loading" role="status" aria-live="polite"><span class="ai-dot" aria-hidden="true"></span><h1>${ai.pendingStage==='review'?'正在整理你愿意留下的内容…':'正在认真看看你的表达…'}</h1><p class="intro">这可能需要一点时间。你可以随时结束，或先用原话整理。</p></div><div class="actions"><button class="back-button" data-action="ai-edit-story">返回修改表达</button><button class="secondary" data-action="ai-local-review">先按原话整理</button></div>`,{title:'慢一点，\n也没有关系。',note:`本次选定文字正在经留白后台发送给 ${aiProviderLabel()}。`});
  if(ai.status==='error'||!ai.candidate)return layout(`<h1>这一次，先把表达留住。</h1><p class="intro" role="status">${e(ai.errorMessage||'AI 暂时没有给出合适的内容。你的输入仍在本页。')}</p><div class="actions"><button class="primary" data-action="ai-local-review">按我的原话整理 ${icon}</button><button class="secondary" data-action="ai-local-questions">继续本地问题</button><button class="back-button" data-action="ai-edit-story">返回修改</button></div>`,{title:'你的表达，\n不会因为等待而丢失。',note:'回到本地记录后，不会继续发送文字给模型。'});
  const candidate=ai.candidate;const question=candidate.question?.text;
  return layout(`<p class="question-count">AI 体验 · ${question?`第 ${state.session.turns.length+1} 个问题，最多 3 个`:'可以在这里开始整理'}</p>${candidate.reflection?`<section class="ai-reflection"><h2>根据你的表达</h2><p>${e(candidate.reflection.text)}</p></section>`:''}${hypothesisMarkup()}<form id="step-form">${question?`<h1 id="question-title">${e(question)}</h1>${inputMarkup(ai.answer,'写下你愿意表达的部分。',{max:3000,rows:4})}`:'<h1>先停在这里，也可以。</h1><p class="intro">没有新的问题需要回答。已有的表达可以直接整理。</p>'}<label class="check-row"><input id="ai-allow-step" type="checkbox" ${ai.allowNextStep?'checked':''}><span>整理时，我愿意看看一个可选的小行动。</span></label><div class="actions"><button class="back-button" type="button" data-action="ai-edit-story">修改前面的表达</button><button class="primary" type="submit">${!question||state.session.turns.length>=2?'开始整理':'写好了，继续'} ${icon}</button></div><div class="actions">${question?'<button class="quiet-button" type="button" data-action="ai-skip">这一题先跳过</button>':''}<button class="quiet-button" type="button" data-action="review-early">到这里就够了</button><button class="quiet-button" type="button" data-action="ai-local-review">只按原话整理</button></div></form>`,{title:'让理解，\n慢慢贴近你的意思。',note:'AI 的理解只是候选，你可以说“不太对”。不必为了完成流程而回答。'});
}
function commitAiFeedback(){
  const hypothesis=state.ai.candidate?.hypothesis?.text;
  if(hypothesis && state.ai.verdict){
    const item={hypothesisText:hypothesis,verdict:state.ai.verdict,correction:state.ai.correction};
    const index=state.session.feedback.findIndex(f=>f.hypothesisText===hypothesis);
    if(index>=0)state.session.feedback[index]=item;else if(state.session.feedback.length<6)state.session.feedback.push(item);
  }
}
function commitAiTurn(skip=false){
  capture();commitAiFeedback();
  const question=state.ai.candidate?.question?.text;
  if(question && state.session.turns.length<3)state.session.turns.push({id:`t${state.session.turns.length+1}`,question,answer:skip?'':state.ai.answer});
  state.ai.answer='';state.ai.verdict='';state.ai.correction='';state.ai.candidate=null;
}
function rawDraft(){capture();if(hasAI())commitAiTurn(false);invalidateAI();state.ai.enabled=false;state.ai.personalApiKey='';state.ai.reviewKind='local';state.session.review=makeReview(state.session);state.session.confirmed=false;go('review');}
function localQuestions(){capture();if(hasAI())commitAiTurn(false);if(state.session.turns.length>=3){rawDraft();return;}invalidateAI();state.ai.enabled=false;state.ai.personalApiKey='';state.question=state.session.turns.length;go('reflect');}
function enterReflection(){if(hasAI())requestAi(state.session.turns.length>=3?'review':'reflect');else{state.question=0;go('reflect');}}
function aiErrorMessage(reason){
  return providerErrorMessage(reason,aiProviderLabel());
}
async function requestAi(stage){
  if(!hasAI()||state.ai.status==='loading')return;
  if(state.ai.credentialExpired){state.ai.status='error';state.ai.errorMessage='离开页面后，个人 Key 已清除。请先按原话整理，结束本次后重新设置。';render();return;}
  invalidateAI();
  const ai=state.ai;const requestId=crypto.randomUUID();ai.requestId=requestId;ai.status='loading';ai.pendingStage=stage;
  const expected={requestId,revision:ai.revision,sessionId:state.session.id,route:ai.route};
  const session=aiRequestSession(state.session);const controller=new AbortController();activeAiController=controller;
  const stillCurrent=()=>hasAI()&&state.session?.id===expected.sessionId&&state.ai.requestId===requestId&&state.ai.revision===expected.revision&&state.screen==='reflect';
  state.screen='reflect';render();main.focus({preventScroll:true});window.scrollTo(0,0);
  const timeout=setTimeout(()=>controller.abort(),50000);
  try{
    const response=await fetch('/api/ai/generate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({requestId,revision:expected.revision,configVersion:ai.configVersion,consentVersion:ai.consentVersion,...ai.route,personalApiKey:ai.personalApiKey,stage,allowNextStep:ai.allowNextStep,session})});
    const data=await response.json();
    if(!stillCurrent())return;
    if(!response.ok||data.status!=='candidate'){ai.status='error';ai.errorMessage=aiErrorMessage(data.reason||data.error);ai.requestId=null;render();return;}
    if(!acceptsAiReply(data,expected,{active:stillCurrent(),sessionId:state.session.id,requestId:ai.requestId,revision:ai.revision}))throw Error('reply_mismatch');
    if(!sameAiRoute(data.route,expected.route))throw Error('route_mismatch');
    const candidate=validateUiCandidate(data.candidate,session,{stage,allowNextStep:ai.allowNextStep});
    if(!candidate)throw Error('invalid_candidate');
    if(candidate.hypothesis && (session.feedback??[]).some(f=>f.verdict==='rejected' && f.hypothesisText===candidate.hypothesis.text))candidate.hypothesis=null;
    ai.requestId=null;ai.status='ready';ai.candidate=candidate;
    if(stage==='review'){
      if(state.session.review)return;
      const evidence=aiEvidence(session);ai.reviewSources={};
      for(const [key,claim]of Object.entries(candidate))if(claim)ai.reviewSources[`ai_${key}`]=claim.evidenceIds.map(id=>evidence[id]).join('\n\n');
      state.session.review=makeAiReview(state.session,candidate);ai.reviewKind=state.session.review.sections.some(s=>s.id.startsWith('ai_'))?'ai':'local';state.session.confirmed=false;go('review');
    }else{render();main.focus({preventScroll:true});}
  }catch{
    if(stillCurrent()){ai.status='error';ai.errorMessage=aiErrorMessage();ai.requestId=null;render();}
  }finally{clearTimeout(timeout);if(activeAiController===controller)activeAiController=null;await loadAiStatus();}
}
function inputMarkup(value,placeholder,{max=4000,rows=6,cls='answer-input'}={}) {return `<textarea id="entry" class="${cls}" maxlength="${max}" rows="${rows}" aria-labelledby="question-title" placeholder="${e(placeholder)}">${e(value)}</textarea><div class="input-meta"><span>可以使用手机键盘的语音输入。页面不录音。</span><span id="char-count">${String(value??'').length} / ${max}</span></div>`;}
function sourceSnippet() {return state.session?.story ? `<details class="source-snippet"><summary>看看最开始写下的事</summary>${e(state.session.story)}</details>` : '';}
function layout(body,{title='慢慢来，\n不用一次想清楚。',note='你可以跳过问题，也可以随时结束。',art=null}={}) {
 const positions={story:0,focus:1,card:2,reflect:3,review:4};const current=positions[state.screen]??0;
 return `<section class="workspace"><div class="workspace-top"><ol class="step-list" aria-label="体验进度">${['讲一件事','选焦点','换个角度','慢慢想','整理'].map((label,i)=>`<li ${i===current?'aria-current="step"':''} class="${i<current?'complete':''}"><span class="step-dot" aria-hidden="true">${i<current?'✓':i+1}</span><span>${label}</span></li>`).join('')}</ol><button class="end-button text-button" data-action="exit">结束本次</button></div><div class="workspace-body"><aside class="aside"><span class="aside-label">${e(getMode().label)}</span><h2>${e(title).replace(/\n/g,'<br>')}</h2><p>${e(note)}</p><img class="aside-illustration" src="./assets/cozy-room.svg" alt="" aria-hidden="true">${art?'':sourceSnippet()}</aside><div class="panel">${body}</div></div></section>`;
}
function renderHome() {
 const motifs=[`<circle cx="20" cy="20" r="7"/><path d="M20 3v5m0 24v5M3 20h5m24 0h5M8 8l4 4m16 16 4 4M8 32l4-4M28 12l4-4"/>`,`<path d="M5 15c7-10 13 10 20 0s12 1 10 6M5 25c7-10 13 10 20 0s12 1 10 6"/>`,`<path d="M20 35V7m0 1h13l4 5-4 5H20M20 21H7l-4 5 4 5h13"/>`];
 return `<section class="home"><div class="hero"><div class="hero-copy"><p class="hero-welcome"><span aria-hidden="true">☀</span> 给自己留一小会儿</p><h1>今天的小事，<br>值得慢慢说。</h1><p class="hero-intro">一点开心，一点心事，或一个还没想好的选择。把零散的念头，写成给自己的生活来信。</p><div class="hero-actions"><button class="primary" data-action="start">从一件小事开始 ${icon}</button><button class="text-button" data-action="example">看看一封来信</button></div><p class="hero-meta"><span>约 5–8 分钟</span><span>随时可以停下</span></p></div><figure class="hero-art"><img src="./assets/cozy-room.svg" width="720" height="560" fetchpriority="high" alt="傍晚的窗边亮着一盏灯，沙发旁的小桌上放着打开的本子和一杯热茶。"><figcaption>这里，为你留着一盏灯。</figcaption></figure></div><section class="topic-strip" aria-labelledby="topic-title"><div class="topic-heading"><h2 id="topic-title">今天，想从哪里说起？</h2><p>选一个适合此刻的入口。</p></div><div class="topics">${MODES.map((m,i)=>`<button class="topic topic-${m.id}" data-action="mode" data-mode="${m.id}" aria-pressed="${state.modeId===m.id}"><span class="topic-icon" aria-hidden="true"><svg viewBox="0 0 40 40">${motifs[i]}</svg></span><span class="topic-copy"><strong>${['想留住的片刻','挂在心上的事','还没想好的选择'][i]}</strong><small>${e(m.description)}</small></span><span class="topic-check" aria-hidden="true">${state.modeId===m.id?'✓':'+'}</span></button>`).join('')}</div></section>${aiHomeMarkup()}<div class="home-note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg><p class="prototype-note">默认先做本地记录。只有选择 AI 并同意后，本次表达才会发送给模型；确认后，你可以把来信保存在这台设备。</p></div></section>`;
}
function renderStory() {const m=getMode();return layout(`<h1 id="question-title">${e(m.opening)}</h1><p class="intro">不用先想好怎么说。零散的一两句，也可以。</p><form id="step-form">${inputMarkup(state.session.story,'可以从“今天有一幕……”开始。',{cls:'story-input'})}<div id="input-error" class="error-text" role="alert"></div><div class="actions"><button type="button" class="back-button" data-action="exit">先不聊了</button><button class="primary" type="submit">我写好了 ${icon}</button></div></form><details class="help-options"><summary>还不知道从哪里开始？</summary><div class="hint-chips"><button class="chip" data-action="hint" data-text="今天让我停了一下的瞬间是……">一个让我停下来的瞬间</button><button class="chip" data-action="hint" data-text="最近我反复想到的一件事是……">最近反复想到的事</button><button class="chip" data-action="hint" data-text="我还没决定的是……">一个还没决定的小事</button></div></details>`,{title:'先给这件小事，\n一点说出来的空间。',note:'这里没有标准答案。先写下你愿意表达的部分。',art:'pause'});}
function renderFocus() {return layout(`<h1 id="question-title">${e(getMode().focusPrompt)}</h1><p class="intro">可以选一个细节、一种感受，或者只是把这件事放在这里。</p><form id="step-form">${inputMarkup(state.session.focus,'这一次，我比较想聊……',{max:1500,rows:4})}<div class="actions"><button type="button" class="back-button" data-action="back">返回修改</button><button type="button" class="quiet-button" data-action="skip-focus">先继续看看</button><button class="primary" type="submit">从这里继续 ${icon}</button></div></form>`,{title:'这一次，\n先聊你在意的部分。',note:hasAI()?`你已选择 ${aiProviderLabel()}，稍后会将本次表达发送给它，帮助追问和整理。`:'本地模式会按主题给出固定问题，整理时保留你的原话。'});}
function renderCard() {const c=getCard();return layout(`<h1 id="question-title">${c?e(c.prompt):'给这件事，换一个观看角度。'}</h1><p class="intro">随机的图像联想提示。贴不贴切，都由你来决定。</p>${c?`<div class="selected-card reveal"><img src="./assets/${c.art}.svg" alt="${e(c.name)}主题生活插画"><div><h2>${e(c.name)}</h2><p>${e(c.caption)}</p><p class="caption">卡片提供角度，记录来自你的表达。</p><button class="text-button" data-action="redraw">换一张</button></div></div><form id="step-form"><label class="field-label" for="entry">有什么联想？没有也可以留空。</label>${inputMarkup(state.session.cardReflection,'这张图让我想起……',{max:1500,rows:3})}<div class="actions"><button type="button" class="back-button" data-action="back">返回</button><button type="button" class="quiet-button" data-action="skip-card">跳过卡片</button><button class="primary" type="submit">继续聊 ${icon}</button></div></form>`:`<button class="card-back" data-action="draw" aria-label="翻一张联想卡">${windowIcon}<span>翻一张卡</span></button><div class="actions center-actions"><button class="quiet-button" data-action="skip-card">直接聊，跳过卡片</button></div>`}`,{title:'一张图，\n也许带来一点联想。',note:'你可以换一张，也可以直接继续。卡片没有预设的“正确解释”。'});}
function renderReflect() {if(hasAI())return renderAiReflect();const q=getMode().questions[state.question];return layout(`<p class="question-count">第 ${state.question+1} 个问题，共 3 个</p><h1 id="question-title">${e(q.prompt)}</h1><p class="intro">写到觉得够了，就可以开始整理。</p><form id="step-form">${inputMarkup(state.session.answers[q.id]||'',q.placeholder,{max:3000,rows:5})}<div class="actions"><button type="button" class="back-button" data-action="back">返回</button><button class="primary" type="submit">${state.question===2?'开始整理':'写好了，继续'} ${icon}</button></div><div class="actions"><button type="button" class="quiet-button" data-action="skip-question">这一题先跳过</button><button type="button" class="quiet-button" data-action="review-early">到这里就够了</button></div></form>`,{title:state.question===2?'留下一点发现，\n就已经很好。':'给自己的想法，\n多一点耐心。',note:state.question===2?'你可以只把这件事记住。下一步行动是可选的。':'回答可以很短，也可以暂时不知道。'});}
function originalFor(id) {if(['story','focus','cardReflection'].includes(id))return state.session[id];if(state.ai?.reviewSources?.[id])return state.ai.reviewSources[id];return state.session.answers[id];}
function renderReview() {const r=state.session.review;return layout(`<h1>把它改成你的意思。</h1><p class="intro">${state.ai?.reviewKind==='ai'?'以下是 AI 根据你的表达写出的候选整理。请对照原话，删改成你认可的记录。':'以下按话题归档了你的原话。请删掉不想留下的内容，改写成你认可的记录。'}</p><div class="review-note">${state.ai?.reviewKind==='ai'?'AI 草稿尚未经过你的确认，可能有理解偏差。':'这份草稿按你的原话整理。'}保存和导出均以你确认后的版本为准。</div><form id="step-form"><label class="field-label" for="review-title">给这次记录起个名字</label><input id="review-title" class="title-input" maxlength="80" value="${e(r.title)}">${r.sections.map((s,i)=>`<section class="review-section"><div class="review-section-top"><label for="review-${i}">${e(s.label)}</label><button class="remove-section" type="button" data-action="remove-section" data-index="${i}">删除这一项</button></div><textarea class="review-text" id="review-${i}" data-review-index="${i}" maxlength="20000">${e(s.text)}</textarea><span class="source-label">来源：${e(s.source)}</span><button class="text-button" type="button" data-action="uncertain" data-index="${i}" aria-pressed="${s.label.endsWith('（还不确定）')}">${s.label.endsWith('（还不确定）')?'取消不确定标记':'标为还不确定'}</button>${originalFor(s.id)?`<details class="source-snippet"><summary>对照原话</summary>${e(originalFor(s.id))}</details>`:''}</section>`).join('')}<div id="input-error" class="error-text" role="alert"></div><div class="actions"><button type="button" class="back-button" data-action="exit">结束本次</button><button class="primary" type="submit">确认这份记录 ${icon}</button></div></form>`,{title:'你的表达，\n由你来确认。',note:'可以保留不确定性，也可以只留下一句回忆。不会自动替你补充结论。',art:getCard()?.art||'glow'});}
function renderDone() {const r=state.session.review;return `<section class="done-wrap"><div class="done-heading"><h1>今天，先整理到这里。</h1><p>有些已经清楚一点，有些可以以后再想。</p></div><article class="keepsake"><div class="keepsake-head"><span>留白 · 我的生活片刻</span><time datetime="${e(state.session.createdAt)}">${e(dateLabel(state.session.createdAt))}</time></div><h2>${e(r.title)}</h2>${r.sections.map(s=>`<section class="keepsake-section"><h3>${e(s.label)}</h3><p>${e(s.text)}</p></section>`).join('')}<div class="keepsake-bottom">给生活留一点自己的余地。</div></article><div class="actions done-actions"><button class="primary" data-action="save">保存在这台设备</button><button class="secondary" data-action="export-png">导出图片</button><button class="secondary" data-action="export-text">下载文字</button></div><p class="gentle-note" style="text-align:center">保存仅包含这份确认后的记录。导出内容可能包含私密信息，分享前请自行检查。</p><div class="done-secondary"><button class="quiet-button" data-action="edit-review">再改一下</button><button class="quiet-button" data-action="feedback">留下体验反馈</button><button class="quiet-button" data-action="exit">结束并清除本次输入</button></div></section>`;}
function render() {const screens={home:renderHome,story:renderStory,focus:renderFocus,card:renderCard,reflect:renderReflect,review:renderReview,done:renderDone};main.innerHTML=screens[state.screen]();}
function makeDraft() {capture();if(state.session.review){go('review');return;}if(hasAI()){if(state.ai.status==='loading')return;commitAiTurn(false);requestAi('review');return;}state.session.review=makeReview(state.session);state.session.confirmed=false;go('review');}
function nextQuestion(skip=false) {if(hasAI()){if(state.ai.status==='loading')return;const hasQuestion=Boolean(state.ai.candidate?.question);commitAiTurn(skip);requestAi(!hasQuestion||state.session.turns.length>=3?'review':'reflect');return;}if(skip){state.session.answers[getMode().questions[state.question].id]='';const input=document.querySelector('#entry');if(input)input.value='';}else capture();if(state.question<2){state.question++;go('reflect');}else makeDraft();}
function showError(text) {const target=document.querySelector('#input-error');target.textContent=text;document.querySelector('#entry,#review-title')?.focus();}
function submitStep(event) {
 event.preventDefault();capture();
 if(state.screen==='story'){if(!state.session.story.trim()){showError('先写下一点你愿意分享的内容，一句话也可以。');return;}go('focus');}
 else if(state.screen==='focus')go('card');
 else if(state.screen==='card')enterReflection();
 else if(state.screen==='reflect')nextQuestion();
 else if(state.screen==='review'){
   const r=state.session.review; if(!r.title.trim()){showError('给这次记录留一个名字。');return;}
   if(!r.sections.some(s=>s.text.trim())){showError('至少留下一段你想记录的内容。可以返回首页重新开始。');return;}
   r.sections=r.sections.filter(s=>s.text.trim());state.session.confirmed=true;go('done');
 }
}
function openModal(title,body) {focusBeforeModal=document.activeElement;modalContent.innerHTML=`<div class="modal-header"><h2 id="modal-title">${e(title)}</h2><button class="close-button" data-action="close-modal" aria-label="关闭">×</button></div>${body}`;if(!modal.open)modal.showModal();modalContent.querySelector('button')?.focus();}
function clearSensitiveInputs(){modalContent.querySelectorAll('[data-sensitive-key]').forEach(input=>{input.value='';});}
function closeModal(){pendingAction=null;aiSettingsDraft=null;pendingAiConsent=null;clearSensitiveInputs();modal.close();focusBeforeModal?.isConnected&&focusBeforeModal.focus();}
function ask(title,body,label,callback,cancelLabel='再待一会儿'){pendingAction=callback;openModal(title,`<p>${e(body)}</p><div class="modal-actions"><button class="secondary" data-action="close-modal">${e(cancelLabel)}</button><button class="primary" data-action="confirm-action">${e(label)}</button></div>`);}
function exitSession(){if(!state.session){home();return;}capture();ask('这次先到这里？','尚未保存的输入会从当前页面清除。已经保存到这台设备或导出的记录会保留。','清除本次并结束',()=>{home();notify('本次输入已清除。');});}
function readRecords(){try{const raw=localStorage.getItem(STORE);if(!raw)return [];if(raw.length>5000000)throw Error('large');const data=JSON.parse(raw);if(!Array.isArray(data))return [];return data.slice(0,30).map(validateSavedRecord).filter(Boolean);}catch{return [];}}
function saveRecord(){const record=confirmedRecord(state.session);if(!record){notify('记录内容不完整或过长，请修改后重试。');return;}try{const items=readRecords().filter(x=>x.id!==record.id);if(items.length>=30){notify('这台设备已有 30 份记录。请先删除一些，或导出当前记录。');return;}localStorage.setItem(STORE,JSON.stringify([record,...items]));notify('已保存在这台设备。可在“我的记录”中查看或删除。');}catch{notify('浏览器没有允许保存，或存储空间不足。可以下载文字。');}}
function showSaved(){const items=readRecords();openModal('我的记录',`<p>仅保存在这个浏览器中，不跨设备同步。</p>${items.length?`<ul class="record-list">${items.map(r=>`<li class="record-row"><button class="record-open" data-action="open-record" data-id="${e(r.id)}"><strong>${e(r.review.title)}</strong><small>${e(dateLabel(r.createdAt))}</small></button><button class="text-button danger" data-action="delete-record" data-id="${e(r.id)}">删除</button></li>`).join('')}</ul>`:'<div class="empty-state">还没有保存的记录。<br>完成一次整理后，可以选择留在这里。</div>'}`);}
function about(){openModal('关于这次体验',`<p>留白用生活问题、可选图像卡和可修改的整理，陪你回看自己的表达。</p><h3>两种体验方式</h3><ul><li>默认本地模式：固定问题引导，原话整理，不向模型发送正文。</li><li>可选 AI 模式：选择组织者默认服务或个人服务，并明确同意后，将本次故事、焦点、卡片联想、实际问答及纠正经留白后台发送给当次所选的服务商（DeepSeek、Kimi、GLM 或 OpenAI）；旧记录不会自动上传。</li><li>AI 只是提供候选理解，可能不准确。你可以纠正、跳过或结束；卡片不作心理诊断或占卜。</li></ul><h3>你的内容如何处理</h3><p>进行中的内容保留在页面内存中，刷新会清除本页输入和个人 Key，结束会清除本次输入。AI 模式中已经发送的文字无法通过清除本页撤回，服务商的数据处理规则适用。</p><p>点击“保存在这台设备”才会写入浏览器存储，只保存确认后的记录，不另存原始问答和 AI 过程。你可以在“我的记录”逐条删除；共用设备上的其他使用者可能看到这些记录。</p><p>页面不请求麦克风权限；键盘语音输入的音频由输入法和设备处理。站点及模型请求会产生必要的访问、用量和错误记录。</p><p>体验反馈不会自动附带复盘正文，不自动上传。你下载后自行决定是否提供给测试组织者。</p>`);}
function example(){openModal('一份记录可以很简单',`<p>这是虚构示例，不会写入你的记录。</p><div class="example-note"><p>周末和朋友散步，没有提前安排全部行程。走到哪儿，想坐就坐。</p><p>我注意到，自己喜欢一点临时决定的余地。</p><p>想试试：周三晚上留一个小时，不提前安排。</p></div><p>也可以只留下一句：“今天路边的桂花很香，我想记住。”</p><div class="modal-actions"><button class="primary" data-action="start-from-modal">聊聊我的小事</button></div>`);}
function drawCard(){invalidateAI();const options=CARDS.filter(c=>c.id!==state.session.cardId);const n=new Uint32Array(1);crypto.getRandomValues(n);state.session.cardId=options[n[0]%options.length].id;render();main.focus({preventScroll:true});}
function download(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function textExport(){const r=state.session.review;const content=`${r.title}\n${dateLabel(state.session.createdAt)}\n\n${r.sections.map(s=>`${s.label}\n${s.text}`).join('\n\n')}\n\n留白 · 我的生活片刻\n`;download(new Blob([content],{type:'text/plain;charset=utf-8'}),`留白-${fileDate()}.txt`);notify('文字下载已发起。');}
async function pngExport(button){button.disabled=true;try{
 const r=state.session.review;const c=document.createElement('canvas');const ctx=c.getContext('2d');if(!ctx)throw Error();
 const width=1000,pad=76,contentWidth=width-2*pad;const font='"Microsoft YaHei", "PingFang SC", sans-serif';
 const wrap=(text,size)=>{ctx.font=`${size}px ${font}`;const lines=[];for(const p of String(text).split('\n')){let line='';for(const ch of p){if(ctx.measureText(line+ch).width>contentWidth&&line){lines.push(line);line='';}line+=ch;}lines.push(line);}return lines;};
 const titles=wrap(r.title,42);const sections=r.sections.map(s=>({...s,lines:wrap(s.text,26),labelLines:wrap(s.label,22)}));
 const height=240+titles.length*61+sections.reduce((n,s)=>n+60+s.labelLines.length*34+s.lines.length*44,0)+110;
 if(height>24000){notify('这份记录较长，请使用“下载文字”完整保存。');return;}
 c.width=width;c.height=height;ctx.fillStyle='#fffaf3';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#ddc9c9';ctx.lineWidth=2;ctx.strokeRect(30,30,width-60,height-60);
 ctx.fillStyle='#776371';ctx.font=`20px ${font}`;ctx.fillText('留白 · 我的生活片刻',pad,95);ctx.textAlign='right';ctx.fillText(dateLabel(state.session.createdAt),width-pad,95);ctx.textAlign='left';ctx.beginPath();ctx.moveTo(pad,124);ctx.lineTo(width-pad,124);ctx.stroke();let y=190;
 ctx.fillStyle='#3e2f3d';ctx.font=`42px ${font}`;for(const line of titles){ctx.fillText(line,pad,y);y+=61;}y+=18;
 for(const s of sections){ctx.fillStyle='#776371';ctx.font=`22px ${font}`;for(const line of s.labelLines){ctx.fillText(line,pad,y);y+=34;}y+=12;ctx.fillStyle='#3e2f3d';ctx.font=`26px ${font}`;for(const line of s.lines){ctx.fillText(line,pad,y);y+=44;}y+=48;}
 ctx.fillStyle='#776371';ctx.font=`20px ${font}`;ctx.fillText('给生活留一点自己的余地。',pad,height-80);
 const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error()),'image/png'));download(blob,`留白-${fileDate()}.png`);notify('图片下载已发起。分享前请检查私密内容。');
 }catch{notify('图片未能导出。请使用“下载文字”，或换一个浏览器重试。');}finally{button.disabled=false;}}
const feedbackQuestions=[['purpose','你觉得这个工具刚才主要在帮你做什么？'],['friction','哪一步你最想跳过、修改或退出？'],['accuracy','整理里有什么与你想表达的不一样？'],['card','卡片出现后，你想说的内容有什么变化？']];
function feedback(){openModal('留下体验反馈',`<p>反馈不会自动附带你的复盘内容。文件仅下载到设备，是否交给测试组织者由你决定。</p><form id="feedback-form">${feedbackQuestions.map(([id,label])=>`<div class="feedback-field"><label for="fb-${id}">${label}</label><textarea id="fb-${id}" name="${id}" maxlength="1500" placeholder="可以留空">${e(feedbackDraft[id]||'')}</textarea></div>`).join('')}<div class="feedback-field"><label for="fb-clarity">现在你对那件事的理解是？</label><select id="fb-clarity" name="clarity"><option value="">暂不评价</option value="clearer">更清楚了</option><option value="same">差不多</option><option value="less-clear">更乱了</option></select></div><div class="modal-actions"><button class="primary" type="submit">下载反馈文件</button></div></form>`);document.querySelector('#fb-clarity').value=feedbackDraft.clarity||'';}

document.addEventListener('submit',event=>{
  if(event.target.id==='ai-settings-form'){
    event.preventDefault();if(state.session||!aiSettingsDraft)return;
    const sourceMode=event.target.querySelector('[name="sourceMode"]:checked')?.value;
    const draft={...aiSettingsDraft,sourceMode,providerId:event.target.querySelector('#ai-provider')?.value??aiSettingsDraft.providerId,modelId:event.target.querySelector('#ai-model')?.value??aiSettingsDraft.modelId,apiKey:event.target.querySelector('#personal-key')?.value??''};
    const result=personalKey.apply(draft,aiStatus.providers);
    if(!result.ok){document.querySelector('#key-settings-error').textContent=result.reason==='missing_personal_key'?'请填写所选服务商的 API Key。已应用的配置没有改变。':result.reason==='invalid_personal_key'?'Key 需为 16–256 位英文可打印字符，不能包含空格。已应用的配置没有改变。':'服务商或模型不可用，请重新选择。已应用的配置没有改变。';return;}
    closeModal();if(state.screen==='home')render();notify(personalKey.hasKey()?'个人服务已应用到本页；尚未调用模型。':'已选择组织者默认服务；尚未调用模型。');return;
  }
  if(event.target.id==='ai-consent-form'){
    event.preventDefault();const profile=selectedAiProfile();
    if(!document.querySelector('#ai-consent').checked||!pendingAiConsent||!canUseAiSelection(personalKey.selection(),aiStatus,personalKey.hasKey())||!sameAiRoute(profile,pendingAiConsent)){document.querySelector('#ai-consent-error').textContent='服务选择已变化或暂不可用，请关闭后重新设置并确认发送说明。';return;}
    const route=Object.freeze({sourceMode:profile.sourceMode,providerId:profile.providerId,modelId:profile.modelId});
    const options={...pendingAiConsent,route,personalApiKey:profile.sourceMode==='personal'?personalKey.forRequest().personalApiKey:''};
    closeModal();start(state.modeId,options);return;
  }
  if(event.target.id==='step-form')submitStep(event);
  if(event.target.id==='feedback-form'){event.preventDefault();feedbackDraft=Object.fromEntries(new FormData(event.target));const data={version:'0.1',createdAt:new Date().toISOString(),theme:state.session?.modeId||null,usedCard:!!state.session?.cardId,feedback:feedbackDraft};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),`留白-体验反馈-${fileDate()}.json`);notify('反馈文件已下载。没有上传。');}
});

document.addEventListener('change',event=>{
  if(!aiSettingsDraft||state.session||!event.target.closest('#ai-settings-form'))return;
  if(event.target.name==='sourceMode'){
    clearSensitiveInputs();aiSettingsDraft={...aiSettingsDraft,sourceMode:event.target.value};renderAiSettingsFields();
  }else if(event.target.id==='ai-provider'){
    clearSensitiveInputs();aiSettingsDraft=changeAiSettingsProvider(aiSettingsDraft,event.target.value,aiStatus);renderAiSettingsFields();document.querySelector('#ai-provider')?.focus();
  }else if(event.target.id==='ai-model'){
    aiSettingsDraft={...aiSettingsDraft,modelId:event.target.value,retainExisting:false};document.querySelector('#personal-key')?.setAttribute('placeholder','填写所选服务商的 API Key');
    const profile=findAiProfile(aiStatus.providers,aiSettingsDraft.providerId,aiSettingsDraft.modelId);const help=document.querySelector('#ai-model-help');if(help)help.textContent=profile?.modelNote||'仅提供已适配的试用模型。';
  }
});
document.addEventListener('input',event=>{if(state.session && (['entry','ai-correction','ai-allow-step','review-title'].includes(event.target.id)||event.target.hasAttribute('data-review-index')))invalidateAI();if(event.target.id==='entry'){document.querySelector('#char-count').textContent=`${event.target.value.length} / ${event.target.maxLength}`;document.querySelector('#input-error')?.replaceChildren();}if(event.target.closest('#feedback-form'))feedbackDraft=Object.fromEntries(new FormData(document.querySelector('#feedback-form')));});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
 if(action==='start')start();
 else if(action==='ai-start')aiConsent();
 else if(action==='ai-settings')aiSettings();
 else if(action==='clear-personal-key'){if(state.session)return;personalKey.clear();clearSensitiveInputs();closeModal();if(state.screen==='home')render();notify('个人 Key 已从本页清除。');}
 else if(action==='local-from-consent'){closeModal();start();}
 else if(action==='ai-verdict'){capture();state.ai.verdict=button.dataset.verdict;if(state.ai.verdict==='accepted')state.ai.correction='';render();document.querySelector(`[data-verdict="${state.ai.verdict}"]`)?.focus();}
 else if(action==='ai-edit-story'){capture();if(hasAI())commitAiTurn(false);invalidateAI();state.ai.candidate=null;state.ai.answer='';state.ai.verdict='';state.ai.correction='';go('story');}
 else if(action==='ai-local-review')rawDraft();
 else if(action==='ai-local-questions')localQuestions();
 else if(action==='ai-skip'){capture();if(state.ai.answer.trim())ask('跳过这一题？','这一题已输入的文字会被清除，其他回答和纠正会保留。','清除这一题并跳过',()=>nextQuestion(true));else nextQuestion(true);}
 else if(action==='start-from-modal'){closeModal();start();}
 else if(action==='mode'){state.modeId=button.dataset.mode;render();document.querySelector(`[data-mode="${state.modeId}"]`)?.focus({preventScroll:true});}
 else if(action==='home'){if(state.session)exitSession();else home();}
 else if(action==='exit')exitSession();
 else if(action==='about')about();
 else if(action==='example')example();
 else if(action==='close-modal')closeModal();
 else if(action==='confirm-action'){const callback=pendingAction;closeModal();callback?.();}
 else if(action==='hint'){
   const input=document.querySelector('#entry');if(!input)return;
   const next=button.dataset.text;const current=input.value.trim();
   const starters=[...document.querySelectorAll('[data-action="hint"]')].map(item=>item.dataset.text);
   const replace=()=>{if(!input.isConnected)return;input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(next.length,next.length);};
   if(!current||starters.includes(current))replace();
   else ask('替换这个开头？',`将输入框内容替换为“${next}”。你已补写的文字会被清除。`,'替换为这个开头',replace,'保留现有内容');
 }
 else if(action==='skip-focus'){capture();go('card');}
 else if(action==='draw')drawCard();
 else if(action==='redraw'){capture();if(state.session.cardReflection.trim())ask('换一个角度？','换卡会清除这张卡的联想文字，之前讲述的事情和焦点会保留。','清除联想并换卡',()=>{state.session.cardReflection='';drawCard();});else drawCard();}
 else if(action==='skip-card'){capture();state.session.cardId=null;state.session.cardReflection='';enterReflection();}
 else if(action==='skip-question'){capture();if(state.session.answers[getMode().questions[state.question].id]?.trim())ask('跳过这一题？','这一题已输入的文字将被清除，不会放入复盘记录。其他回答会保留。','清除这一题并跳过',()=>nextQuestion(true));else nextQuestion(true);}
 else if(action==='review-early')makeDraft();
 else if(action==='back'){capture();if(state.screen==='focus')go('story');else if(state.screen==='card')go('focus');else if(state.screen==='reflect'){if(state.question>0){state.question--;go('reflect');}else go('card');}}
 else if(action==='remove-section'){capture();state.session.review.sections.splice(Number(button.dataset.index),1);render();main.focus({preventScroll:true});}
 else if(action==='uncertain'){capture();const s=state.session.review.sections[Number(button.dataset.index)];s.label=s.label.endsWith('（还不确定）')?s.label.replace(/（还不确定）$/,''):s.label+'（还不确定）';render();main.focus({preventScroll:true});}
 else if(action==='edit-review'){state.session.confirmed=false;go('review');}
 else if(action==='save')saveRecord();
 else if(action==='saved'){capture();showSaved();}
 else if(action==='open-record'){const item=readRecords().find(r=>r.id===button.dataset.id);if(!item)return;const open=()=>{invalidateAI();state={screen:'done',modeId:item.modeId,session:structuredClone(item),question:0,ai:aiState()};feedbackDraft={};render();main.focus();window.scrollTo(0,0);};if(state.session)ask('打开这份记录？','当前尚未保存的输入将被清除。','打开记录',open);else{closeModal();open();}}
 else if(action==='delete-record'){const id=button.dataset.id;ask('删除这份记录？','它将从这个浏览器中删除，已下载的文件不受影响。','删除记录',()=>{try{localStorage.setItem(STORE,JSON.stringify(readRecords().filter(r=>r.id!==id)));showSaved();notify('这份记录已从浏览器删除。');}catch{notify('删除未成功，请检查浏览器存储权限后重试。');}});}
 else if(action==='export-text')textExport();
 else if(action==='export-png')await pngExport(button);
 else if(action==='feedback')feedback();
});
modal.addEventListener('cancel',()=>{pendingAction=null;aiSettingsDraft=null;pendingAiConsent=null;clearSensitiveInputs();});
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
window.addEventListener('pagehide',()=>{
  capture();invalidateAI();personalKey.clear();aiSettingsDraft=null;pendingAiConsent=null;clearSensitiveInputs();
  if(state.ai?.personalApiKey){state.ai.personalApiKey='';state.ai.credentialExpired=true;state.ai.status='error';state.ai.errorMessage='离开页面后，个人 Key 已清除。请先按原话整理，结束本次后重新设置。';}
});
window.addEventListener('pageshow',event=>{if(event.persisted){if(modal.open)closeModal();loadAiStatus();render();}});
window.addEventListener('beforeunload',event=>{capture();if(shouldWarnBeforeUnload(state.session)){event.preventDefault();event.returnValue='';}});
render();
loadAiStatus().then(()=>{if(new URL(location.href).searchParams.get('settings')==='ai')aiSettings();});
