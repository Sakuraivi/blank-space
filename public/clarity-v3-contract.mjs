// Explicit new wire version. The v2 validator remains unchanged and replayable.
import {deriveConversationPolicy} from './clarity-v3-intent.mjs';
export const CLARITY_FLOW='clarity-v3';
export const CLARITY_SCHEMA_VERSION='liubai-clarity-2';
// Policy changes independently from the unchanged seven-field wire shape.
export const CLARITY_POLICY_VERSION='clarity-listening-6';
export const CLAIM_TYPES=['event','thought','feeling','need','option','tradeoff','unknown','insight','action'];
export const MODES=['auto','moment','concern','choice'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const id=x=>text(x,100)&&/^[a-zA-Z0-9_-]+$/u.test(x);
const list=(x,min,max)=>Array.isArray(x)&&x.length>=min&&x.length<=max;
const unique=a=>new Set(a).size===a.length;
const fail=(reason,detail)=>({ok:false,reason,...(detail?{detail}:{})});

export function checkClarityContext(c){
  const keys=['sessionId','revision','stage','allowNextStep','modeId','goal','statements','dialogue','claims'];
  if(!(exact(c,keys)||exact(c,[...keys,'previousReply']))||!id(c.sessionId)||
    !Number.isSafeInteger(c.revision)||c.revision<0||!['reflect','review'].includes(c.stage)||typeof c.allowNextStep!=='boolean'||
    !MODES.includes(c.modeId)||!(c.goal===null||text(c.goal,80))||!list(c.statements,1,12)||!list(c.dialogue,0,12)||!list(c.claims,0,15))throw new TypeError('invalid_clarity_context');
  const ids=new Set();
  for(const s of c.statements){if(!exact(s,['id','text','kind'])||!id(s.id)||!/^u\d+$/u.test(s.id)||ids.has(s.id)||!text(s.text,4000)||
    !['expression','correction','request'].includes(s.kind))throw new TypeError('invalid_statement');ids.add(s.id);}
  if(Object.hasOwn(c,'previousReply')){
    const p=c.previousReply;
    if(!exact(p,['text','question','sourceIds'])||!text(p.text,300)||!(p.question===null||text(p.question,160))||
      !list(p.sourceIds,1,12)||!unique(p.sourceIds)||p.sourceIds.some(k=>!ids.has(k)))throw new TypeError('invalid_previous_reply');
  }
  const answered=new Set();
  for(const d of c.dialogue){if(!exact(d,['question','answerId'])||!text(d.question,160)||!ids.has(d.answerId)||answered.has(d.answerId))throw new TypeError('invalid_dialogue');answered.add(d.answerId);}
  const claimIds=new Set();
  for(const v of c.claims){if(!exact(v,['id','type','text','evidenceIds','derivation','status'])||!id(v.id)||claimIds.has(v.id)||!CLAIM_TYPES.includes(v.type)||
    !text(v.text,2000)||!list(v.evidenceIds,1,12)||!unique(v.evidenceIds)||v.evidenceIds.some(k=>!ids.has(k))||!['stated','inferred'].includes(v.derivation)||
    !['candidate','edited','confirmed','stale'].includes(v.status))throw new TypeError('invalid_claim_context');claimIds.add(v.id);}
  return c;
}
export function buildClarityContext({session,revision,stage='reflect',allowNextStep=false}){
  const keys=['id','modeId','goal','statements','dialogue','claims'];
  if(!(exact(session,keys)||exact(session,[...keys,'previousReply'])))throw new TypeError('invalid_clarity_session');
  return checkClarityContext(structuredClone({sessionId:session.id,revision,stage,allowNextStep,modeId:session.modeId,goal:session.goal,
    statements:session.statements,dialogue:session.dialogue,claims:session.claims,
    ...(Object.hasOwn(session,'previousReply')?{previousReply:session.previousReply}:{})}));
}
function questionInReply(value){
  const stack=[],pairs={'“':'”','‘':'’','「':'」','『':'』','"':'"'};
  for(const ch of value){if(stack.at(-1)===ch)stack.pop();else if(pairs[ch])stack.push(pairs[ch]);else if(!stack.length&&/[?？]/u.test(ch))return true;}
  return stack.length>0&&/[?？]/u.test(value);
}
export function validateClarityCandidate(value,context){
  checkClarityContext(context);const policy=deriveConversationPolicy(context);
  if(!exact(value,['modeId','goal','reply','question','claims','finish','title']))return fail('invalid_shape','shape_fields');
  if(!MODES.slice(1).includes(value.modeId))return fail('invalid_shape','shape_mode');
  if(!text(value.goal,80))return fail('invalid_shape','shape_goal');
  if(!text(value.title,60))return fail('invalid_shape','shape_title');
  if(!text(value.reply,300))return fail('invalid_shape','shape_reply');
  if(typeof value.finish!=='boolean')return fail('invalid_shape','shape_finish');
  if(!list(value.claims,0,3))return fail('invalid_shape','shape_claims');
  if(policy.endRequested||policy.pauseRequested||policy.recordOnly||policy.discardRequested&&(context.stage==='review'||context.allowNextStep))return fail('generation_not_allowed');
  if(questionInReply(value.reply))return fail('question_in_reply');
  const evidence=new Set(policy.materials.map(s=>s.id)),existing=new Set(context.claims.map(c=>c.id)),replaced=new Set();
  const sources=ids=>list(ids,1,12)&&unique(ids)&&ids.every(x=>evidence.has(x));
  for(const claim of value.claims){
    if(!exact(claim,['type','text','evidenceIds','derivation','supersedes']))return fail('invalid_claim','claim_shape');
    if(!CLAIM_TYPES.includes(claim.type))return fail('invalid_claim','claim_type');
    if(!text(claim.text,240))return fail('invalid_claim','claim_text');
    if(!sources(claim.evidenceIds))return fail('invalid_claim','claim_evidence');
    if(!['stated','inferred'].includes(claim.derivation))return fail('invalid_claim','claim_derivation');
    if(!list(claim.supersedes,0,15))return fail('invalid_claim','supersedes_shape');
    if(!unique(claim.supersedes)||claim.supersedes.some(k=>replaced.has(k)))return fail('invalid_claim','supersedes_duplicate');
    if(claim.supersedes.some(k=>!existing.has(k)))return fail('invalid_claim','supersedes_unknown');
    claim.supersedes.forEach(k=>replaced.add(k));
    if(policy.actionRequested){if(claim.type!=='action')return fail('action_only');}
    else if(claim.type==='action')return fail('action_not_allowed');
    if(!policy.actionRequested&&!policy.allowInterpretation&&(claim.derivation==='inferred'||['insight','tradeoff'].includes(claim.type)))return fail('interpretation_not_allowed');
  }
  if(value.claims.reduce((sum,c)=>sum+c.text.length,0)>480)return fail('response_too_large');
  if(policy.actionRequested){if(value.question!==null||!value.finish||value.claims.length!==1)return fail('invalid_action');}
  else if(policy.reviewRequested){if(context.stage!=='review'||!value.finish||value.question!==null)return fail('invalid_review_stage');if(!value.claims.length)return fail('empty_review');}
  else if(value.finish||context.stage!=='reflect')return fail('unexpected_finish');
  if(value.question!==null){const q=value.question;
    if(!exact(q,['text','target','evidenceIds']))return fail('invalid_question','question_shape');
    if(!text(q.text,160))return fail('invalid_question','question_text');
    if(!sources(q.evidenceIds))return fail('invalid_question','question_evidence');
    if(!['event','interpretation','need','tradeoff','unknown','correction'].includes(q.target))return fail('invalid_question','question_target');
    if(!policy.allowQuestion)return fail('question_not_allowed');
    if(context.dialogue.some(d=>d.question.trim()===q.text.trim()))return fail('repeated_question');}
  return {ok:true,candidate:structuredClone(value)};
}
