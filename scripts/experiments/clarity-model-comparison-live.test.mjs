// Client durability/verification tests. All provider responses are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {MODEL_COMPARISON_LABEL,MODEL_COMPARISON_ORIGIN,MODEL_COMPARISON_TTL_MS,MODEL_COMPARISON_SOURCE,MODEL_COMPARISON_ARMS,
  loadModelComparisonFixtures,modelComparisonOrder,prepareModelComparisonFixture,prepareModelComparison,comparisonApiRoute} from './clarity-model-comparison-fixtures.mjs';
import {runModelComparisonEvaluation} from './clarity-model-comparison-live.mjs';

const RUN='model_synthetic_run',START=1_790_000_000_000;
const validRaw=()=>({reply:'先把已经说出的这部分留下。',title:'独立整理',claims:[]});
async function environment({mutateRaw,providerStatus,mutateEvidence,onFetch,health}={}){
  const samples=await loadModelComparisonFixtures(),seen=[];
  return {seen,async fetchImpl(url,options){
    onFetch?.(url,options);
    if(url.endsWith('/health'))return Response.json(health??{label:MODEL_COMPARISON_LABEL,runId:RUN,startedAt:START,expiresAt:START+MODEL_COMPARISON_TTL_MS});
    const match=/\/evaluate\/([a-zA-Z0-9_]+)\/(reference|max|flash)$/u.exec(url);assert.ok(match);
    const [,caseId,arm]=match,sample=samples.find(value=>value.id===caseId);assert.ok(sample);
    assert.equal(options.method,'POST');assert.equal(options.headers['X-Liubai-Evaluation-Run'],RUN);assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
    seen.push({url,caseId,arm});
    const seeded=prepareModelComparisonFixture(sample,RUN,START,arm),comparison=await prepareModelComparison(seeded.context),selected=comparison.arms[arm],prepared=selected.prepared;
    const raw=mutateRaw?.({sample,arm,index:seen.length-1})??validRaw(),status=providerStatus?.({sample,arm,index:seen.length-1})??200;
    const content=typeof raw==='string'?raw:JSON.stringify(raw),route=comparisonApiRoute(arm);
    let result;
    if(status!==200)result={status:'fallback',reason:({400:'provider_request_rejected',401:'provider_auth_failed',402:'provider_balance_low',403:'provider_access_denied',
      404:'provider_model_unavailable',422:'provider_request_rejected',429:'provider_rate_limited'})[status]??'provider_unavailable',candidate:null};
    else{
      let native;try{native=JSON.parse(content);}catch{}
      result=native===undefined?{status:'fallback',reason:'provider_response_failed',candidate:null}:
        await prepared.run({adapter:{profile:selected.route.profile,async generate(){return {status:'completed',output:native};}},isCurrent:()=>true,timeoutMs:1000});
    }
    result={...result,flow:'clarity-v2',requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,route};
    const applied=result.status==='candidate'&&applyClarityReply(seeded.session,seeded.ticket,result).ok;
    const retentionVisibility=prepared.checkVisibleMaterial(seeded.session);
    const response=status===200?{id:'chatcmpl-synthetic',model:selected.route.modelId,choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}:null;
    const evidence={synthetic:true,label:MODEL_COMPARISON_LABEL,kind:'fixed_examples_model_arm',runId:RUN,caseId,arm,requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,
      context:seeded.context,source:MODEL_COMPARISON_SOURCE,route,control:comparison.control,
      hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding},
      transport:{dispatches:1,requestedModel:selected.route.modelId,returnedModel:response?.model??null,request:JSON.parse(selected.transport.body),response,httpStatus:status,elapsedMs:2},
      api:{httpStatus:200,elapsedMs:3,result},progress:{applied,maySave:applied&&retentionVisibility.allVisible&&!seeded.session.stale,retentionVisibility,stopReason:null},semanticReview:'pending_manual_review'};
    mutateEvidence?.(evidence,{sample,arm,index:seen.length-1});return Response.json(evidence);
  }};
}
const evaluate=(env,options={})=>runModelComparisonEvaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:env.fetchImpl,...options});

test('all 24 slots are registered and persisted before dispatch; native/state/save verification stays model-only and independent',async()=>{
  const snapshots=[],env=await environment({onFetch(url){if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,env.seen.length+1);}});
  const report=await evaluate(env,{persist:value=>snapshots.push(value)});
  assert.equal(snapshots[0].registeredAttempts.length,24);assert.equal(snapshots[0].clientStepAttempts,0);
  assert.equal(snapshots[0].cases.length,8);assert.equal(new Set(snapshots[0].registeredAttempts.map(item=>item.requestId)).size,24);
  assert.equal(env.seen.length,24);assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,true);
  assert.equal(report.completedCaseCount,8);assert.equal(report.completedArmCount,24);assert.equal(report.memorySavedArmCount,24);assert.equal(report.retries,0);
  assert.equal(report.modelDispatchesObserved,24);assert.equal(report.nativeResponseCount,24);assert.equal(report.skippedSlotCount,0);
  assert.deepEqual(env.seen.map(item=>({caseId:item.caseId,arm:item.arm})),report.registeredAttempts.map(({caseId,arm})=>({caseId,arm})));
  for(const [index,row]of report.cases.entries()){
    assert.deepEqual(row.order,modelComparisonOrder(index));let common;
    for(const arm of MODEL_COMPARISON_ARMS){
      const slot=row.arms[arm.id],call=slot.calls[0];assert.equal(slot.status,'candidate_saved');assert.equal(slot.calls.length,1);
      assert.ok(call.verification.hostEnvelopeMatched&&call.verification.exactRequestMatched&&call.verification.nativeRawCompiledMatched&&call.verification.actualStateApplied);
      assert.equal(call.stateVerification.savedRecord.formatVersion,2);assert.equal(call.stateVerification.allActiveMaterialVisible,true);
      assert.deepEqual(call.modelObservation,{requestedModel:arm.modelId,returnedModel:arm.modelId});
      const body=structuredClone(call.evidence.transport.request);delete body.model;if(common===undefined)common=body;else assert.deepEqual(body,common);
      assert.equal(JSON.stringify(call.stateVerification.savedRecord).includes('onlyModelDifference'),false);
    }
  }
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});

test('the first native access rejection skips that arm later without a replacement probe or retry and does not fake a full batch',async()=>{
  const env=await environment({providerStatus:({arm})=>arm==='max'?403:200}),report=await evaluate(env);
  assert.equal(env.seen.length,17);assert.equal(env.seen.filter(call=>call.arm==='max').length,1);
  assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,false);assert.equal(report.modelDispatchesObserved,17);assert.equal(report.memorySavedArmCount,16);assert.equal(report.skippedSlotCount,7);
  assert.equal(report.armReadiness.max.status,'preflight_rejected');assert.equal(report.armReadiness.max.failure.httpStatus,403);assert.equal(report.armReadiness.max.failure.category,'access_denied');
  assert.equal(report.cases[0].arms.max.status,'preflight_rejected');assert.equal(report.cases[0].arms.max.calls[0].evidence.transport.response,null);
  for(const row of report.cases.slice(1)){assert.equal(row.arms.max.status,'skipped_after_preflight_rejection');assert.equal(row.arms.max.calls.length,0);}
  assert.equal(report.retries,0);assert.equal(report.contentReleaseGate,'not_met');
});

test('native 200 JSON fences and compiler failures retain original outputs, count separately and keep all pre-registered later attempts',async()=>{
  const env=await environment({mutateRaw:({arm,index})=>arm==='max'&&index===1?'```json\n'+JSON.stringify(validRaw())+'\n```':
    arm==='flash'&&index===2?{...validRaw(),unexpected:'synthetic-invalid-field'}:validRaw()}),report=await evaluate(env);
  assert.equal(env.seen.length,24);assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,true);assert.equal(report.memorySavedArmCount,22);
  assert.equal(report.nativeParseFailureCount,1);assert.equal(report.runtimeRejectedOutputCount,1);
  assert.equal(report.cases[0].arms.max.status,'native_parse_failed');assert.match(report.cases[0].arms.max.calls[0].evidence.transport.response.choices[0].message.content,/^```json/u);
  assert.equal(report.cases[0].arms.flash.status,'runtime_rejected');assert.equal(report.armReadiness.max.status,'observed_inference_response');assert.equal(report.armReadiness.flash.status,'observed_inference_response');
  assert.equal(report.cases[0].arms.max.calls[0].stateVerification.ok,false);assert.equal(report.cases[0].arms.flash.calls[0].stateVerification.ok,false);
});

test('candidate/body tampering cannot pass native-state-save verification or contaminate another arm',async()=>{
  const env=await environment({mutateEvidence(e,{arm,index}){if(arm==='flash'&&index===2)e.api.result.candidate.title='synthetic-forged-title';}}),report=await evaluate(env);
  const rejected=report.cases[0].arms.flash.calls[0];assert.equal(report.memorySavedArmCount,23);assert.equal(report.complete,true);
  assert.equal(rejected.verification.actualStateApplied,false);assert.equal(rejected.stateVerification,null);assert.equal(report.cases[0].arms.flash.status,'evidence_rejected');
  assert.equal(report.cases[0].arms.reference.complete,true);assert.equal(report.cases[0].arms.max.complete,true);
  assert.equal(report.cases[1].arms.flash.complete,true);assert.equal(env.seen.length,24);
});

test('failed persistence before POST or after the first observation stops without making another request',async()=>{
  const before=await environment();await assert.rejects(evaluate(before,{persist:value=>{if(value.clientStepAttempts===1)throw Error('synthetic-before-post');}}),/synthetic-before-post/u);
  assert.equal(before.seen.length,0);
  const after=await environment();await assert.rejects(evaluate(after,{persist:value=>{if(value.cases[0].arms.reference.calls[0]?.evidence)throw Error('synthetic-after-response');}}),/synthetic-after-response/u);
  assert.equal(after.seen.length,1);
});

test('wrong health/origin and expiry preserve honest incomplete or skipped states without hidden requests',async()=>{
  const env=await environment({health:{label:MODEL_COMPARISON_LABEL,runId:'wrong_health_run',startedAt:START,expiresAt:START+MODEL_COMPARISON_TTL_MS}}),failed=await evaluate(env);
  assert.equal(failed.complete,false);assert.equal(failed.health.failure,'health_failed');assert.equal(env.seen.length,0);
  await assert.rejects(evaluate(env,{origin:'https://invalid.example'}),/invalid_model_comparison_evaluation/u);
  let clock=START;const expired=await environment({onFetch:url=>{if(!url.endsWith('/health'))clock=START+MODEL_COMPARISON_TTL_MS+1;}}),report=await evaluate(expired,{now:()=>clock});
  assert.equal(report.complete,true);assert.equal(expired.seen.length,1);assert.equal(report.skippedSlotCount,23);assert.equal(report.fixedBatchFullyDispatched,false);
  assert.equal(report.registeredAttempts.filter(item=>item.status==='skipped_expired').length,23);
});

test('generic parameter rejections and rate limits stop an arm conservatively without claiming account permission failure',async()=>{
  for(const [status,category,reason]of [[400,'request_rejected','provider_request_rejected'],[429,'rate_limited','provider_rate_limited']]){
    const env=await environment({providerStatus:({arm})=>arm==='max'?status:200}),report=await evaluate(env);
    assert.equal(env.seen.filter(call=>call.arm==='max').length,1);assert.equal(report.armReadiness.max.status,'preflight_rejected');
    assert.equal(report.armReadiness.max.failure.category,category);assert.equal(report.armReadiness.max.failure.reason,reason);assert.equal(report.armReadiness.max.failure.httpStatus,status);
    for(const row of report.cases.slice(1))assert.equal(row.arms.max.status,'skipped_after_preflight_rejection');
    assert.equal(report.memorySavedArmCount,16);assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,false);
  }
});

test('a parameter rejection after the FULL preflight remains a case failure and never skips different later cases',async()=>{
  let maxSeen=0;const env=await environment({providerStatus:({arm})=>arm==='max'&&++maxSeen===2?400:200}),report=await evaluate(env);
  assert.equal(env.seen.length,24);assert.equal(env.seen.filter(call=>call.arm==='max').length,8);assert.equal(report.memorySavedArmCount,23);
  assert.equal(report.armReadiness.max.status,'observed_inference_response');assert.equal(report.armReadiness.max.failure,null);
  const rejected=report.cases[1].arms.max;assert.equal(rejected.status,'provider_failed');assert.equal(rejected.failure,'provider_request_rejected');
  assert.equal(rejected.calls[0].providerRejection.category,'request_rejected');assert.equal(rejected.calls[0].providerRejection.httpStatus,400);
  for(const row of report.cases.slice(2))assert.equal(row.arms.max.status,'candidate_saved');
  assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,true);assert.equal(report.skippedSlotCount,0);
});

test('source changes and the inherited global usage stop halt the remaining plan without another dispatch or pretend save',async()=>{
  for(const [reason,status]of [['config_changed','skipped_source_changed'],['usage_out_of_bounds','skipped_safety_stop']]){
    const env=await environment({mutateEvidence(e,{index}){
      if(index!==0)return;e.api.result={...e.api.result,status:'fallback',reason,candidate:null};e.progress.applied=false;e.progress.maySave=false;
      if(reason==='config_changed')e.progress.stopReason='source_changed';
    }}),report=await evaluate(env);
    assert.equal(env.seen.length,1);assert.equal(report.modelDispatchesObserved,1);assert.equal(report.memorySavedArmCount,0);
    assert.equal(report.complete,true);assert.equal(report.fixedBatchFullyDispatched,false);assert.equal(report.skippedSlotCount,23);
    assert.equal(report.registeredAttempts.filter(item=>item.status===status).length,23);
    if(reason==='usage_out_of_bounds')assert.equal(report.cases[0].arms.reference.status,'provider_failed');
    assert.equal(report.retries,0);
  }
});
