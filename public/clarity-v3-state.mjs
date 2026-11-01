// v3 working state. A model candidate is never a user's confirmed outcome.
import {buildClarityContext,validateClarityCandidate,CLARITY_FLOW,CLARITY_SCHEMA_VERSION,CLARITY_POLICY_VERSION} from './clarity-v3-contract.mjs';
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
export function currentClarityUnderstanding(s){
  if(s.pending||s.paused||s.failure||s.aiContextInvalid)return [];
  const message=currentClarityReply(s);
  if(!Array.isArray(message?.claimIds))return [];
  return message.claimIds.map(id=>s.claims.find(c=>c.id===id&&!c.archived&&c.status!=='stale'&&['insight','tradeoff'].includes(c.type))).filter(Boolean).map(copy);
}
export function historicalClarityUnderstanding(message){
  if(message?.role!=='assistant'||!Array.isArray(message.claimIds)||!Array.isArray(message.understanding))return [];
  // A manual edit can change a working claim. History retains the exact
  // provisional wording that this actual response previously displayed.
  return message.understanding.filter(c=>message.claimIds.includes(c.id)&&['insight','tradeoff'].includes(c.type)).map(copy);
}

export function createClaritySession(){
  return {id:uid(),createdAt:new Date().toISOString(),modeId:'auto',goal:null,revision:0,stage:'express',
    statements:[],dialogue:[],claims:[],messages:[],question:null,review:null,removed:[],pending:null,failure:null,
    lastRequestAction:false,lastRequestKind:'reflect',callCount:0,dirty:false,stale:false,complete:false,reviewReady:false,
    paused:false,actionProposal:null,reviewConfirmed:false,confirmedBlockIds:[],confirmationTracked:false,reviewEditSourceIds:[]};
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
  // A direct user revision is now an authored expression, even when this ID
  // originally came from the Host's manual-review wrapper.
  s.reviewEditSourceIds=(s.reviewEditSourceIds??[]).filter(id=>id!==statementId);
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
  const ticket={requestId:uid(),revision:s.revision,sessionId:s.id,kind,policyVersion:CLARITY_POLICY_VERSION,context};
  s.pending=copy(ticket);s.failure=null;s.lastRequestAction=action;s.lastRequestKind=kind;s.callCount++;
  return copy(ticket);
}
export const isCurrentClarity=(s,ticket)=>Boolean(!s.paused&&s.pending&&ticket&&s.id===ticket.sessionId&&s.revision===ticket.revision&&
  s.pending.requestId===ticket.requestId&&s.pending.kind===ticket.kind&&s.pending.policyVersion===ticket.policyVersion&&
  ticket.policyVersion===CLARITY_POLICY_VERSION&&JSON.stringify(s.pending.context)===JSON.stringify(ticket.context));
export function failClarityRequest(s,ticket,reason){
  if(!isCurrentClarity(s,ticket))return {ok:false,reason:'inactive'};
  s.pending=null;s.failure=reason;return {ok:false,reason};
}

const groups=[
  ['insight','一点可能的理解',['insight','tradeoff']],
  ['self','此刻的感受与在意',['thought','feeling','need','option']],
  ['unknown','还想确认的',['unknown']],
];
const materialText=s=>{
  const hostEdits=new Set(s.reviewEditSourceIds??[]);
  return deriveConversationPolicy({statements:s.statements.filter(source=>!hostEdits.has(source.id)),stage:'reflect',allowNextStep:false})
    .materials.map(source=>source.text).join('\n\n');
};
function fitsReview(review){return Boolean(review&&review.blocks.length<=6&&review.blocks.filter(b=>b.group==='main').length<=3&&
  review.blocks.every(b=>b.type!=='text'||typeof b.text==='string'&&b.text.length<=20000));}
export function composeClarityReview(s,title='这次留下的',finalClaimIds=null){
  const batch=finalClaimIds===null?null:new Set(finalClaimIds);
  const current=active(s).filter(c=>c.status!=='stale'&&!['action','event'].includes(c.type)&&(!batch||batch.has(c.id)));
  const blocks=[];
  for(const [id,label,types]of groups){
    const selected=current.filter(c=>types.includes(c.type));
    // Each non-event candidate remains visible, in its original order. A
    // second insight is not discarded merely because it shares a type.
    if(selected.length)blocks.push({id,type:'text',group:'main',label,text:selected.map(c=>c.text).join('\n\n'),claimIds:selected.map(c=>c.id),edited:false});
  }
  const content=materialText(s);
  // Original life expressions belong to the Host. They are not a model claim,
  // inferred understanding, transcript of questions, or interaction controls.
  if(content)blocks.push({id:'source',type:'text',group:blocks.length?'details':'main',label:'保留的原话',text:content,claimIds:[],edited:false});
  return {title,blocks};
}

export function reviewPresentation(s){
  const blocks=s.review?.blocks??[],hasSource=blocks.some(b=>b.id==='source');
  const privacy=hasSource?'确认后，将记录和保留的原话存到这台设备。':'确认后，将这份记录存到这台设备。';
  const neutral={kind:'record',label:'这份记录',note:'',privacy};
  // Persisted format2 records intentionally omit claim types. Neither an old
  // block id nor a person's hand edit proves that an understanding was made.
  if(!s.statements?.length||s.stage==='kept'||s.confirmed===true||s.reviewConfirmed||blocks.some(b=>b.edited)||s.stale)return neutral;
  const shown=new Set(blocks.flatMap(b=>b.claimIds??[]));
  const possible=active(s).some(c=>shown.has(c.id)&&c.status!=='stale'&&['insight','tradeoff'].includes(c.type));
  if(possible)return {kind:'candidate',label:'目前留下的',note:'',privacy};
  const policy=deriveConversationPolicy({statements:s.statements,stage:'reflect',allowNextStep:false});
  const preference=policy.controls.findLast(c=>['listening','interpret'].includes(c.type));
  const requestedUnderstanding=policy.allowInterpretation&&preference?.type==='interpret';
  const sourceOnly=blocks.length>0&&blocks.every(b=>b.id==='source'||b.id==='context'&&!b.claimIds?.length);
  if(!requestedUnderstanding)return {kind:sourceOnly?'source':'record',label:sourceOnly?'先把原话留下':'先把这些话留下',note:'',privacy};
  return sourceOnly?{kind:'source',label:'先把原话留下',note:'这里先保留原话，还没有写出理解。',privacy}:
    {kind:'unresolved',label:'目前留下的',note:'这份记录还没有写出理解，想聊的可以接着说。',privacy};
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
  const source=fresh.blocks.find(b=>b.id==='source');
  if(source&&!preserved.some(b=>b.id==='source')&&fresh.blocks.some(b=>b.id!=='source'&&b.group==='main'))source.group='details';
  // Keep the Host reference after the visible candidate text, including when
  // a protected understanding was restored from a previous composition.
  fresh.blocks.sort((a,b)=>Number(a.id==='source')-Number(b.id==='source'));
  // Do not hide a new model group under details to fit the main-block budget.
  // The caller rejects an oversized whole composition without half-applying.
  if(s.reviewConfirmed&&fresh.title!==s.review.title){fresh.title=s.review.title;conflict=true;}
  return {review:fresh,conflict};
}

export function applyClarityReply(s,ticket,envelope){
  if(!isCurrentClarity(s,ticket))return {ok:false,reason:'inactive'};
  if(envelope?.flow!==CLARITY_FLOW||envelope.schemaVersion!==CLARITY_SCHEMA_VERSION||envelope.policyVersion!==ticket.policyVersion||envelope.requestId!==ticket.requestId||envelope.revision!==ticket.revision)
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
  if(ticket.kind==='reflect'){
    const message=next.messages.at(-1);
    message.claimIds=copy(accepted);
    message.understanding=accepted.map(id=>next.claims.find(c=>c.id===id)).filter(c=>['insight','tradeoff'].includes(c.type))
      .map(({id,type,text})=>({id,type,text}));
  }
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
  if(!fitsReview(protectedReview.review))return {ok:false,reason:'review_capacity_exceeded'};
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
export function editClarityBlock(s,id,value){
  captureSavedReview(s);
  const before=new Set(s.statements.map(source=>source.id));
  editStoredBlock(s,id,value);
  // The legacy edit helper adds a Host-wrapped correction for model context.
  // Remember its ID rather than deleting a possibly user-authored prefix.
  s.reviewEditSourceIds=[...new Set([...(s.reviewEditSourceIds??[]),...s.statements.filter(source=>!before.has(source.id)).map(source=>source.id)])];
  s.reviewReady=Boolean(s.review);s.complete=s.reviewReady;
}
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
