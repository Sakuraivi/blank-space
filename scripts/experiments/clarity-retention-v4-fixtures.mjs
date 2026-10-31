// Fixed synthetic probes only. Review expectations never enter model input,
// Host mode selection, state confirmation, or continuation authentication.
import {CLARITY_ROUTING_BOUNDARY_SAMPLES} from '../../ai/fixtures/clarity-routing-boundary-samples.mjs';
import {createClaritySession,addExpression,beginClarityRequest} from '../../public/clarity-state.mjs';
import {V2_CASE_IDS,validRunId,isFullCase,fixtureFor,prepareV2Step,checkContinuationSession,requestIdFor} from './clarity-material-v2-fixtures.mjs';

export const V4_BOUNDARY_IDS=Object.freeze(CLARITY_ROUTING_BOUNDARY_SAMPLES.map(sample=>sample.id));
export const V4_CASE_IDS=Object.freeze([...V2_CASE_IDS,...V4_BOUNDARY_IDS]);
export const isBoundaryCase=id=>V4_BOUNDARY_IDS.includes(id);
export const fixtureForV4=id=>fixtureFor(id)??CLARITY_ROUTING_BOUNDARY_SAMPLES.find(sample=>sample.id===id)??null;

export function prepareV4Step(id,runId,startedAt,step,prior,experimentVersion=4){
  if(experimentVersion!==4&&experimentVersion!==5&&experimentVersion!==6)throw new TypeError('invalid_v4_fixture_version');
  if(!isBoundaryCase(id))return prepareV2Step(id,runId,startedAt,step,prior,experimentVersion);
  if(!validRunId(runId)||!Number.isSafeInteger(startedAt)||step!==1||(prior!==undefined&&prior!==null))throw new TypeError('invalid_v4_boundary_step');
  const fixture=fixtureForV4(id),session=createClaritySession();
  // The session ID enters provider input. Keep the case's expected scene label
  // exclusively in evaluation metadata, never in a source-facing identifier.
  session.id=`retention${experimentVersion}_${runId}_probe_${V4_BOUNDARY_IDS.indexOf(id)+1}`;session.createdAt=new Date(startedAt).toISOString();
  for(const source of fixture.statements)addExpression(session,source.text,{kind:source.kind});
  const ticket=beginClarityRequest(session);ticket.requestId=requestIdFor(runId,id,step,experimentVersion);
  if(session.modeId!=='auto'||session.goal!==null||ticket.context.stage!=='reflect'||ticket.context.allowNextStep)throw new TypeError('v4_boundary_unexpected_state');
  session.pending=structuredClone(ticket);
  return {session,ticket,context:structuredClone(ticket.context),fixture};
}

export function checkV4ContinuationSession(session,id,runId,nextStep,experimentVersion=4){
  if(experimentVersion!==4&&experimentVersion!==5&&experimentVersion!==6)throw new TypeError('invalid_v4_fixture_version');
  return isFullCase(id)&&checkContinuationSession(session,id,runId,nextStep,experimentVersion);
}
