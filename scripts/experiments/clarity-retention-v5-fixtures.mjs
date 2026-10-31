// Host-fixed synthetic scopes. Expected modes/quantities and review criteria
// stay outside the model context and never select the check's purpose.
import {CLARITY_QUANTITY_BOUNDARY_SAMPLES} from '../../ai/fixtures/clarity-quantity-boundary-samples.mjs';
import {createClaritySession,addExpression,beginClarityRequest} from '../../public/clarity-state.mjs';
import {V2_FULL_ID,validRunId,fixtureFor,prepareV2Step,checkContinuationSession,requestIdFor} from './clarity-material-v2-fixtures.mjs';
import {V4_BOUNDARY_IDS,isBoundaryCase,fixtureForV4,prepareV4Step} from './clarity-retention-v4-fixtures.mjs';

export const V5_PROBE_IDS=Object.freeze([...V4_BOUNDARY_IDS,...CLARITY_QUANTITY_BOUNDARY_SAMPLES.map(sample=>sample.id)]);
export const V5_CASE_IDS=Object.freeze([V2_FULL_ID,...V5_PROBE_IDS]);
export const isV5Probe=id=>V5_PROBE_IDS.includes(id);
export const fixtureForV5=id=>id===V2_FULL_ID?fixtureFor(id):fixtureForV4(id)??CLARITY_QUANTITY_BOUNDARY_SAMPLES.find(sample=>sample.id===id)??null;
export function purposeForV5Case(id){
  if(!V5_CASE_IDS.includes(id))throw new TypeError('invalid_v5_fixture');
  return id==='ROUTE_INTEREST_OPENER'?'knowledge_opener':'personal_reflection';
}
export function prepareV5Step(id,runId,startedAt,step,prior,experimentVersion=5){
  if(experimentVersion!==5&&experimentVersion!==6)throw new TypeError('invalid_v5_fixture_version');
  if(id===V2_FULL_ID)return prepareV2Step(id,runId,startedAt,step,prior,experimentVersion);
  if(isBoundaryCase(id))return prepareV4Step(id,runId,startedAt,step,prior,experimentVersion);
  if(!isV5Probe(id)||!validRunId(runId)||!Number.isSafeInteger(startedAt)||step!==1||(prior!==undefined&&prior!==null))throw new TypeError('invalid_v5_probe_step');
  const fixture=fixtureForV5(id),session=createClaritySession();
  session.id=`retention${experimentVersion}_${runId}_probe_${V5_PROBE_IDS.indexOf(id)+1}`;session.createdAt=new Date(startedAt).toISOString();
  // Only controlled working mode/goal and literal statements enter state.
  // Fixture session identity, review requirements and expected values do not.
  session.modeId=fixture.context.modeId;session.goal=fixture.context.goal;
  for(const source of fixture.context.statements)addExpression(session,source.text,{kind:source.kind});
  const ticket=beginClarityRequest(session);ticket.requestId=requestIdFor(runId,id,step,experimentVersion);
  if(session.modeId!=='concern'||session.goal!=='梳理这次表达'||ticket.context.stage!=='reflect'||ticket.context.allowNextStep)throw new TypeError('v5_probe_unexpected_state');
  session.pending=structuredClone(ticket);
  return {session,ticket,context:structuredClone(ticket.context),fixture};
}
export function checkV5ContinuationSession(session,id,runId,nextStep,experimentVersion=5){
  if(experimentVersion!==5&&experimentVersion!==6)throw new TypeError('invalid_v5_fixture_version');
  return id===V2_FULL_ID&&checkContinuationSession(session,id,runId,nextStep,experimentVersion);
}
