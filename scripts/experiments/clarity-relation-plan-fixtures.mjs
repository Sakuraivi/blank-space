// Controlled concern/review reconstruction, not conversation or recovery.
import {checkClarityContext,buildClarityContext} from '../../public/clarity-contract.mjs';
import {createClaritySession,addExpression,beginClarityRequest,wireSession} from '../../public/clarity-state.mjs';
export const RELATION_LABEL='liubai-relation-plan-preview-1';
export const RELATION_ORIGIN='http://127.0.0.1:4199';
export const RELATION_TTL_MS=20*60*1000;
export const RELATION_ROUTE=Object.freeze({sourceMode:'default',providerId:'bailian',modelId:'deepseek-v4-pro-0813',defaultRevision:3});
export const validRelationRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/u.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
export async function loadRelationPlanFixtures(){
  const [known,fresh]=await Promise.all([import('../../ai/fixtures/clarity-relation-plan-known.mjs'),import('../../ai/fixtures/clarity-relation-plan-fresh.mjs')]);
  const groups=[known.RELATION_PLAN_KNOWN_SAMPLES,fresh.RELATION_PLAN_FRESH_SAMPLES];
  if(groups.some(group=>!Array.isArray(group)||group.length!==4))throw new TypeError('invalid_relation_fixture_count');
  const samples=groups.flatMap((group,index)=>group.map(sample=>{
    if(!sample||typeof sample.id!=='string'||!/^[a-zA-Z0-9_]{1,56}$/u.test(sample.id))throw new TypeError('invalid_relation_fixture');
    const context=checkClarityContext(structuredClone(sample.context));
    if(context.stage!=='review'||context.modeId!=='concern'||context.allowNextStep)throw new TypeError('unsupported_relation_fixture_scope');
    return {id:sample.id,context,requirements:structuredClone(sample.requirements),forbiddenAdditions:structuredClone(sample.forbiddenAdditions),
      expectedRelation:structuredClone(sample.expectedRelation),...(sample.origin===undefined?{}:{origin:structuredClone(sample.origin)}),group:index===0?'known':'fresh'};
  }));
  if(new Set(samples.map(sample=>sample.id)).size!==8)throw new TypeError('duplicate_relation_fixture');return freeze(samples);
}
export function relationRequestId(runId,id){
  if(!validRelationRunId(runId)||typeof id!=='string'||!/^[a-zA-Z0-9_]{1,56}$/u.test(id))throw new TypeError('invalid_relation_identity');
  return `relation1_${runId}_${id}`;
}
export function prepareRelationFixture(sample,runId,startedAt){
  const c=checkClarityContext(structuredClone(sample.context));
  if(c.stage!=='review'||c.modeId!=='concern'||c.allowNextStep||!Number.isSafeInteger(startedAt))throw new TypeError('unsupported_relation_fixture_scope');
  const session=createClaritySession();session.id=c.sessionId;session.createdAt=new Date(startedAt).toISOString();session.modeId=c.modeId;session.goal=c.goal;
  for(const source of c.statements){const added=addExpression(session,source.text,{kind:source.kind});if(canonical(added)!==canonical(source))throw new TypeError('relation_source_not_reconstructable');}
  if(session.revision!==c.revision)throw new TypeError('relation_revision_not_reconstructable');
  session.dialogue=structuredClone(c.dialogue);session.claims=c.claims.map(claim=>({...structuredClone(claim),archived:false}));
  session.callCount=Math.max(c.dialogue.length,...c.claims.map(claim=>Number(/^c\d+_(\d+)_\d+$/u.exec(claim.id)?.[1]??0)));
  const ticket=beginClarityRequest(session);ticket.requestId=relationRequestId(runId,sample.id);
  ticket.context=buildClarityContext({session:wireSession(session),revision:session.revision,stage:'review',allowNextStep:false});
  if(canonical(ticket.context)!==canonical(c))throw new TypeError('relation_context_not_reconstructable');
  session.pending=structuredClone(ticket);return {session,ticket,context:structuredClone(ticket.context)};
}
