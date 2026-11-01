// Explicit interaction syntax, not a semantic intention classifier. The Host
// re-derives this policy from bound statements; client flags are not authority.
const pairs = {'“':'”','「':'」','『':'』','"':'"','‘':'’',"'":"'"};
const trimControl = value => value.trim().replace(/[。！？!?；;，,\s]+$/u,'').trim().replace(/吧$/u,'').replace(/^(?:但|但是|不过|也)(?=别|不要|不用|不必|可以)/u,'');
function chunks(value) {
  if(value.includes('`'))return null;
  const result=[],stack=[],closing=new Set(Object.values(pairs));let start=0;
  for(let i=0;i<value.length;i++){
    const ch=value[i];
    if(stack.at(-1)===ch)stack.pop();
    else if(pairs[ch])stack.push(pairs[ch]);
    else if(closing.has(ch))return null;
    else if(!stack.length&&/[。！？!?；;，,\n]/u.test(ch)){result.push({text:value.slice(start,i+1),start,end:i+1});start=i+1;}
  }
  if(stack.length)return null;
  if(start<value.length)result.push({text:value.slice(start),start,end:value.length});return result;
}
function control(value) {
  const s=trimControl(value);
  // One explicit compound prohibition, not a general conjunction/intent
  // classifier. Quote/reporting scope is checked before this matcher runs.
  if(/^(?:我)?(?:先)?(?:别|不要|不用|不必|不需要)(?:再|继续)?(?:问|问我|问问题|追问|提问)(?:了)?(?:也|并且|而且|并|和)(?:不用|不要|不必|别|不需要)(?:再)?(?:分析|解释|建议|分析和建议|分析或建议)(?:了)?$/u.test(s))return {type:'listening',noQuestion:true};
  if(/^(?:(?:今天|现在|这次))?(?:我)?(?:只是想|只想|就想|只是|只|就)?(?:先)?(?:说说|吐槽|聊聊)(?:一下|而已|就好|就行)?$/u.test(s)||
    /^(?:你)?(?:先)?听(?:着|我说)?(?:就好|就行|即可)?$/u.test(s)||
    /^(?:我)?(?:先)?(?:不需要|不用|不要|不必|别)(?:再)?(?:分析|解释|建议|分析和建议|分析或建议)(?:了)?$/u.test(s))return {type:'listening'};
  if(/^(?:我)?(?:先)?(?:不要|不用|不必|不需要|别)(?:再|继续)?(?:追问|问|问我|问问题|提问)(?:了)?$/u.test(s)||
    /^(?:我)?(?:不想|不愿意)(?:再|继续)?回答(?:问题)?(?:了)?$/u.test(s))return {type:'no_question'};
  if(/^(?:你)?(?:现在)?(?:可以|请)(?:继续|再)?(?:追问|问|问我|问问题|提问)(?:了)?$/u.test(s)||/^恢复追问$/u.test(s))return {type:'allow_question'};
  if(/^(?:(?:我)?(?:想|希望)(?:你)?|请(?:你)?|帮我|请帮我|你可以|可以)?(?:一起)?(?:理清|分析|梳理|想想)(?:一下|这件事|思路)?$/u.test(s)||
    /^(?:我)?(?:想|希望)(?:你)?帮我(?:理清|分析|梳理)(?:一下|这件事)?$/u.test(s)||
    /^(?:我们)?一起(?:理清|分析|梳理|想想)(?:一下|这件事)?$/u.test(s)||
    /^(?:你的|你对这件事的)(?:拆解|分析|理解)(?:是什么|是怎样的|呢)$/u.test(s)||
    /^(?:请|可以|能|能不能|你可以|你能|你能不能)?(?:帮我)?(?:拆解|分析|梳理|理清)(?:一下|下|这件事|思路)?(?:吗|么)?$/u.test(s))return {type:'interpret'};
  if(/^(?:请(?:你|AI)?|请帮我|帮我|我想请(?:你|AI))?(?:把(?:这些话|这些内容|本次表达|这次表达|我的表达))?(?:整理成一份(?:整理|记录|报告)?|整理成稿|生成一份(?:整理|记录|报告)|写成一份记录|形成一份整理)(?:吧|就好|即可)?$/u.test(s))return {type:'review'};
  if(/^(?:请)?(?:先)?(?:暂停|暂停一下|停一下|取消等待|取消这次请求|取消本次请求)(?:吧)?$/u.test(s))return {type:'pause'};
  const end=/^(?:我)?(?:(?:不想|不愿意)(?:再|继续)?(?:聊|说)(?:了)?|不(?:聊|说)了)$/u.test(s)||
    /^(?:请)?(?:结束(?:本次|这次)?(?:对话|聊天)?(?:吧)?|(?:先|就)?(?:到这里|到这|这样)(?:吧|就好|就行)?)(?:且|并且|并|也)?(?:不保存|不用保存|不要保存)?$/u.test(s);
  if(end)return {type:'end',discard:/(?:不保存|不用保存|不要保存)$/u.test(s)};
  if(/^(?:这次|本次)?(?:不保存|不用保存|不要保存|丢弃本次内容)$/u.test(s))return {type:'discard'};
  if(/^(?:我)?(?:只想|只要|就想|就要|就|只)(?:把)?(?:留住|留下|保留|记录|记下|记住|记)(?:这一句|这句话|这句|原话|这一句话)(?:就好|就行|即可)?$/u.test(s))return {type:'record'};
  return null;
}
function reportedSpeech(value){
  const s=trimControl(value);
  if(!/(?:说|告诉|写道|写着|回复|表示|转述|引用)/u.test(s))return false;
  // “我想说一下周末的事” addresses this conversation, unlike “我对朋友说”
  // or “朋友说我今天没空”. Do not let an arbitrary occurrence of 说 hide the
  // person's following explicit controls; ambiguous reporting stays data.
  const current=/^(?:(?:今天|现在|这次))?我(?:(?:今天|现在|这次))?(?:(?:想|想要|只想|只是想|要|准备|希望)(?:说|聊|表达)|说一下|说说|聊聊|表达一下)/u.test(s);
  const other=/(?:他|她|别人|有人|朋友|同事|家人|妈妈|爸爸|邻居|店员)[^。！？!?\n，,；;]{0,12}(?:说|告诉|表示|回复|写道)/u.test(s);
  const past=/^我(?:(?:以前|曾经|之前|当时|那时|刚才|昨天|过去)|(?:对|跟|向))/u.test(s)||/^我说过/u.test(s);
  return !current||other||past;
}

export function expressionPartsV3(text) {
  if(typeof text!=='string')throw new TypeError('invalid_expression');
  const parts=chunks(text);if(!parts)return {content:text.trim(),controls:[]};
  const content=[],controls=[];let reported=false;
  for(const part of parts){
    const quoted=/[“”「」『』"‘’']/u.test(part.text),matched=!reported&&!quoted?control(part.text):null;
    if(matched)controls.push({...part,...matched});else content.push(part.text);
    // A comma after reported speech is not a fresh first-person instruction.
    // Stay conservative for a whole possible reported-speech sentence, even
    // when the reporting verb is not immediately before the comma. A fresh
    // sentence permits a subsequent explicit first-person instruction. A
    // newline alone after “她说：” does not end reported speech.
    if(!matched&&reportedSpeech(part.text))reported=true;
    if(/[。！？!?]\s*$/u.test(part.text))reported=false;
  }
  return {content:content.join('').trim(),controls};
}

export function deriveConversationPolicy(context) {
  // Intentionally accepts an internal prospective 13th statement so a local
  // stop still works at capacity. Wire validation owns the actual 12-source cap.
  if(!context||!Array.isArray(context.statements))throw new TypeError('invalid_policy_context');
  let allowQuestion=true,allowInterpretation=false,explicitInterpretationBan=false;
  const controls=[],materials=[];let latest=[];
  for(const [index,source]of context.statements.entries()){
    if(!source||typeof source.text!=='string'||typeof source.id!=='string')throw new TypeError('invalid_policy_source');
    const parts=expressionPartsV3(source.text),items=parts.controls.map(c=>({...c,sourceId:source.id}));
    controls.push(...items);if(index===context.statements.length-1)latest=items;
    if(parts.content&&source.kind!=='request')materials.push({id:source.id,text:parts.content});
    for(const c of items){
      if(c.type==='listening'){allowInterpretation=false;explicitInterpretationBan=true;}
      if(c.type==='interpret'){allowInterpretation=true;explicitInterpretationBan=false;}
      if(c.type==='no_question'||c.noQuestion===true)allowQuestion=false;
      if(c.type==='allow_question')allowQuestion=true;
    }
  }
  const has=type=>latest.some(c=>c.type===type);
  const endRequested=has('end'),pauseRequested=!endRequested&&has('pause');
  const discardRequested=has('discard')||latest.some(c=>c.discard===true);
  const reviewRequested=!endRequested&&!pauseRequested&&!discardRequested&&!context.allowNextStep&&(context.stage==='review'||has('review'));
  const recordOnly=!endRequested&&!pauseRequested&&!discardRequested&&!reviewRequested&&!context.allowNextStep&&has('record');
  // Default listening is not a permanent analysis ban. A typed/explicit review
  // may authorize analysis for that request, never subsequent reflection; an
  // earlier explicit ban still wins until the person explicitly changes it.
  const effectiveInterpretation=allowInterpretation||reviewRequested&&!explicitInterpretationBan;
  const actionRequested=!endRequested&&!pauseRequested&&!discardRequested&&context.allowNextStep===true;
  const kind=endRequested?'end':pauseRequested?'pause':reviewRequested?'review':recordOnly?'record':'respond';
  return {allowQuestion:allowQuestion&&!endRequested&&!pauseRequested&&!reviewRequested&&!actionRequested,
    allowInterpretation:effectiveInterpretation,reviewRequested,endRequested,pauseRequested,discardRequested,recordOnly,
    actionRequested,explicitInterpretationBan,materials,controls,intentAction:{kind,discard:discardRequested}};
}

// Preference changes alone are local. An explicit request to think together
// needs one real response when there is already material to think about.
export function shouldGenerateClarityReply(parts,policy){
  if(policy.endRequested||policy.pauseRequested||policy.recordOnly||policy.reviewRequested)return false;
  if(parts.content)return true;
  return policy.materials.length>0&&parts.controls.some(c=>c.type==='interpret');
}

export const shouldAssembleClarityReview=policy=>Boolean(policy.reviewRequested&&policy.materials.length&&!policy.endRequested&&!policy.pauseRequested);
