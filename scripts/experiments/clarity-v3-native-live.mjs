// Known-context native qualification only; never an adaptive conversation study.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getOrganizerRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {buildClarityModelRequest,validateClarityResponse} from '../../ai/clarity-v3.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION,CLARITY_POLICY_VERSION} from '../../public/clarity-v3-contract.mjs';
import {applyClarityReply,saveClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-v3-state.mjs';
import {NATIVE_LABEL,NATIVE_ORIGIN,NATIVE_TTL_MS,NATIVE_SOURCE,NATIVE_SLOT_IDS,NATIVE_CASES,
  validNativeRunId,prepareNativeFixture} from './clarity-v3-native-fixtures.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const same=isDeepStrictEqual;
const SOURCE_REASONS=new Set(['default_route_mismatch','default_source_mismatch','config_changed','consent_changed','source_changed','inactive_preview']);
const ACCOUNT_REASONS=new Set(['provider_auth_failed','provider_balance_low','provider_rate_limited','provider_access_denied','provider_model_unavailable','provider_request_rejected']);
const safeReason=value=>typeof value==='string'&&/^[a-z_]{1,80}$/u.test(value)?value:'unclassified_evaluation_failure';
const fixedRoute=()=>getOrganizerRoute({providerId:NATIVE_SOURCE.providerId,modelId:NATIVE_SOURCE.modelId,pricingMode:'manual',inputRate:null,outputRate:null,revision:NATIVE_SOURCE.defaultRevision});
function memorySave(session){
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const saved=saveClarityRecord(session,storage);
  const readback=readRecordEntries({getItem:key=>values.get(key)??null});
  const exact=saved.ok&&readback.length===1&&same(saved.record,readback[0].record)&&same(JSON.parse(values.get(RECORD_STORE))[0],saved.record);
  return {ok:saved.ok,reason:saved.reason??null,record:saved.record??null,roundTripExact:Boolean(exact),
    humanConfirmationObserved:false,confirmationAssumption:'programmatic_test_confirmation',externalStorageWrites:0};
}
function verifyNative(call,seeded,runId){
  const e=call.evidence,v=call.verification;
  assert.equal(e.synthetic,true);assert.equal(e.label,NATIVE_LABEL);assert.equal(e.runId,runId);assert.equal(e.slotId,call.slotId);
  assert.deepEqual(e.source,NATIVE_SOURCE);assert.deepEqual(e.context,seeded.context);
  v.hostEnvelopeMatched=true;
  if(e.sourceUnchanged===false||e.activeAfterGeneration===false){
    v.inactiveOrChangedSourceNotApplied=true;
    return {ok:false,reason:e.sourceUnchanged===false?'source_changed':'inactive_preview',applied:false,saved:false};
  }
  assert.equal(e.sourceUnchanged,true);assert.equal(e.activeAfterGeneration,true);
  if(seeded.ticket===null){
    assert.equal(e.transport.dispatches,0);assert.equal(e.transport.request,null);assert.equal(e.transport.response,null);
    assert.equal(e.api,null);assert.equal(e.hostRequest,null);assert.deepEqual(e.localControl,seeded.localControl);
    assert.equal(seeded.session.pending,null);assert.equal(seeded.session.review,null);
    v.localStopWithoutModel=true;return {ok:true,kind:'local_control',applied:false,saved:false,modelCalls:0};
  }
  const route=fixedRoute(),requestData=buildClarityModelRequest(seeded.context,route.profile),expected=prepareProviderRequest(requestData,route);
  assert.equal(e.hostRequest?.policyVersion,requestData.policyVersion);assert.equal(e.hostRequest?.schemaVersion,requestData.schemaVersion);
  assert.deepEqual(e.hostRequest.expectedContext,seeded.context);assert.equal(JSON.stringify(e.transport.request),expected.body);
  assert.equal(e.transport.requestedModel,NATIVE_SOURCE.modelId);assert.equal(e.transport.returnedModel,e.transport.response?.model??null);
  v.exactRequestMatched=true;v.requestSha256=digest(expected.body);v.requestBytes=expected.byteLength;
  const result=e.api?.result;
  assert.ok(result&&typeof result==='object');
  if(result.reason==='usage_out_of_bounds'){
    assert.notEqual(result.status,'candidate');v.providerFailureRecorded=true;
    return {ok:false,reason:'usage_out_of_bounds',applied:false,saved:false};
  }
  if(e.transport.httpStatus!==200){
    assert.notEqual(result.status,'candidate');assert.equal(e.transport.response,null);v.providerFailureRecorded=true;
    return {ok:false,reason:safeReason(result.reason),applied:false,saved:false};
  }
  assert.equal(e.transport.dispatches,1);assert.equal(e.api.httpStatus,200);
  assert.equal(result.flow,CLARITY_FLOW);assert.equal(result.requestId,seeded.ticket.requestId);assert.equal(result.revision,seeded.ticket.revision);
  assert.deepEqual(result.route,NATIVE_SOURCE);
  const choices=e.transport.response?.choices;
  if(!Array.isArray(choices)||choices.length!==1||choices[0]?.finish_reason!=='stop'||typeof choices[0]?.message?.content!=='string'){
    assert.notEqual(result.status,'candidate');v.nativeIncompleteRejectionMatched=true;
    return {ok:false,reason:'native_response_incomplete',applied:false,saved:false};
  }
  const content=choices[0].message.content;v.nativeContentSha256=digest(content);
  let raw;
  try{raw=JSON.parse(content);}catch{
    assert.notEqual(result.status,'candidate');v.nativeParseRejectionMatched=true;
    return {ok:false,reason:'native_json_parse_failed',applied:false,saved:false};
  }
  call.rawOutput=raw;v.nativeResponseParsed=true;
  const checked=validateClarityResponse(raw,seeded.context);
  call.nativeValidation=structuredClone(checked);
  if(!checked.ok){
    assert.equal(result.status,'fallback');assert.equal(result.reason,checked.reason);assert.equal(result.candidate,null);
    v.runtimeRejectionMatched=true;return {ok:false,reason:checked.reason,applied:false,saved:false};
  }
  assert.equal(result.status,'candidate');assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);assert.equal(result.policyVersion,requestData.policyVersion);
  assert.deepEqual(result.candidate,checked.candidate);
  v.validatedCandidateMatched=true;v.rawEqualsValidatedCandidate=same(raw,checked.candidate);
  v.hostNormalizationObserved=!v.rawEqualsValidatedCandidate;
  const applied=applyClarityReply(seeded.session,seeded.ticket,result);
  call.actualState={applied:applied.ok,reason:applied.reason??null,stage:seeded.session.stage,reviewReady:seeded.session.reviewReady,
    complete:seeded.session.complete,question:seeded.session.question,review:structuredClone(seeded.session.review)};
  if(!applied.ok)return {ok:false,reason:safeReason(applied.reason),applied:false,saved:false};
  v.actualStateApplied=true;
  if(seeded.ticket.kind!=='review'){
    assert.equal(result.candidate.finish,false);assert.equal(seeded.session.review,null);assert.equal(seeded.session.reviewReady,false);assert.equal(seeded.session.complete,false);
    v.reflectDidNotComposeReport=true;return {ok:true,kind:'reflect',applied:true,saved:false};
  }
  assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);assert.ok(seeded.session.review);
  const saved=memorySave(seeded.session);call.programmaticSave=saved;
  if(!saved.ok||!saved.roundTripExact)return {ok:false,reason:saved.reason??'memory_readback_mismatch',applied:true,saved:false};
  v.memorySaveReadbackMatched=true;return {ok:true,kind:'review',applied:true,saved:true};
}

export async function runNativeV3Evaluation({runId,origin=NATIVE_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validNativeRunId(runId)||origin!==NATIVE_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function'||typeof now!=='function')throw new TypeError('invalid_native_evaluation_options');
  const slots=NATIVE_SLOT_IDS.map(slotId=>{const seeded=prepareNativeFixture(slotId,runId);return {slotId,requestId:seeded.ticket?.requestId??null,
    plannedModelCalls:seeded.ticket===null?0:1,purpose:NATIVE_CASES.find(s=>s.id===slotId).purpose,status:'registered',handled:false,complete:false,call:null};});
  const report={synthetic:true,label:NATIVE_LABEL,kind:'known_context_native_v3_qualification',targetPolicyVersion:CLARITY_POLICY_VERSION,runId,origin,source:NATIVE_SOURCE,
    startedAt:new Date(now()).toISOString(),registeredSlots:slots,plannedMaximumModelCalls:6,retries:0,clientStepAttempts:0,
    modelDispatchesObserved:0,nativeResponseCount:0,complete:false,nativeAcceptedSlotCount:0,memorySavedSlotCount:0,
    semanticReview:'pending_manual_review',contentReleaseGate:'not_met',productionIntegrated:false,humanParticipants:0,
    scope:'七个已知独立合成快照，六个原生模型请求和一个本地停止；无模型输出种子、无未来材料注入、非连续自适应链路，不完成5.6或真人验收。',
    usage:'沿用真实API账本；记录实际tokens。默认服务手动配置未定价，金额未知，不记为零费用。'};
  const save=async()=>persist(structuredClone(report));
  const finish=(slot,status)=>{slot.status=status;slot.handled=true;};
  await save();report.health={httpStatus:null};await save();let health;
  try{
    const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,NATIVE_LABEL);assert.equal(health.runId,runId);
    assert.deepEqual(health.source,NATIVE_SOURCE);assert.deepEqual(health.slots,NATIVE_SLOT_IDS);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+NATIVE_TTL_MS);
    assert.ok(now()>=health.startedAt&&now()<health.expiresAt);report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}
  await save();let stopped=null;
  for(const slot of slots){
    if(stopped){finish(slot,`skipped_${stopped.status}`);slot.failure=stopped.reason;await save();continue;}
    if(now()<health.startedAt||now()>=health.expiresAt){stopped={status:'expired',reason:'preview_expired'};finish(slot,'skipped_expired');slot.failure=stopped.reason;await save();continue;}
    const seeded=prepareNativeFixture(slot.slotId,runId),call={slotId:slot.slotId,requestId:slot.requestId,context:seeded.context,httpStatus:null,evidence:null,verification:{}};
    slot.call=call;slot.status='dispatching';report.clientStepAttempts++;await save();
    const started=now();let response,received;
    try{response=await fetchImpl(`${origin}/evaluate/${slot.slotId}`,{method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)});
      call.httpStatus=response.status;received=await response.json();}catch{call.failure='preview_transport_failed';}
    call.elapsedMs=Math.max(0,now()-started);
    if(response&&response.status!==200){call.failure='preview_request_rejected';call.rejection=safeReason(received?.reason);}
    else if(!call.failure){call.evidence=received;report.modelDispatchesObserved+=received?.transport?.dispatches===1?1:0;
      if(received?.transport?.httpStatus===200&&received.transport.response?.choices?.some(choice=>typeof choice.message?.content==='string'))report.nativeResponseCount++;}
    // Persist every observation before verification or another side effect;
    // persistence failures escape rather than becoming model/transport errors.
    await save();
    if(call.evidence){try{call.stateVerification=now()<health.startedAt||now()>=health.expiresAt?
      {ok:false,reason:'inactive_preview',applied:false,saved:false}:verifyNative(call,seeded,runId);slot.complete=call.stateVerification.ok;
      if(!slot.complete)slot.failure=call.stateVerification.reason;}catch{call.failure='native_evidence_or_state_rejected';}}
    if(call.failure)slot.failure=call.failure;
    const reason=call.stateVerification?.reason??call.rejection??call.evidence?.api?.result?.reason;
    if(SOURCE_REASONS.has(reason)||call.evidence?.sourceUnchanged===false||call.evidence?.activeAfterGeneration===false)stopped={status:'source_changed',reason:safeReason(reason??'source_changed')};
    else if(reason==='usage_out_of_bounds')stopped={status:'usage_safety',reason};
    else if(ACCOUNT_REASONS.has(reason)||[401,402,403,429].includes(call.evidence?.transport?.httpStatus))stopped={status:'account_rejected',reason:safeReason(reason??'provider_rejected')};
    finish(slot,slot.complete?(seeded.ticket===null?'local_control_verified':call.stateVerification.saved?'native_review_saved':'native_reflect_applied'):
      call.verification.runtimeRejectionMatched?'native_runtime_rejected':call.verification.nativeParseRejectionMatched?'native_parse_rejected':
      call.verification.nativeIncompleteRejectionMatched?'native_incomplete':call.verification.providerFailureRecorded?'provider_failed':call.failure??'evidence_rejected');
    await save();
  }
  report.complete=slots.every(s=>s.handled);report.nativeAcceptedSlotCount=slots.filter(s=>s.complete&&s.plannedModelCalls===1).length;
  report.memorySavedSlotCount=slots.filter(s=>s.call?.programmaticSave?.ok&&s.call.programmaticSave.roundTripExact).length;
  report.skippedSlotCount=slots.filter(s=>s.status.startsWith('skipped_')).length;
  report.fixedBatchFullyDispatched=report.clientStepAttempts===7&&report.modelDispatchesObserved===6;
  report.stopReason=stopped?.reason??null;report.completedAt=new Date(now()).toISOString();await save();return report;
}

export function nativeV3SourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['scripts/experiments/clarity-v3-native-fixtures.mjs','scripts/experiments/clarity-v3-native-fixtures.test.mjs','scripts/experiments/clarity-v3-native-worker.mjs','scripts/experiments/clarity-v3-native-worker.test.mjs',
    'scripts/experiments/clarity-v3-native-live.mjs','scripts/experiments/clarity-v3-native-live.test.mjs','scripts/experiments/clarity-model-comparison-worker.mjs',
    'ai/fixtures/clarity-relation-plan-known.mjs','ai/clarity-v3.mjs','ai/clarity-v3-correction.mjs','ai/clarity-v3-correction.test.mjs','ai/clarity-v3-ownership.test.mjs','ai/clarity-v3-owned-review.test.mjs','ai/clarity-grounding.mjs','ai/clarity-turn.mjs','ai/runtime.mjs','ai/providers.mjs','ai/provider-transport.mjs','ai/ledger.mjs',
    'server/api.mjs','server/organizer-config.mjs','server/secrets.mjs','public/clarity-v3-contract.mjs','public/clarity-v3-intent.mjs','public/clarity-v3-state.mjs','public/clarity-state.mjs','public/clarity-contract.mjs',
    'openspec/changes/clarity-tarot-reflection/v3-native-qualification.md','openspec/changes/clarity-tarot-reflection/listening-2-repair.md','package.json'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validNativeRunId(args[1]))throw new TypeError('invalid_native_evaluation_cli');
  const output=new URL(`../../work/native-v3-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_native_evaluation_ledger');
  const source=nativeV3SourceMetadata();if(source.sourceTreeDirty)throw Error('native_evaluation_requires_frozen_source');mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const report=await runNativeV3Evaluation({runId:args[1],persist:value=>{const temporary=fileURLToPath(output)+'.tmp';
    writeFileSync(temporary,JSON.stringify({...source,...value},null,2));renameSync(temporary,fileURLToPath(output));}});
  console.log(JSON.stringify({output:fileURLToPath(output),complete:report.complete,dispatches:report.modelDispatchesObserved,accepted:report.nativeAcceptedSlotCount,saved:report.memorySavedSlotCount,stopReason:report.stopReason}));
}
