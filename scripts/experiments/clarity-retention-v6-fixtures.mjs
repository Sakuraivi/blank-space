// The final fresh fixture is supplied only after policy freeze. Its criteria
// stay in evaluation metadata; only literal input and Host purpose are used.
import {CLARITY_DIALOGUE_BOUNDARY_SAMPLES} from '../../ai/fixtures/clarity-dialogue-boundary-samples.mjs';
import {createClaritySession,addExpression,beginClarityRequest} from '../../public/clarity-state.mjs';
import {V2_FULL_ID,validRunId,requestIdFor,checkContinuationSession} from './clarity-material-v2-fixtures.mjs';
import {V5_CASE_IDS,V5_PROBE_IDS,fixtureForV5,prepareV5Step,purposeForV5Case} from './clarity-retention-v5-fixtures.mjs';

export const V6_FRESH_IDS=Object.freeze(CLARITY_DIALOGUE_BOUNDARY_SAMPLES.map(sample=>sample.id));
export const V6_PROBE_IDS=Object.freeze([...V5_PROBE_IDS,...V6_FRESH_IDS]);
export const V6_CASE_IDS=Object.freeze([...V5_CASE_IDS,...V6_FRESH_IDS]);
if(V6_FRESH_IDS.length!==4||new Set(V6_CASE_IDS).size!==13||CLARITY_DIALOGUE_BOUNDARY_SAMPLES.some(sample=>
  typeof sample.id!=='string'||!/^[a-zA-Z0-9_]+$/u.test(sample.id)||typeof sample.input!=='string'||!sample.input.trim()||
  !['personal_reflection','knowledge_opener'].includes(sample.purpose)))throw new TypeError('invalid_v6_fresh_fixtures');
export const isV6Fresh=id=>V6_FRESH_IDS.includes(id);
export const isV6Probe=id=>V6_PROBE_IDS.includes(id);
export const fixtureForV6=id=>V5_CASE_IDS.includes(id)?fixtureForV5(id):CLARITY_DIALOGUE_BOUNDARY_SAMPLES.find(sample=>sample.id===id)??null;
export function purposeForV6Case(id){
  if(V5_CASE_IDS.includes(id))return purposeForV5Case(id);
  const fixture=fixtureForV6(id);if(!fixture)throw new TypeError('invalid_v6_fixture');return fixture.purpose;
}
export function prepareV6Step(id,runId,startedAt,step,prior){
  if(V5_CASE_IDS.includes(id))return prepareV5Step(id,runId,startedAt,step,prior,6);
  if(!isV6Fresh(id)||!validRunId(runId)||!Number.isSafeInteger(startedAt)||step!==1||(prior!==undefined&&prior!==null))throw new TypeError('invalid_v6_probe_step');
  const fixture=fixtureForV6(id),session=createClaritySession();
  session.id=`retention6_${runId}_probe_${V6_PROBE_IDS.indexOf(id)+1}`;session.createdAt=new Date(startedAt).toISOString();
  addExpression(session,fixture.input);
  const ticket=beginClarityRequest(session);ticket.requestId=requestIdFor(runId,id,step,6);
  if(session.modeId!=='auto'||session.goal!==null||ticket.context.stage!=='reflect'||ticket.context.allowNextStep)throw new TypeError('v6_probe_unexpected_state');
  session.pending=structuredClone(ticket);
  return {session,ticket,context:structuredClone(ticket.context),fixture};
}
export function checkV6ContinuationSession(session,id,runId,nextStep){
  return id===V2_FULL_ID&&checkContinuationSession(session,id,runId,nextStep,6);
}
