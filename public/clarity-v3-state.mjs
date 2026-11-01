// v3 working state. A model candidate is never a user's confirmed outcome.
import {buildClarityContext,validateClarityCandidate,CLARITY_FLOW,CLARITY_SCHEMA_VERSION} from './clarity-v3-contract.mjs';
import {deriveConversationPolicy,expressionPartsV3} from './clarity-v3-intent.mjs';
import {editClarityBlock as editStoredBlock,addClarityNote as addStoredNote,acknowledgeClarityReview as acknowledgeStoredReview,
  removeClarityBlock as removeStoredBlock,restoreClarityBlock as restoreStoredBlock,readClarityRecord,readRecordEntries,saveClarityRecord as saveStoredRecord,
  recordText,RECORD_STORE} from './clarity-state.mjs';
export {readClarityRecord,readRecordEntries,recordText,RECORD_STORE};
const copy=value=>structuredClone(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const uid=()=>crypto.randomUUID();
const active=s=>s.claims.filter(c=>!c.archived);
const wireClaims=s=>active(s).map(({id,type,text,evidenceIds,derivation,status})=>({id,type,text,evidenceIds:copy(evidenceIds),derivation,status}));
const sourceBinding=sources=>JSON.stringify(sources.map(({id,text,kind})=>({id,text,kind})));
export function currentClarityReply(s){
  const latest=s.messages.at(-1);
  return latest?.role==='assistant'&&latest.sourceBinding===sourceBinding(s.statements)?latest:null;
}

export function createClaritySession(){
  return {id:uid(),createdAt:new Date().toISOString(),modeId:'auto',goal:null,revision:0,stage:'express',
    statements:[],dialogue:[],claims:[],messages:[],question:null,review:null,removed:[],pending:null,failure:null,
    lastRequestAction:false,lastRequestKind:'reflect',callCount:0,dirty:false,stale:false,complete:false,reviewReady:false,
    paused:false,actionProposal:null,reviewConfirmed:false,confirmedBlockIds:[],confirmationTracked:false};
}

function rememberReviewConfirmation(s){
  if(!s.review)return;
  s.reviewConfirmed=true;s.confirmedBlockIds=s.review.blocks.map(b=>b.id);s.confirmationTracked=true;
}
function captureSavedReview(s){
  // A persisted format2 record has no transient claim metadata. The history
  // loader retains confirmed=true even if UI has already changed kept->exploring.
  if(s.review&&(s.stage==='kept'||s.confirmed===true&&!s.confirmationTracked))rememberReviewConfirmation(s);
}
export function invalidateClarity(s){
  captureSavedReview(s);
  s.revision++;s.pending=null;s.failure=null;s.dirty=true;
  if(s.stage==='kept')s.stage='reviewing';
}
export function pauseClaritySession(s){
  invalidateClarity(s);s.paused=true;return {ok:true};
}
export function resumeClaritySession(s){s.paused=false;s.failure=null;return {ok:true};}

export function conversationControl(s,value){
  if(typeof value!=='string')throw new TypeError('invalid_expression');
  // Prospective policy deliberately works at source capacity, including when
  // a large manual edit cannot be resent. It does not dispatch or add a source.
  return deriveConversationPolicy({sessionId:s.id,revision:s.revision+1,stage:'reflect',allowNextStep:false,
    modeId:s.modeId,goal:s.goal,statements:[...copy(s.statements),{id:`u${s.statements.length+1}`,kind:'expression',text:value}],
    dialogue:copy(s.dialogue),claims:wireClaims(s)});
}

export function addExpression(s,value,{kind='expression'}={}){
  if(!text(value,4000)||s.statements.length>=12||!['expression','correction','request'].includes(kind))throw new TypeError('invalid_expression');
  const question=s.question;
  invalidateClarity(s);s.paused=false;
  if(s.review&&kind!=='request')s.stale=true;
  s.complete=false;s.reviewReady=false;s.actionProposal=null;
  const entry={id:`u${s.statements.length+1}`,text:value.trim(),kind};s.statements.push(entry);
  if(question&&kind==='expression')s.dialogue.push({question:question.text,answerId:entry.id});
  s.lastAnsweredTarget=question?.target??null;
  s.messages.push({role:'user',statementId:entry.id});s.question=null;s.stage='exploring';return entry;
}
export function reviseExpression(s,statementId,value){
  const source=s.statements.find(x=>x.id===statementId);
  if(!source||!text(value,4000))throw new TypeError('invalid_expression');
  if(source.text===value.trim())return;
  invalidateClarity(s);source.text=value.trim();source.kind='correction';
  active(s).forEach(c=>{c.status='stale';});
  s.stale=true;s.complete=false;s.reviewReady=false;s.question=null;s.actionProposal=null;
}
export function wireSession(s){
  if(s.aiContextInvalid)throw new TypeError('manual_context_too_large');
  if(active(s).length>15)throw new TypeError('active_claims_limit');
  return {id:s.id,modeId:s.modeId,goal:s.goal,statements:copy(s.statements),dialogue:copy(s.dialogue),claims:wireClaims(s)};
}

export function beginClarityRequest(s,{action=false,review=false}={}){
  if(typeof action!=='boolean'||typeof review!=='boolean'||action&&review)throw new TypeError('invalid_request_kind');
  if(s.pending)throw new Error('request_in_progress');
  if(s.paused)throw new Error('conversation_paused');
  if(!s.statements.length)throw new Error('no_materials');
  const wire=wireSession(s),initial=buildClarityContext({session:wire,revision:s.revision,stage:action||review?'review':'reflect',allowNextStep:action});
  const policy=deriveConversationPolicy(initial);
  if(policy.endRequested||policy.pauseRequested||policy.recordOnly)throw new Error('local_control_required');
  if(policy.discardRequested&&(action||review))throw new Error('generation_not_allowed');
  if(!policy.materials.length)throw new Error('no_materials');
  const kind=action?'action':policy.reviewRequested?'review':'reflect';
  const context=buildClarityContext({session:wire,revision:s.revision,stage:kind==='reflect'?'reflect':'review',allowNextStep:action});
  captureSavedReview(s);
  const ticket={requestId:uid(),revision:s.revision,sessionId:s.id,kind,context};
  s.pending=copy(ticket);s.failure=null;s.lastRequestAction=action;s.lastRequestKind=kind;s.callCount++;
  return copy(ticket);
}
export const isCurrentClarity=(s,ticket)=>Boolean(!s.paused&&s.pending&&ticket&&s.id===ticket.sessionId&&s.revision===ticket.revision&&
  s.pending.requestId===ticket.requestId&&s.pending.kind===ticket.kind&&JSON.stringify(s.pending.context)===JSON.stringify(ticket.context));
export function failClarityRequest(s,ticket,reason){
  if(!isCurrentClarity(s,ticket))return {ok:false,reason:'inactive'};
  s.pending=null;s.failure=reason;return {ok:false,reason};
}

const groups={
  concern:[['context','你说过的',['event','thought','feeling']],['insight','可能的理解',['insight','need','tradeoff','option']],['unknown','还想确认的',['unknown']]],
  moment:[['context','这一刻',['event']],['insight','想留下的感受',['insight','feeling','need']],['unknown','还想慢慢想的',['unknown']]],
  choice:[['context','已有的表达',['need','event']],['insight','目前的考虑',['tradeoff','insight','option']],['unknown','还缺的信息',['unknown']]],
};
const materialText=s=>s.statements.filter(source=>source.kind!=='request').map(source=>expressionPartsV3(source.text).content).filter(Boolean).join('\n\n');
function fitsReview(review){return Boolean(review&&review.blocks.length<=6&&review.blocks.filter(b=>b.group==='main').length<=3&&
  review.blocks.every(b=>b.type!=='text'||typeof b.text==='string'&&b.text.length<=20000));}
export function composeClarityReview(s,title='这次留下的',finalClaimIds=null){
  const current=active(s).filter(c=>c.status!=='stale'&&c.type!=='action'),batch=finalClaimIds===null?null:new Set(finalClaimIds);
  const blocks=[];
  if(batch===null){
    const content=materialText(s);
    if(content)blocks.push({id:'context',type:'text',group:'main',label:'我写下的',text:content,claimIds:[],edited:false});
  }
  for(const [id,label,types]of groups[s.modeId]??groups.concern){
    if(batch===null&&id==='context')continue;
    const selected=batch?current.filter(c=>batch.has(c.id)&&types.includes(c.type)):[current.findLast(c=>types.includes(c.type))].filter(Boolean);
    const distinct=selected.filter((c,index)=>!selected.some((other,i)=>i!==index&&other.text.includes(c.text)&&(other.text!==c.text||i<index)));
    if(distinct.length)blocks.push({id,type:'text',group:'main',label,text:distinct.map(c=>c.text).join('\n\n'),claimIds:selected.map(c=>c.id),edited:false});
  }
  return {title,blocks};
}
function preserveReview(s,fresh,protectedIds=new Set()){
  if(!s.review)return {review:fresh,conflict:false};
  const confirmedIds=new Set(s.confirmedBlockIds??[]);
  const allProtected=new Set([...protectedIds,...s.claims.filter(c=>c.locked||['edited','confirmed'].includes(c.status)).map(c=>c.id)]);
  const preserved=s.review.blocks.filter(b=>b.edited||confirmedIds.has(b.id)||b.claimIds?.some(id=>allProtected.has(id)));
  const visible=b=>JSON.stringify({id:b.id,type:b.type,group:b.group,label:b.label,...(b.type==='text'?{text:b.text}:{rows:b.rows})});
  let conflict=preserved.some(old=>{const newer=fresh.blocks.find(b=>b.id===old.id);return !newer||visible(newer)!==visible(old);});
  const excluded=new Set(s.removed.map(x=>x.block.id));
  fresh.blocks=fresh.blocks.filter(b=>!excluded.has(b.id)).map(b=>copy(preserved.find(old=>old.id===b.id)??b));
  for(const block of preserved.filter(b=>!fresh.blocks.some(n=>n.id===b.id)))fresh.blocks.push(copy(block));
  const preservedIds=new Set(preserved.map(b=>b.id));
  let main=preserved.filter(b=>b.group==='main').length;
  fresh.blocks=fresh.blocks.map(b=>!preservedIds.has(b.id)&&b.group==='main'&&++main>3?{...b,group:'details'}:b);
  if(s.reviewConfirmed&&fresh.title!==s.review.title){fresh.title=s.review.title;conflict=true;}
  return {review:fresh,conflict};
}

export function applyClarityReply(s,ticket,envelope){
  if(!isCurrentClarity(s,ticket))return {ok:false,reason:'inactive'};
  if(envelope?.flow!==CLARITY_FLOW||envelope.schemaVersion!==CLARITY_SCHEMA_VERSION||envelope.requestId!==ticket.requestId||envelope.revision!==ticket.revision)
    return failClarityRequest(s,ticket,'invalid_response');
  if(envelope.status!=='candidate')return failClarityRequest(s,ticket,envelope.reason??'generation_failed');
  const checked=validateClarityCandidate(envelope.candidate,s.pending.context);
  if(!checked.ok)return failClarityRequest(s,ticket,checked.reason);
  const candidate=checked.candidate;
  // Plan on a copy so a capacity/protection failure never half-applies a batch.
  const next=copy(s);next.pending=null;next.failure=null;
  next.messages.push({role:'assistant',text:candidate.reply,question:candidate.question?.text??null,sourceBinding:sourceBinding(ticket.context.statements)});
  if(ticket.kind==='action'){
    if(candidate.claims.length!==1||candidate.claims[0].type!=='action')return failClarityRequest(s,ticket,'action_only');
    next.actionProposal={...copy(candidate.claims[0]),id:`a${ticket.revision}_${s.callCount}`,status:'candidate',archived:false};
    Object.assign(s,next);return {ok:true};
  }
  next.modeId=candidate.modeId;next.goal=candidate.goal;
  const accepted=[],protectedIds=new Set();let protectedConflict=false;
  for(const [index,item]of candidate.claims.entries()){
    const old=next.claims.filter(c=>!c.archived&&item.supersedes.includes(c.id));
    const protectedOld=old.filter(c=>c.locked||['edited','confirmed'].includes(c.status));
    if(protectedOld.length){protectedConflict=true;protectedOld.forEach(c=>protectedIds.add(c.id));continue;}
    old.forEach(c=>{c.archived=true;});
    const claim={...copy(item),id:`c${ticket.revision}_${s.callCount}_${index}`,status:'candidate',archived:false};
    next.claims.push(claim);accepted.push(claim.id);
  }
  if(active(next).length>15)return failClarityRequest(s,ticket,'active_claims_limit');
  next.question=candidate.question;
  next.stale=protectedConflict||active(next).some(c=>c.status==='stale')||(s.stale&&ticket.kind!=='review');
  next.reviewReady=ticket.kind==='review';next.complete=next.reviewReady;
  if(ticket.kind==='review'){
    const protectedReview=preserveReview(next,composeClarityReview(next,candidate.title,accepted),protectedIds);
    if(!fitsReview(protectedReview.review))return failClarityRequest(s,ticket,'review_capacity_exceeded');
    next.review=protectedReview.review;next.stale||=protectedReview.conflict;next.stage='reviewing';
  }else next.stage='exploring';
  Object.assign(s,next);return {ok:true};
}

export function openClarityReview(s){
  captureSavedReview(s);
  const protectedReview=s.review&&!s.stale?{review:copy(s.review),conflict:false}:preserveReview(s,composeClarityReview(s));
  if(!protectedReview.review.blocks.length)return {ok:false,reason:'no_materials'};
  invalidateClarity(s);
  s.review=protectedReview.review;s.stale||=protectedReview.conflict;
  s.reviewReady=true;s.complete=true;s.stage='reviewing';
  return {ok:true};
}
export function keepClarityVerbatim(s,value){
  if(s.stage!=='express'||s.pending||s.review||s.actionProposal||s.callCount!==0||s.statements.length||s.claims.length||s.messages.length||s.dialogue.length||s.removed.length||!text(value,4000))return {handled:false};
  const policy=conversationControl(s,value);
  if(!policy.recordOnly)return {handled:false};
  const content=expressionPartsV3(value).content;
  if(!content)return {handled:true,ok:false,reason:'missing_verbatim'};
  addExpression(s,value);s.modeId='moment';s.goal='留住原话';
  s.review={title:'想留下的一句话',blocks:[{id:'context',type:'text',group:'main',label:'我写下的',text:content,claimIds:[],edited:false}]};
  s.reviewReady=true;s.complete=true;s.stage='reviewing';return {handled:true,ok:true};
}
export function editClarityBlock(s,id,value){captureSavedReview(s);editStoredBlock(s,id,value);s.reviewReady=Boolean(s.review);s.complete=s.reviewReady;}
export function addClarityNote(s,value){captureSavedReview(s);addStoredNote(s,value);s.reviewReady=Boolean(s.review);s.complete=s.reviewReady;}
export function removeClarityBlock(s,id){captureSavedReview(s);removeStoredBlock(s,id);s.reviewReady=Boolean(s.review?.blocks.length);s.complete=s.reviewReady;}
export function restoreClarityBlock(s){captureSavedReview(s);restoreStoredBlock(s);s.reviewReady=Boolean(s.review?.blocks.length);s.complete=s.reviewReady;}
export function acknowledgeClarityReview(s){acknowledgeStoredReview(s);rememberReviewConfirmation(s);}
export function saveClarityRecord(s,storage){
  if(s.review&&!fitsReview(s.review))return {ok:false,reason:'review_capacity_exceeded'};
  const result=saveStoredRecord(s,storage);if(result.ok)rememberReviewConfirmation(s);return result;
}
export function exportWorkingText(s){
  // A working download is distinct from a personal report: preserve exact
  // original statements, including the person's own interaction instructions.
  const original=s.statements.map(source=>source.text).join('\n\n');
  const parts=original?['本次工作文字（含本人交流指令）\n'+original]:[],edits=s.review?.blocks.filter(b=>b.edited&&b.type==='text').map(b=>`${b.label}\n${b.text}`)??[];
  if(edits.length)parts.push('我修改或补充的文字\n'+edits.join('\n\n'));
  return parts.filter(Boolean).join('\n\n');
}
