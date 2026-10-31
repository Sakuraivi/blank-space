// Synthetic evaluation only. These controls are not product routing or a
// keyword-based semantic evaluator. Targets do not prove question usefulness.
import {MATERIAL_V2_REVIEW_SAMPLES,MATERIAL_V2_DIALOGUE_SAMPLE} from '../../ai/fixtures/clarity-material-v2-samples.mjs';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {createClaritySession,addExpression,beginClarityRequest,wireSession} from '../../public/clarity-state.mjs';
import {CONCERN_QUESTIONS} from '../../ai/clarity-turn.mjs';
export const V2_LABEL='liubai-material-preview-2';
export const V2_ORIGIN='http://127.0.0.1:4199';
export const V2_TTL_MS=20*60*1000;
export const V2_ROUTE=Object.freeze({sourceMode:'default',providerId:'bailian',modelId:'deepseek-v4-pro-0813',defaultRevision:3});
export const V2_CASE_IDS=Object.freeze([...MATERIAL_V2_REVIEW_SAMPLES.map(s=>s.id),MATERIAL_V2_DIALOGUE_SAMPLE.id]);
export const V2_FULL_ID=MATERIAL_V2_DIALOGUE_SAMPLE.id;
export const validRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/.test(value);
export const isFullCase=id=>id===V2_FULL_ID;
export const fixtureFor=id=>MATERIAL_V2_REVIEW_SAMPLES.find(s=>s.id===id)??(id===V2_FULL_ID?MATERIAL_V2_DIALOGUE_SAMPLE:null);
const prefixFor=version=>{if(version!==2&&version!==3&&version!==4&&version!==5)throw new TypeError('invalid_material_experiment_version');return version===2?'material2':`retention${version}`;};
export const requestIdFor=(runId,id,step,experimentVersion=2)=>`${prefixFor(experimentVersion)}_${runId}_${id}_${step}`;
// This controlled script only advances on the actual, unchanged Host concern
// question. An enum target alone cannot establish that the answer fits.
export function matchesExpectedConcernQuestion(session,fixture,questionIndex){
  const target=fixture.expectedQuestionTargets?.[questionIndex];
  return session.modeId==='concern'&&typeof CONCERN_QUESTIONS[target]==='string'&&
    session.question?.target===target&&session.question.text===CONCERN_QUESTIONS[target];
}
export function seedV2Session(id,runId,startedAt,experimentVersion=2){
  const prefix=prefixFor(experimentVersion);
  if(!validRunId(runId)||!V2_CASE_IDS.includes(id)||!Number.isSafeInteger(startedAt))throw new TypeError('invalid_v2_fixture');
  const session=createClaritySession();session.id=`${prefix}_${runId}_${id}`;session.createdAt=new Date(startedAt).toISOString();return session;
}
export function prepareV2Step(id,runId,startedAt,step,prior,experimentVersion=2){
  const prefix=prefixFor(experimentVersion);
  const fixture=fixtureFor(id),full=isFullCase(id),limit=full?4:1;
  if(!fixture||!Number.isInteger(step)||step<1||step>limit)throw new TypeError('invalid_v2_step');
  const session=prior?structuredClone(prior):seedV2Session(id,runId,startedAt,experimentVersion);
  if(session.id!==`${prefix}_${runId}_${id}`||session.pending||session.callCount!==step-1||session.complete)throw new TypeError('invalid_v2_state');
  if(full){
    if(step>1&&!matchesExpectedConcernQuestion(session,fixture,step-2))throw new TypeError('v2_question_or_mode_mismatch');
    addExpression(session,fixture.inputs[step-1]);
  }else{
    session.modeId='concern';session.goal=fixture.goal;
    for(const source of fixture.statements)addExpression(session,source.text,{kind:source.kind});
  }
  const ticket=beginClarityRequest(session);ticket.requestId=requestIdFor(runId,id,step,experimentVersion);
  if(!full)ticket.context=buildClarityContext({session:wireSession(session),revision:session.revision,stage:'review',allowNextStep:false});
  if(ticket.context.stage!==(step===4||!full?'review':'reflect'))throw new TypeError('v2_unexpected_stage');
  session.pending=structuredClone(ticket);
  return {session,ticket,context:structuredClone(ticket.context),fixture};
}
export function checkContinuationSession(session,id,runId,nextStep,experimentVersion=2){
  const prefix=prefixFor(experimentVersion);
  const fixture=fixtureFor(id);
  if(!isFullCase(id)||!fixture||!session||session.id!==`${prefix}_${runId}_${id}`||session.pending||session.complete||session.stage!=='exploring'||
    session.callCount!==nextStep-1||session.revision!==nextStep-1||session.statements?.length!==nextStep-1||
    !matchesExpectedConcernQuestion(session,fixture,nextStep-2)||session.dialogue?.length!==nextStep-2)return false;
  return session.statements.every((s,i)=>s.id===`u${i+1}`&&s.kind==='expression'&&s.text===fixture.inputs[i].trim());
}
