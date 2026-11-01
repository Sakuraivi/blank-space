// Fixed known-context comparison. Prompts, sources and validators are inherited
// unchanged from E; only the exact server-owned model ID differs between arms.
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {prepareExampleReviewRun,EXAMPLE_REVIEW_POLICY} from '../../ai/experiments/clarity-example-review.mjs';
import {loadExampleReviewFixtures,prepareExampleFixture,EXAMPLE_ROUTE} from './clarity-example-review-fixtures.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const demand=(ok,reason)=>{if(!ok)throw new TypeError(reason);};
export const MODEL_COMPARISON_LABEL='liubai-fixed-examples-model-comparison-1';
export const MODEL_COMPARISON_ORIGIN='http://127.0.0.1:4199';
export const MODEL_COMPARISON_TTL_MS=20*60*1000;
export const MODEL_COMPARISON_SOURCE=freeze({...EXAMPLE_ROUTE});
export const MODEL_COMPARISON_ARMS=freeze([
  {id:'reference',modelId:'deepseek-v4-pro-0813'},
  {id:'max',modelId:'qwen3.8-max-0902'},
  {id:'flash',modelId:'qwen3.8-flash'},
]);
export const validModelComparisonRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/u.test(value);
export const loadModelComparisonFixtures=loadExampleReviewFixtures;
export function comparisonArm(id){return MODEL_COMPARISON_ARMS.find(arm=>arm.id===id)??null;}
export function comparisonRoute(id){
  const arm=comparisonArm(id);if(!arm)throw new TypeError('invalid_model_arm');
  return getPersonalRoute(MODEL_COMPARISON_SOURCE.providerId,arm.modelId);
}
export function comparisonApiRoute(id){return {...MODEL_COMPARISON_SOURCE,modelId:comparisonRoute(id).modelId};}
export function modelComparisonOrder(index){
  demand(Number.isInteger(index)&&index>=0&&index<8,'invalid_model_case_index');
  const ids=MODEL_COMPARISON_ARMS.map(arm=>arm.id),offset=index%ids.length;
  return Object.freeze([...ids.slice(offset),...ids.slice(0,offset)]);
}
export function modelComparisonRequestId(runId,caseId,arm){
  demand(validModelComparisonRunId(runId)&&typeof caseId==='string'&&/^[a-zA-Z0-9_]{1,56}$/u.test(caseId)&&comparisonArm(arm),'invalid_model_comparison_identity');
  const value=`model1_${runId}_${caseId}_${arm}`;demand(value.length<=100,'model_comparison_identity_too_long');return value;
}
export function prepareModelComparisonFixture(sample,runId,startedAt,arm){
  // Original sample/context/session and actual question links are not rewritten.
  const seeded=prepareExampleFixture(sample,runId,startedAt,'examples');
  seeded.ticket.requestId=modelComparisonRequestId(runId,sample.id,arm);
  seeded.session.pending=structuredClone(seeded.ticket);return seeded;
}
const normalizeBody=body=>{const value=structuredClone(body);delete value.model;return value;};
export async function prepareModelComparison(context){
  const source=structuredClone(context),arms={};let reference;
  for(const arm of MODEL_COMPARISON_ARMS){
    const route=comparisonRoute(arm.id),prepared=await prepareExampleReviewRun(structuredClone(source),route.profile);
    const transport=prepareProviderRequest(prepared.requestData,route),body=JSON.parse(transport.body);
    demand(prepared.requestData.policyVersion===EXAMPLE_REVIEW_POLICY&&prepared.requestData.schemaVersion==='liubai-material-retention-3'&&
      prepared.requestData.output.format==='json_text','model_comparison_policy_changed');
    demand(body.model===arm.modelId&&body.stream===false&&body.enable_thinking===false&&body.max_completion_tokens===2000&&
      !Object.hasOwn(body,'response_format')&&body.messages?.length===2&&body.messages[0].role==='system'&&body.messages[1].role==='user','model_comparison_transport_changed');
    const normalized=JSON.stringify(normalizeBody(body));
    if(reference===undefined)reference=normalized;else demand(normalized===reference,'comparison_changes_more_than_model');
    arms[arm.id]={prepared,route,transport};
  }
  return {arms,control:freeze({onlyModelDifference:true,policyVersion:EXAMPLE_REVIEW_POLICY,schemaVersion:'liubai-material-retention-3',
    outputFormat:'json_text',maxRequestBytes:12000,maxOutputTokens:2000,
    bodyBytes:Object.fromEntries(MODEL_COMPARISON_ARMS.map(arm=>[arm.id,arms[arm.id].transport.byteLength]))})};
}
