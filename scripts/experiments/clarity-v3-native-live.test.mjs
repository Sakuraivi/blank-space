// Fake responses below are test fixtures, never real model evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {getOrganizerRoute} from '../../ai/providers.mjs';
import {buildClarityModelRequest,validateClarityResponse} from '../../ai/clarity-v3.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {NATIVE_LABEL,NATIVE_ORIGIN,NATIVE_TTL_MS,NATIVE_SOURCE,NATIVE_SLOT_IDS,prepareNativeFixture} from './clarity-v3-native-fixtures.mjs';
import {runNativeV3Evaluation} from './clarity-v3-native-live.mjs';

const RUN='native_v3_synthetic',START=1_790_000_000_000;
const route=()=>getOrganizerRoute({providerId:NATIVE_SOURCE.providerId,modelId:NATIVE_SOURCE.modelId,pricingMode:'manual',inputRate:null,outputRate:null,revision:NATIVE_SOURCE.defaultRevision});
function rawFor(seed){
  const isReview=seed.ticket.kind==='review',isCorrection=seed.context.statements.some(s=>s.text==='我不是委屈，主要是生气。');
  return {modeId:'concern',goal:'临时照看安排',reply:isCorrection?'现在主要是生气。':'你说到了临时照看的安排。',question:null,
    claims:isReview?[{type:'event',text:isCorrection?'生气。':seed.context.statements[0].text,
      evidenceIds:[isCorrection?seed.context.statements.find(s=>s.text==='我不是委屈，主要是生气。').id:'u1'],derivation:'stated',supersedes:[]}]:[],finish:isReview,title:'临时照看安排'};
}
function environment({mutateRaw,mutateEvidence,httpStatus=200,onFetch,health}={}){
  const calls=[];
  return {calls,async fetchImpl(url,options){
    onFetch?.(url,options);
    if(url.endsWith('/health'))return Response.json(health??{label:NATIVE_LABEL,runId:RUN,startedAt:START,expiresAt:START+NATIVE_TTL_MS,source:NATIVE_SOURCE,slots:NATIVE_SLOT_IDS});
    const slotId=url.split('/').at(-1);assert.ok(NATIVE_SLOT_IDS.includes(slotId));assert.equal(options.body,undefined);assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');assert.equal(options.headers['X-Liubai-Evaluation-Run'],RUN);calls.push(slotId);
    const seed=prepareNativeFixture(slotId,RUN);
    if(seed.ticket===null){const e={synthetic:true,label:NATIVE_LABEL,runId:RUN,slotId,source:NATIVE_SOURCE,context:seed.context,hostRequest:null,
      transport:{dispatches:0,request:null,response:null,httpStatus:null},api:null,localControl:seed.localControl,sourceUnchanged:true,activeAfterGeneration:true};
      mutateEvidence?.(e,slotId);return Response.json(e);}
    const requestData=buildClarityModelRequest(seed.context,route().profile),expected=prepareProviderRequest(requestData,route());
    const value=mutateRaw?.(rawFor(seed),slotId)??rawFor(seed),content=typeof value==='string'?value:JSON.stringify(value);
    let result;
    if(httpStatus!==200)result={status:'fallback',reason:httpStatus===403?'provider_access_denied':'provider_balance_low',candidate:null};
    else{let raw;try{raw=JSON.parse(content);}catch{}
      const checked=raw===undefined?null:validateClarityResponse(raw,seed.context);
      result=checked?.ok?{status:'candidate',candidate:checked.candidate,policyVersion:requestData.policyVersion,schemaVersion:requestData.schemaVersion}:
        {status:'fallback',reason:checked?.reason??'provider_response_failed',candidate:null};}
    result={...result,flow:'clarity-v3',requestId:seed.ticket.requestId,revision:seed.ticket.revision,route:NATIVE_SOURCE};
    const response=httpStatus===200?{id:'chatcmpl-synthetic',model:NATIVE_SOURCE.modelId,choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:60,total_tokens:160}}:null;
    const e={synthetic:true,label:NATIVE_LABEL,runId:RUN,slotId,source:NATIVE_SOURCE,context:seed.context,hostRequest:{policyVersion:requestData.policyVersion,schemaVersion:requestData.schemaVersion,expectedContext:seed.context},
      transport:{dispatches:1,requestedModel:NATIVE_SOURCE.modelId,returnedModel:response?.model??null,request:JSON.parse(expected.body),response,httpStatus,elapsedMs:2},
      api:{httpStatus:200,result},sourceUnchanged:true,activeAfterGeneration:true};
    mutateEvidence?.(e,slotId);return Response.json(e);
  }};
}
const evaluate=(env,extra={})=>runNativeV3Evaluation({runId:RUN,fetchImpl:env.fetchImpl,now:()=>START,persist:()=>{},...extra});

test('seven slots are durable before each single attempt; native reflect/review/local-control evidence stays distinct',async()=>{
  const snapshots=[],env=environment({onFetch(url){if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,env.calls.length+1);}});
  const report=await evaluate(env,{persist:v=>snapshots.push(v)});
  assert.equal(snapshots[0].registeredSlots.length,7);assert.equal(snapshots[0].clientStepAttempts,0);assert.equal(snapshots[0].plannedMaximumModelCalls,6);
  assert.equal(report.complete,true);assert.equal(report.nativeAcceptedSlotCount,6);assert.equal(report.memorySavedSlotCount,2);assert.equal(report.retries,0);
  assert.deepEqual(env.calls,NATIVE_SLOT_IDS);assert.equal(report.modelDispatchesObserved,6);assert.equal(report.nativeResponseCount,6);assert.equal(report.fixedBatchFullyDispatched,true);
  for(const slot of report.registeredSlots){
    assert.equal(slot.complete,true);const call=slot.call;
    if(slot.slotId==='stop'){assert.equal(call.verification.localStopWithoutModel,true);assert.equal(call.evidence.api,null);continue;}
    assert.equal(call.verification.exactRequestMatched,true);assert.equal(call.verification.rawEqualsValidatedCandidate,true);assert.equal(call.verification.actualStateApplied,true);
    if(['review','corrected_review'].includes(slot.slotId)){assert.equal(call.programmaticSave.roundTripExact,true);assert.equal(call.programmaticSave.humanConfirmationObserved,false);assert.equal(call.programmaticSave.confirmationAssumption,'programmatic_test_confirmation');}
    else{assert.equal(call.actualState.review,null);assert.equal(call.verification.reflectDidNotComposeReport,true);assert.equal(call.programmaticSave,undefined);}
  }
  assert.equal(report.contentReleaseGate,'not_met');assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.productionIntegrated,false);
});
test('native permission failures remain failures; no repair, no retry, later registered independent slots remain',async()=>{
  const env=environment({mutateRaw(raw,id){return id==='listen'?{...raw,finish:true}:raw;}}),report=await evaluate(env),slot=report.registeredSlots[0];
  assert.equal(report.complete,true);assert.equal(report.nativeAcceptedSlotCount,5);assert.equal(env.calls.length,7);assert.equal(slot.status,'native_runtime_rejected');
  assert.equal(slot.call.verification.runtimeRejectionMatched,true);assert.equal(slot.call.actualState,undefined);assert.equal(slot.call.programmaticSave,undefined);assert.equal(slot.call.rawOutput.finish,true);
});
test('policy2 keeps an authorized emotion contrast unchanged through the complete native validator and state path',async()=>{
  const report=await evaluate(environment({mutateRaw(raw,id){return id==='correction'?{...raw,reply:'不是委屈，是生气。'}:raw;}}));
  const call=report.registeredSlots.find(s=>s.slotId==='correction').call;
  assert.equal(call.rawOutput.reply,'不是委屈，是生气。');assert.equal(call.nativeValidation.candidate.reply,'不是委屈，是生气。');
  assert.equal(call.verification.hostNormalizationObserved,false);assert.equal(call.verification.rawEqualsValidatedCandidate,true);assert.equal(call.verification.actualStateApplied,true);
});
test('object field ordering alone is not reported as Host normalization',async()=>{
  const report=await evaluate(environment({mutateRaw(raw){return Object.fromEntries(Object.entries(raw).reverse());}}));
  for(const slot of report.registeredSlots.filter(s=>s.plannedModelCalls===1)){
    assert.equal(slot.call.verification.rawEqualsValidatedCandidate,true);assert.equal(slot.call.verification.hostNormalizationObserved,false);
  }
});
test('native invalid JSON is preserved and rejected rather than repaired or retried',async()=>{
  const env=environment({mutateRaw(raw,id){return id==='clarify'?'```json\n{}\n```':raw;}}),report=await evaluate(env),slot=report.registeredSlots[2];
  assert.equal(slot.status,'native_parse_rejected');assert.equal(slot.call.verification.nativeParseRejectionMatched,true);assert.equal(slot.call.actualState,undefined);assert.equal(env.calls.filter(s=>s==='clarify').length,1);
});
test('account denial stops all remaining slots without consuming another registered model attempt',async()=>{
  const env=environment({httpStatus:403}),report=await evaluate(env);
  assert.equal(report.complete,true);assert.equal(report.modelDispatchesObserved,1);assert.equal(report.nativeAcceptedSlotCount,0);assert.equal(report.skippedSlotCount,6);
  assert.deepEqual(env.calls,['listen']);assert.equal(report.stopReason,'provider_access_denied');assert.equal(report.registeredSlots[1].status,'skipped_account_rejected');
});
test('source change, expiry and usage safety stop before any later slot; candidate returned before a source recheck cannot apply',async()=>{
  for(const change of ['source','active','usage']){
    const env=environment({mutateEvidence(e){if(change==='source')e.sourceUnchanged=false;else if(change==='active')e.activeAfterGeneration=false;else e.api.result={status:'fallback',reason:'usage_out_of_bounds',candidate:null};}});
    const report=await evaluate(env);assert.equal(env.calls.length,1);assert.equal(report.nativeAcceptedSlotCount,0);assert.equal(report.skippedSlotCount,6);
    assert.equal(report.registeredSlots[0].call.actualState,undefined);assert.equal(report.registeredSlots[0].call.programmaticSave,undefined);
  }
  let clock=START;const env=environment({onFetch(url){if(url.endsWith('/evaluate/listen'))clock=START+NATIVE_TTL_MS;}});
  const report=await evaluate(env,{now:()=>clock});assert.equal(env.calls.length,1);assert.equal(report.skippedSlotCount,6);assert.equal(report.stopReason,'inactive_preview');
  assert.equal(report.registeredSlots[0].call.actualState,undefined);
});
test('an inactive stop envelope is retained but cannot certify local-control success',async()=>{
  const report=await evaluate(environment({mutateEvidence(e,id){if(id==='stop')e.activeAfterGeneration=false;}})),slot=report.registeredSlots.at(-1);
  assert.equal(slot.complete,false);assert.equal(slot.call.stateVerification.reason,'inactive_preview');assert.equal(slot.call.verification.localStopWithoutModel,undefined);
  assert.equal(slot.call.evidence.transport.dispatches,0);assert.equal(slot.call.evidence.api,null);
});
test('changed provider body or source context cannot certify a native candidate or write state',async()=>{
  for(const mutation of [e=>e.transport.request.messages[0].content+=' changed',e=>e.context.statements[0].text+=' changed',e=>delete e.sourceUnchanged]){
    const env=environment({mutateEvidence(e,id){if(id==='listen')mutation(e);}}),report=await evaluate(env),slot=report.registeredSlots[0];
    assert.equal(slot.failure,'native_evidence_or_state_rejected');assert.equal(slot.call.actualState,undefined);assert.equal(slot.call.programmaticSave,undefined);
  }
});
test('every observation is persisted before verification or another fetch; write failures escape and never become transport failures',async()=>{
  const env=environment(),snapshots=[];
  await assert.rejects(evaluate(env,{persist(v){snapshots.push(v);if(v.registeredSlots[0].call?.evidence)throw Error('synthetic_disk_failure');}}),/synthetic_disk_failure/);
  assert.deepEqual(env.calls,['listen']);assert.equal(snapshots.at(-1).registeredSlots[0].call.actualState,undefined);
  const empty=environment();await assert.rejects(evaluate(empty,{persist(){throw Error('first_write_failed');}}),/first_write_failed/);assert.equal(empty.calls.length,0);
});
test('wrong health identity and arbitrary origin cannot initiate evaluation calls',async()=>{
  const env=environment({health:{label:'other',runId:RUN,startedAt:START,expiresAt:START+NATIVE_TTL_MS,source:NATIVE_SOURCE,slots:NATIVE_SLOT_IDS}}),report=await evaluate(env);
  assert.equal(report.health.failure,'health_failed');assert.equal(report.complete,false);assert.equal(env.calls.length,0);
  await assert.rejects(evaluate(env,{origin:'https://example.invalid'}),/invalid_native_evaluation_options/);
});
test('importing the CLI performs no network or filesystem mutations',()=>{
  const moduleUrl=new URL('./clarity-v3-native-live.mjs',import.meta.url).href;
  const script=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; globalThis.fetch=()=>{throw Error('network_on_import')}; for(const key of ['writeFileSync','mkdirSync','renameSync'])fs[key]=()=>{throw Error('write_on_import')}; syncBuiltinESMExports(); await import(${JSON.stringify(moduleUrl)}); console.log('clean_import');`;
  assert.equal(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}).trim(),'clean_import');
});
