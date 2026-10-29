import { MODES, CARDS, createSession, makeReview, validateSavedRecord, shouldWarnBeforeUnload } from './core.mjs';

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
const getMode = () => MODES.find(m => m.id === (state.session?.modeId || state.modeId));
const getCard = () => CARDS.find(c => c.id === state.session?.cardId);
const dateLabel = value => new Intl.DateTimeFormat('zh-CN', { year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Shanghai' }).format(new Date(value));
const fileDate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function notify(message) { clearTimeout(noticeTimer); const n=document.querySelector('#notice'); n.textContent=message; n.classList.add('show'); noticeTimer=setTimeout(()=>n.classList.remove('show'),4200); }
function go(screen) { state.screen=screen; render(); window.scrollTo({top:0,behavior:'instant'}); main.focus({preventScroll:true}); }
function capture() {
  if(!state.session) return;
  const input=document.querySelector('#entry');
  if(input) {
    if(state.screen==='story')state.session.story=input.value;
    if(state.screen==='focus')state.session.focus=input.value;
    if(state.screen==='card')state.session.cardReflection=input.value;
    if(state.screen==='reflect')state.session.answers[getMode().questions[state.question].id]=input.value;
  }
  if(state.screen==='review' && state.session.review) {
    const title=document.querySelector('#review-title'); if(title)state.session.review.title=title.value;
    document.querySelectorAll('[data-review-index]').forEach(input=>{const section=state.session.review.sections[Number(input.dataset.reviewIndex)];if(section)section.text=input.value;});
  }
}
function start(modeId=state.modeId) { state={screen:'story',modeId,session:createSession(modeId),question:0};feedbackDraft={};render();window.scrollTo(0,0);main.focus(); }
function home() { state={screen:'home',modeId:state.modeId,session:null,question:0};feedbackDraft={};render();window.scrollTo(0,0);main.focus(); }
function inputMarkup(value,placeholder,{max=4000,rows=6,cls='answer-input'}={}) {return `<textarea id="entry" class="${cls}" maxlength="${max}" rows="${rows}" aria-labelledby="question-title" placeholder="${e(placeholder)}">${e(value)}</textarea><div class="input-meta"><span>可以使用手机键盘的语音输入。页面不录音。</span><span id="char-count">${String(value??'').length} / ${max}</span></div>`;}
function sourceSnippet() {return state.session?.story ? `<details class="source-snippet"><summary>看看最开始写下的事</summary>${e(state.session.story)}</details>` : '';}
function layout(body,{title='慢慢来，\n不用一次想清楚。',note='你可以跳过问题，也可以随时结束。',art=null}={}) {
 const positions={story:0,focus:1,card:2,reflect:3,review:4};const current=positions[state.screen]??0;
 return `<section class="workspace"><div class="workspace-top"><ol class="step-list" aria-label="体验进度">${['讲一件事','选焦点','换个角度','慢慢想','整理'].map((label,i)=>`<li ${i===current?'aria-current="step"':''} class="${i<current?'complete':''}"><span class="step-dot" aria-hidden="true"></span>${label}</li>`).join('')}</ol><button class="end-button text-button" data-action="exit">结束本次</button></div><div class="workspace-body"><aside class="aside"><div class="aside-label">${e(getMode().label)}</div><h2>${e(title).replace(/\n/g,'<br>')}</h2><p>${e(note)}</p>${art?`<img class="aside-illustration" src="./assets/${e(art)}.svg" alt="生活场景插画">`:sourceSnippet()}</aside><div class="panel">${body}</div></div></section>`;
}
function renderHome() {
 return `<section class="home"><div class="hero"><div class="hero-copy"><svg class="tiny-flower" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34V20m0 7c-10 0-12-6-9-9 5 0 9 5 9 9m0-4c8 0 13-6 10-9-5 0-10 4-10 9"/><circle cx="20" cy="10" r="4"/><path d="M20 3v3m0 8v3M13 10h3m8 0h3m-12-5 2 2m6 6 2 2m0-10-2 2m-6 6-2 2"/></svg><h1>给今天<br>留一点空白。</h1><p class="hero-intro">一个开心的瞬间，一点说不清的烦，<br>或一个还没想好的选择。<br>从一件小事开始，慢慢整理成自己的答案。</p><button class="primary" data-action="start">从一件小事开始 ${icon}</button><p class="hero-meta"><span>约 5–8 分钟</span><span>随时可以结束</span></p></div><div class="hero-art" aria-label="留白、微光与连接主题的生活插画卡"><div class="art-card art-left"><img src="./assets/glow.svg" alt="桌灯、书与花"></div><div class="art-card art-right"><img src="./assets/connect.svg" alt="圆桌上的两只杯子"></div><div class="art-card art-front"><img src="./assets/pause.svg" alt="窗边有一把椅子，阳光静静落下"></div><p class="art-note">一张卡，一个看生活的新角度。</p></div></div><div class="topic-strip"><p class="topic-heading">今天，想从哪里开始？</p><div class="topics">${MODES.map((m,i)=>`<button class="topic" data-action="mode" data-mode="${m.id}" aria-pressed="${state.modeId===m.id}"><span class="topic-icon" aria-hidden="true">${['☼','〰','⌁'][i]}</span><span><strong>${['想留住的片刻','挂在心上的事','还没想好的选择'][i]}</strong><small>${e(m.description)}</small></span></button>`).join('')}</div></div><p class="prototype-note">这是固定问题引导的体验原型。你的文字只在当前浏览器中处理；选择保存后，记录才会留在这台设备。<button class="text-button" data-action="example">先看一个例子</button></p></section>`;
}
function renderStory() {const m=getMode();return layout(`<h1 id="question-title">${e(m.opening)}</h1><p class="intro">不用先想好怎么说。零散的一两句，也可以。</p><form id="step-form">${inputMarkup(state.session.story,'可以从“今天有一幕……”开始。',{cls:'story-input'})}<div id="input-error" class="error-text" role="alert"></div><div class="actions"><button type="button" class="back-button" data-action="exit">先不聊了</button><button class="primary" type="submit">我写好了 ${icon}</button></div></form><details class="help-options"><summary>还不知道从哪里开始？</summary><div class="hint-chips"><button class="chip" data-action="hint" data-text="今天让我停了一下的瞬间是……">一个让我停下来的瞬间</button><button class="chip" data-action="hint" data-text="最近我反复想到的一件事是……">最近反复想到的事</button><button class="chip" data-action="hint" data-text="我还没决定的是……">一个还没决定的小事</button></div></details>`,{title:'先给这件小事，\n一点说出来的空间。',note:'这里没有标准答案。先写下你愿意表达的部分。',art:'pause'});}
function renderFocus() {return layout(`<h1 id="question-title">${e(getMode().focusPrompt)}</h1><p class="intro">可以选一个细节、一种感受，或者只是把这件事放在这里。</p><form id="step-form">${inputMarkup(state.session.focus,'这一次，我比较想聊……',{max:1500,rows:4})}<div class="actions"><button type="button" class="back-button" data-action="back">返回修改</button><button type="button" class="quiet-button" data-action="skip-focus">先继续看看</button><button class="primary" type="submit">从这里继续 ${icon}</button></div></form>`,{title:'这一次，\n先聊你在意的部分。',note:'这版原型会按主题给出固定问题，整理时保留你的原话。'});}
function renderCard() {const c=getCard();return layout(`<h1 id="question-title">${c?e(c.prompt):'给这件事，换一个观看角度。'}</h1><p class="intro">随机的图像联想提示。贴不贴切，都由你来决定。</p>${c?`<div class="selected-card reveal"><img src="./assets/${c.art}.svg" alt="${e(c.name)}主题生活插画"><div><h2>${e(c.name)}</h2><p>${e(c.caption)}</p><p class="caption">卡片提供角度，记录来自你的表达。</p><button class="text-button" data-action="redraw">换一张</button></div></div><form id="step-form"><label class="field-label" for="entry">有什么联想？没有也可以留空。</label>${inputMarkup(state.session.cardReflection,'这张图让我想起……',{max:1500,rows:3})}<div class="actions"><button type="button" class="back-button" data-action="back">返回</button><button type="button" class="quiet-button" data-action="skip-card">跳过卡片</button><button class="primary" type="submit">继续聊 ${icon}</button></div></form>`:`<button class="card-back" data-action="draw" aria-label="翻一张联想卡">${windowIcon}<span>翻一张卡</span></button><div class="actions center-actions"><button class="quiet-button" data-action="skip-card">直接聊，跳过卡片</button></div>`}`,{title:'一张图，\n也许带来一点联想。',note:'你可以换一张，也可以直接继续。卡片没有预设的“正确解释”。'});}
function renderReflect() {const q=getMode().questions[state.question];return layout(`<p class="question-count">第 ${state.question+1} 个问题，共 3 个</p><h1 id="question-title">${e(q.prompt)}</h1><p class="intro">写到觉得够了，就可以开始整理。</p><form id="step-form">${inputMarkup(state.session.answers[q.id]||'',q.placeholder,{max:3000,rows:5})}<div class="actions"><button type="button" class="back-button" data-action="back">返回</button><button class="primary" type="submit">${state.question===2?'开始整理':'写好了，继续'} ${icon}</button></div><div class="actions"><button type="button" class="quiet-button" data-action="skip-question">这一题先跳过</button><button type="button" class="quiet-button" data-action="review-early">到这里就够了</button></div></form>`,{title:state.question===2?'留下一点发现，\n就已经很好。':'给自己的想法，\n多一点耐心。',note:state.question===2?'你可以只把这件事记住。下一步行动是可选的。':'回答可以很短，也可以暂时不知道。'});}
function originalFor(id) {if(['story','focus','cardReflection'].includes(id))return state.session[id];return state.session.answers[id];}
function renderReview() {const r=state.session.review;return layout(`<h1>把它改成你的意思。</h1><p class="intro">以下按话题归档了你的原话。请删掉不想留下的内容，改写成你认可的记录。</p><div class="review-note">这份草稿未作 AI 解读。保存和导出的内容，以你确认后的版本为准。</div><form id="step-form"><label class="field-label" for="review-title">给这次记录起个名字</label><input id="review-title" class="title-input" maxlength="80" value="${e(r.title)}">${r.sections.map((s,i)=>`<section class="review-section"><div class="review-section-top"><label for="review-${i}">${e(s.label)}</label><button class="remove-section" type="button" data-action="remove-section" data-index="${i}">删除这一项</button></div><textarea class="review-text" id="review-${i}" data-review-index="${i}" maxlength="20000">${e(s.text)}</textarea><span class="source-label">来源：${e(s.source)}</span><button class="text-button" type="button" data-action="uncertain" data-index="${i}" aria-pressed="${s.label.endsWith('（还不确定）')}">${s.label.endsWith('（还不确定）')?'取消不确定标记':'标为还不确定'}</button>${originalFor(s.id)?`<details class="source-snippet"><summary>对照原话</summary>${e(originalFor(s.id))}</details>`:''}</section>`).join('')}<div id="input-error" class="error-text" role="alert"></div><div class="actions"><button type="button" class="back-button" data-action="exit">结束本次</button><button class="primary" type="submit">确认这份记录 ${icon}</button></div></form>`,{title:'你的表达，\n由你来确认。',note:'可以保留不确定性，也可以只留下一句回忆。不会自动替你补充结论。',art:getCard()?.art||'glow'});}
function renderDone() {const r=state.session.review;return `<section class="done-wrap"><div class="done-heading"><h1>今天，先整理到这里。</h1><p>有些已经清楚一点，有些可以以后再想。</p></div><article class="keepsake"><div class="keepsake-head"><span>留白 · 我的生活片刻</span><time datetime="${e(state.session.createdAt)}">${e(dateLabel(state.session.createdAt))}</time></div><h2>${e(r.title)}</h2>${r.sections.map(s=>`<section class="keepsake-section"><h3>${e(s.label)}</h3><p>${e(s.text)}</p></section>`).join('')}<div class="keepsake-bottom">给生活留一点自己的余地。</div></article><div class="actions done-actions"><button class="primary" data-action="save">保存在这台设备</button><button class="secondary" data-action="export-png">导出图片</button><button class="secondary" data-action="export-text">下载文字</button></div><p class="gentle-note" style="text-align:center">保存仅包含这份确认后的记录。导出内容可能包含私密信息，分享前请自行检查。</p><div class="done-secondary"><button class="quiet-button" data-action="edit-review">再改一下</button><button class="quiet-button" data-action="feedback">留下体验反馈</button><button class="quiet-button" data-action="exit">结束并清除本次输入</button></div></section>`;}
function render() {const screens={home:renderHome,story:renderStory,focus:renderFocus,card:renderCard,reflect:renderReflect,review:renderReview,done:renderDone};main.innerHTML=screens[state.screen]();}
function makeDraft() {capture();state.session.review=makeReview(state.session);state.session.confirmed=false;go('review');}
function nextQuestion(skip=false) {if(skip){state.session.answers[getMode().questions[state.question].id]='';const input=document.querySelector('#entry');if(input)input.value='';}else capture();if(state.question<2){state.question++;go('reflect');}else makeDraft();}
function showError(text) {const target=document.querySelector('#input-error');target.textContent=text;document.querySelector('#entry,#review-title')?.focus();}
function submitStep(event) {
 event.preventDefault();capture();
 if(state.screen==='story'){if(!state.session.story.trim()){showError('先写下一点你愿意分享的内容，一句话也可以。');return;}go('focus');}
 else if(state.screen==='focus')go('card');
 else if(state.screen==='card'){state.question=0;go('reflect');}
 else if(state.screen==='reflect')nextQuestion();
 else if(state.screen==='review'){
   const r=state.session.review; if(!r.title.trim()){showError('给这次记录留一个名字。');return;}
   if(!r.sections.some(s=>s.text.trim())){showError('至少留下一段你想记录的内容。可以返回首页重新开始。');return;}
   r.sections=r.sections.filter(s=>s.text.trim());state.session.confirmed=true;go('done');
 }
}
function openModal(title,body) {focusBeforeModal=document.activeElement;modalContent.innerHTML=`<div class="modal-header"><h2 id="modal-title">${e(title)}</h2><button class="close-button" data-action="close-modal" aria-label="关闭">×</button></div>${body}`;if(!modal.open)modal.showModal();modalContent.querySelector('button')?.focus();}
function closeModal(){pendingAction=null;modal.close();focusBeforeModal?.isConnected&&focusBeforeModal.focus();}
function ask(title,body,label,callback){pendingAction=callback;openModal(title,`<p>${e(body)}</p><div class="modal-actions"><button class="secondary" data-action="close-modal">再待一会儿</button><button class="primary" data-action="confirm-action">${e(label)}</button></div>`);}
function exitSession(){if(!state.session){home();return;}capture();ask('这次先到这里？','尚未保存的输入会从当前页面清除。已经保存到这台设备或导出的记录会保留。','清除本次并结束',()=>{home();notify('本次输入已清除。');});}
function readRecords(){try{const raw=localStorage.getItem(STORE);if(!raw)return [];if(raw.length>5000000)throw Error('large');const data=JSON.parse(raw);if(!Array.isArray(data))return [];return data.slice(0,30).map(validateSavedRecord).filter(Boolean);}catch{return [];}}
function saveRecord(){const raw={...state.session,story:'',focus:'',cardReflection:'',answers:{},confirmed:true};const record=validateSavedRecord(raw);if(!record){notify('记录内容不完整或过长，请修改后重试。');return;}try{const items=readRecords().filter(x=>x.id!==record.id);if(items.length>=30){notify('这台设备已有 30 份记录。请先删除一些，或导出当前记录。');return;}localStorage.setItem(STORE,JSON.stringify([record,...items]));notify('已保存在这台设备。可在“我的记录”中查看或删除。');}catch{notify('浏览器没有允许保存，或存储空间不足。可以下载文字。');}}
function showSaved(){const items=readRecords();openModal('我的记录',`<p>仅保存在这个浏览器中，不跨设备同步。</p>${items.length?`<ul class="record-list">${items.map(r=>`<li class="record-row"><button class="record-open" data-action="open-record" data-id="${e(r.id)}"><strong>${e(r.review.title)}</strong><small>${e(dateLabel(r.createdAt))}</small></button><button class="text-button danger" data-action="delete-record" data-id="${e(r.id)}">删除</button></li>`).join('')}</ul>`:'<div class="empty-state">还没有保存的记录。<br>完成一次整理后，可以选择留在这里。</div>'}`);}
function about(){openModal('关于这次体验',`<p>留白是一个生活片刻整理原型，用固定问题和可选的图像卡，帮助你记录与回看自己的表达。</p><h3>这一版怎样工作</h3><ul><li>按你选择的主题提供固定问题，尚未接入生成式 AI。</li><li>整理草稿来自你填写的原话，修改和确认由你完成。</li><li>卡片随机出现，作为联想提示；可以更换或跳过。</li></ul><h3>你的内容如何处理</h3><p>输入只在当前浏览器中处理，不发送给模型服务或站点服务器。进行中的内容仅在页面内存中，刷新或结束会清除。</p><p>点击“保存在这台设备”才会写入浏览器存储，只保存确认后的记录。你可以在“我的记录”逐条删除；共用设备上的其他使用者可能看到这些记录。</p><p>本页不请求麦克风权限。若使用手机键盘的语音输入，音频处理由你的输入法和设备设置决定。</p><p>站点托管服务可能处理常规访问日志。此原型不上传复盘正文或自动收集体验反馈。反馈由你下载后自行决定是否提供给测试组织者。</p>`);}
function example(){openModal('一份记录可以很简单',`<p>这是虚构示例，不会写入你的记录。</p><div class="example-note"><p>周末和朋友散步，没有提前安排全部行程。走到哪儿，想坐就坐。</p><p>我注意到，自己喜欢一点临时决定的余地。</p><p>想试试：周三晚上留一个小时，不提前安排。</p></div><p>也可以只留下一句：“今天路边的桂花很香，我想记住。”</p><div class="modal-actions"><button class="primary" data-action="start-from-modal">聊聊我的小事</button></div>`);}
function drawCard(){const options=CARDS.filter(c=>c.id!==state.session.cardId);const n=new Uint32Array(1);crypto.getRandomValues(n);state.session.cardId=options[n[0]%options.length].id;render();main.focus({preventScroll:true});}
function download(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function textExport(){const r=state.session.review;const content=`${r.title}\n${dateLabel(state.session.createdAt)}\n\n${r.sections.map(s=>`${s.label}\n${s.text}`).join('\n\n')}\n\n留白 · 我的生活片刻\n`;download(new Blob([content],{type:'text/plain;charset=utf-8'}),`留白-${fileDate()}.txt`);notify('文字下载已发起。');}
async function pngExport(button){button.disabled=true;try{
 const r=state.session.review;const c=document.createElement('canvas');const ctx=c.getContext('2d');if(!ctx)throw Error();
 const width=1000,pad=76,contentWidth=width-2*pad;const font='"Microsoft YaHei", "PingFang SC", sans-serif';
 const wrap=(text,size)=>{ctx.font=`${size}px ${font}`;const lines=[];for(const p of String(text).split('\n')){let line='';for(const ch of p){if(ctx.measureText(line+ch).width>contentWidth&&line){lines.push(line);line='';}line+=ch;}lines.push(line);}return lines;};
 const titles=wrap(r.title,42);const sections=r.sections.map(s=>({...s,lines:wrap(s.text,26),labelLines:wrap(s.label,22)}));
 const height=240+titles.length*61+sections.reduce((n,s)=>n+60+s.labelLines.length*34+s.lines.length*44,0)+110;
 if(height>24000){notify('这份记录较长，请使用“下载文字”完整保存。');return;}
 c.width=width;c.height=height;ctx.fillStyle='#f8f7f3';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#bdc9b4';ctx.lineWidth=2;ctx.strokeRect(30,30,width-60,height-60);
 ctx.fillStyle='#667168';ctx.font=`20px ${font}`;ctx.fillText('留白 · 我的生活片刻',pad,95);ctx.textAlign='right';ctx.fillText(dateLabel(state.session.createdAt),width-pad,95);ctx.textAlign='left';ctx.beginPath();ctx.moveTo(pad,124);ctx.lineTo(width-pad,124);ctx.stroke();let y=190;
 ctx.fillStyle='#293a31';ctx.font=`42px ${font}`;for(const line of titles){ctx.fillText(line,pad,y);y+=61;}y+=18;
 for(const s of sections){ctx.fillStyle='#667168';ctx.font=`22px ${font}`;for(const line of s.labelLines){ctx.fillText(line,pad,y);y+=34;}y+=12;ctx.fillStyle='#293a31';ctx.font=`26px ${font}`;for(const line of s.lines){ctx.fillText(line,pad,y);y+=44;}y+=48;}
 ctx.fillStyle='#667168';ctx.font=`20px ${font}`;ctx.fillText('给生活留一点自己的余地。',pad,height-80);
 const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error()),'image/png'));download(blob,`留白-${fileDate()}.png`);notify('图片下载已发起。分享前请检查私密内容。');
 }catch{notify('图片未能导出。请使用“下载文字”，或换一个浏览器重试。');}finally{button.disabled=false;}}
const feedbackQuestions=[['purpose','你觉得这个工具刚才主要在帮你做什么？'],['friction','哪一步你最想跳过、修改或退出？'],['accuracy','整理里有什么与你想表达的不一样？'],['card','卡片出现后，你想说的内容有什么变化？']];
function feedback(){openModal('留下体验反馈',`<p>反馈不会自动附带你的复盘内容。文件仅下载到设备，是否交给测试组织者由你决定。</p><form id="feedback-form">${feedbackQuestions.map(([id,label])=>`<div class="feedback-field"><label for="fb-${id}">${label}</label><textarea id="fb-${id}" name="${id}" maxlength="1500" placeholder="可以留空">${e(feedbackDraft[id]||'')}</textarea></div>`).join('')}<div class="feedback-field"><label for="fb-clarity">现在你对那件事的理解是？</label><select id="fb-clarity" name="clarity"><option value="">暂不评价</option value="clearer">更清楚了</option><option value="same">差不多</option><option value="less-clear">更乱了</option></select></div><div class="modal-actions"><button class="primary" type="submit">下载反馈文件</button></div></form>`);document.querySelector('#fb-clarity').value=feedbackDraft.clarity||'';}

document.addEventListener('submit',event=>{if(event.target.id==='step-form')submitStep(event);if(event.target.id==='feedback-form'){event.preventDefault();feedbackDraft=Object.fromEntries(new FormData(event.target));const data={version:'0.1',createdAt:new Date().toISOString(),theme:state.session?.modeId||null,usedCard:!!state.session?.cardId,feedback:feedbackDraft};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),`留白-体验反馈-${fileDate()}.json`);notify('反馈文件已下载。没有上传。');}});
document.addEventListener('input',event=>{if(event.target.id==='entry'){document.querySelector('#char-count').textContent=`${event.target.value.length} / ${event.target.maxLength}`;document.querySelector('#input-error')?.replaceChildren();}if(event.target.closest('#feedback-form'))feedbackDraft=Object.fromEntries(new FormData(document.querySelector('#feedback-form')));});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
 if(action==='start')start();
 else if(action==='start-from-modal'){closeModal();start();}
 else if(action==='mode'){state.modeId=button.dataset.mode;render();document.querySelector(`[data-mode="${state.modeId}"]`)?.focus({preventScroll:true});}
 else if(action==='home'){if(state.session)exitSession();else home();}
 else if(action==='exit')exitSession();
 else if(action==='about')about();
 else if(action==='example')example();
 else if(action==='close-modal')closeModal();
 else if(action==='confirm-action'){const callback=pendingAction;closeModal();callback?.();}
 else if(action==='hint'){const input=document.querySelector('#entry');if(!input.value.trim()){input.value=button.dataset.text;input.dispatchEvent(new Event('input',{bubbles:true}));}input.focus();}
 else if(action==='skip-focus'){capture();go('card');}
 else if(action==='draw')drawCard();
 else if(action==='redraw'){capture();if(state.session.cardReflection.trim())ask('换一个角度？','换卡会清除这张卡的联想文字，之前讲述的事情和焦点会保留。','清除联想并换卡',()=>{state.session.cardReflection='';drawCard();});else drawCard();}
 else if(action==='skip-card'){capture();state.session.cardId=null;state.session.cardReflection='';state.question=0;state.screen='reflect';render();main.focus();window.scrollTo(0,0);}
 else if(action==='skip-question'){capture();if(state.session.answers[getMode().questions[state.question].id]?.trim())ask('跳过这一题？','这一题已输入的文字将被清除，不会放入复盘记录。其他回答会保留。','清除这一题并跳过',()=>nextQuestion(true));else nextQuestion(true);}
 else if(action==='review-early')makeDraft();
 else if(action==='back'){capture();if(state.screen==='focus')go('story');else if(state.screen==='card')go('focus');else if(state.screen==='reflect'){if(state.question>0){state.question--;go('reflect');}else go('card');}}
 else if(action==='remove-section'){capture();state.session.review.sections.splice(Number(button.dataset.index),1);render();main.focus({preventScroll:true});}
 else if(action==='uncertain'){capture();const s=state.session.review.sections[Number(button.dataset.index)];s.label=s.label.endsWith('（还不确定）')?s.label.replace(/（还不确定）$/,''):s.label+'（还不确定）';render();main.focus({preventScroll:true});}
 else if(action==='edit-review'){state.session.confirmed=false;go('review');}
 else if(action==='save')saveRecord();
 else if(action==='saved'){capture();showSaved();}
 else if(action==='open-record'){const item=readRecords().find(r=>r.id===button.dataset.id);if(!item)return;const open=()=>{state={screen:'done',modeId:item.modeId,session:structuredClone(item),question:0};feedbackDraft={};render();main.focus();window.scrollTo(0,0);};if(state.session)ask('打开这份记录？','当前尚未保存的输入将被清除。','打开记录',open);else{closeModal();open();}}
 else if(action==='delete-record'){const id=button.dataset.id;ask('删除这份记录？','它将从这个浏览器中删除，已下载的文件不受影响。','删除记录',()=>{try{localStorage.setItem(STORE,JSON.stringify(readRecords().filter(r=>r.id!==id)));showSaved();notify('这份记录已从浏览器删除。');}catch{notify('删除未成功，请检查浏览器存储权限后重试。');}});}
 else if(action==='export-text')textExport();
 else if(action==='export-png')await pngExport(button);
 else if(action==='feedback')feedback();
});
modal.addEventListener('cancel',()=>{pendingAction=null;});
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
window.addEventListener('beforeunload',event=>{capture();if(shouldWarnBeforeUnload(state.session)){event.preventDefault();event.returnValue='';}});
render();
