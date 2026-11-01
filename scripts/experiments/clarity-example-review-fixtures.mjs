// Eight already-known contexts; arm assignment and criteria stay Host-owned.
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {prepareFaithfulDialogueReviewRun,FAITHFUL_DIALOGUE_REVIEW_POLICY} from '../../ai/experiments/clarity-faithful-dialogue.mjs';
import {loadRelationPlanFixtures,prepareRelationFixture} from './clarity-relation-plan-fixtures.mjs';
export const EXAMPLE_LABEL='liubai-example-review-preview-1';
export const EXAMPLE_ORIGIN='http://127.0.0.1:4199';
export const EXAMPLE_TTL_MS=20*60*1000;
export const EXAMPLE_ROUTE=Object.freeze({sourceMode:'default',providerId:'bailian',modelId:'deepseek-v4-pro-0813',defaultRevision:3});
export const EXAMPLE_ARMS=Object.freeze(['baseline','examples']);
export const validExampleRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/u.test(value);
const route=getPersonalRoute(EXAMPLE_ROUTE.providerId,EXAMPLE_ROUTE.modelId),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const demand=(ok,reason)=>{if(!ok)throw new TypeError(reason);};
export const loadExampleReviewFixtures=async()=>Object.freeze((await loadRelationPlanFixtures()).map(sample=>Object.freeze({...sample,sourceGroup:sample.group,group:'known_regression'})));
export function exampleArmOrder(index){demand(Number.isInteger(index)&&index>=0&&index<8,'invalid_example_pair_index');return Object.freeze(index%2===0?['baseline','examples']:['examples','baseline']);}
export function exampleRequestId(runId,id,arm){
  demand(validExampleRunId(runId)&&typeof id==='string'&&/^[a-zA-Z0-9_]{1,56}$/u.test(id)&&EXAMPLE_ARMS.includes(arm),'invalid_example_identity');
  const value=`example1_${runId}_${id}_${arm}`;demand(value.length<=100,'example_identity_too_long');return value;
}
export function prepareExampleFixture(sample,runId,startedAt,arm){
  const seeded=prepareRelationFixture(sample,runId,startedAt);seeded.ticket.requestId=exampleRequestId(runId,sample.id,arm);
  seeded.session.pending=structuredClone(seeded.ticket);return seeded;
}
export async function prepareExamplePair(context,profile){
  const c=structuredClone(context),p=structuredClone(profile);
  const module=await import('../../ai/experiments/clarity-example-review.mjs');
  const baseline=await prepareFaithfulDialogueReviewRun(structuredClone(c),structuredClone(p)),examples=await module.prepareExampleReviewRun(structuredClone(c),structuredClone(p));
  const b=baseline.requestData,e=examples.requestData;
  demand(b.policyVersion===FAITHFUL_DIALOGUE_REVIEW_POLICY&&e.policyVersion===module.EXAMPLE_REVIEW_POLICY,'example_policy_mismatch');
  demand(typeof module.EXAMPLE_REVIEW_BLOCK==='string'&&module.EXAMPLE_REVIEW_BLOCK.length>0,'invalid_example_block');
  demand(e.instruction.text===b.instruction.text+module.EXAMPLE_REVIEW_BLOCK,'example_suffix_changed');
  demand(same(b.input,e.input)&&same(b.output,e.output)&&b.schemaVersion===e.schemaVersion&&b.schemaVersion==='liubai-material-retention-3'&&
    b.providerId===e.providerId&&b.modelId===e.modelId&&b.instruction.channel===e.instruction.channel,'example_contract_changed');
  const baselineTransport=prepareProviderRequest(b,route),examplesTransport=prepareProviderRequest(e,route),bb=JSON.parse(baselineTransport.body),eb=JSON.parse(examplesTransport.body);
  demand(bb.messages?.length===2&&eb.messages?.length===2&&bb.messages[0].role==='system'&&eb.messages[0].role==='system','example_transport_shape_changed');
  delete bb.messages[0].content;delete eb.messages[0].content;demand(same(bb,eb),'example_non_instruction_body_changed');
  return Object.freeze({baseline,examples,comparison:Object.freeze({onlyInstructionDifference:true,exactFixedSuffix:true,
    baselineBytes:baselineTransport.byteLength,examplesBytes:examplesTransport.byteLength,baselinePolicy:b.policyVersion,examplesPolicy:e.policyVersion,schemaVersion:b.schemaVersion})});
}
