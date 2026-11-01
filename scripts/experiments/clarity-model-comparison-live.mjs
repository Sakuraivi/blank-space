import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {applyClarityReply,saveClarityRecord,readClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {MODEL_COMPARISON_LABEL,MODEL_COMPARISON_ORIGIN,MODEL_COMPARISON_TTL_MS,MODEL_COMPARISON_SOURCE,MODEL_COMPARISON_ARMS,
  validModelComparisonRunId,loadModelComparisonFixtures,comparisonApiRoute,modelComparisonOrder,modelComparisonRequestId,
  prepareModelComparisonFixture,prepareModelComparison} from './clarity-model-comparison-fixtures.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const PREFLIGHT_HTTP=new Set([400,401,402,403,404,422,429]);
const PREFLIGHT_REASONS=new Set(['provider_auth_failed','provider_balance_low','provider_rate_limited','provider_access_denied','provider_model_unavailable','provider_request_rejected']);
const SOURCE_REASONS=new Set(['default_route_mismatch','default_source_mismatch','config_changed','consent_changed','source_changed']);
function noPrivateMetadata(value){
  if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
    assert.equal(['focus','anchorId','anchorIds','selectionTrace','snapshotId','exampleBlock','pairControl','control','instruction','transport','sourceBinding','requestedModel','returnedModel'].includes(key),false);
    noPrivateMetadata(item);
  }
}
function saveAndReopen(session,prepared){
  assert.deepEqual(prepared.checkVisibleMaterial(session),{status:'visible',allVisible:true});
  const expected=readClarityRecord({formatVersion:2,id:session.id,modeId:session.modeId,createdAt:session.createdAt,confirmed:true,review:session.review});assert.ok(expected);
  const values=new Map([['liubai.records.v1','[]']]);
  const saved=saveClarityRecord(session,{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
  assert.equal(saved.ok,true);assert.deepEqual(saved.record,expected);
  const serialized=new Map(JSON.parse(JSON.stringify([...values]))),entries=readRecordEntries({getItem:key=>serialized.get(key)??null});
  assert.equal(entries.length,1);assert.deepEqual(entries[0].record,expected);assert.deepEqual(JSON.parse(serialized.get(RECORD_STORE))[0],expected);
  assert.equal(serialized.get('liubai.records.v1'),'[]');
  assert.equal(expected.review.blocks.find(block=>block.id==='context'&&block.group==='main')?.text,prepared.ledger.retainedText);noPrivateMetadata(expected);
  return {ok:true,allActiveMaterialVisible:true,savedRecord:expected,scope:'该格独立内存保存与JSON读回；不是浏览器或内容效果证据。'};
}
function verify(call,seeded,selected,control,{sample,runId,arm}){
  const evidence=call.evidence,result=evidence.api.result,verification=call.verification,prepared=selected.prepared;
  assert.equal(evidence.synthetic,true);assert.equal(evidence.label,MODEL_COMPARISON_LABEL);assert.equal(evidence.kind,'fixed_examples_model_arm');
  assert.equal(evidence.runId,runId);assert.equal(evidence.caseId,sample.id);assert.equal(evidence.arm,arm);
  assert.equal(evidence.requestId,seeded.ticket.requestId);assert.equal(evidence.revision,seeded.ticket.revision);
  assert.deepEqual(evidence.context,seeded.context);assert.deepEqual(evidence.source,MODEL_COMPARISON_SOURCE);assert.deepEqual(evidence.route,comparisonApiRoute(arm));assert.deepEqual(evidence.control,control);
  assert.equal(Object.hasOwn(evidence,'continuationToken'),false);assert.equal(evidence.hostRequest.policyVersion,prepared.requestData.policyVersion);
  assert.equal(evidence.hostRequest.schemaVersion,'liubai-material-retention-3');assert.deepEqual(evidence.hostRequest.binding,prepared.binding);
  assert.equal(JSON.stringify(evidence.transport.request),selected.transport.body);
  verification.hostEnvelopeMatched=true;verification.exactRequestMatched=true;verification.requestSha256=digest(selected.transport.body);
  const requestedModel=selected.route.modelId;
  assert.equal(evidence.transport.requestedModel,requestedModel);
  assert.equal(evidence.transport.returnedModel,evidence.transport.response?.model??null);
  call.modelObservation={requestedModel,returnedModel:evidence.transport.returnedModel};
  if(evidence.progress.stopReason){assert.notEqual(result.status,'candidate');return {ok:false,reason:evidence.progress.stopReason};}
  if(evidence.transport.httpStatus!==200){
    assert.equal(evidence.transport.response,null);assert.notEqual(result.status,'candidate');assert.equal(evidence.progress.applied,false);assert.equal(evidence.progress.maySave,false);
    verification.providerFailureRecorded=true;return {ok:false,reason:result.reason??'provider_failed'};
  }
  assert.equal(evidence.transport.dispatches,1);assert.equal(evidence.api.httpStatus,200);
  assert.equal(result.flow,'clarity-v2');assert.equal(result.requestId,seeded.ticket.requestId);assert.equal(result.revision,seeded.ticket.revision);assert.deepEqual(result.route,comparisonApiRoute(arm));
  if(result.status==='fallback'&&result.reason==='usage_out_of_bounds'){
    assert.equal(result.candidate,null);assert.equal(evidence.progress.applied,false);assert.equal(evidence.progress.maySave,false);
    verification.providerFailureRecorded=true;return {ok:false,reason:result.reason};
  }
  const choices=evidence.transport.response?.choices;
  assert.equal(choices?.length,1);
  if(choices[0].finish_reason!=='stop'){
    assert.equal(result.status,'fallback');assert.equal(result.candidate,null);assert.equal(evidence.progress.applied,false);assert.equal(evidence.progress.maySave,false);
    verification.incompleteNativeResponseMatched=true;return {ok:false,reason:'native_response_incomplete'};
  }
  let raw;try{raw=JSON.parse(choices[0].message.content);}catch{
    assert.equal(result.status,'fallback');assert.equal(result.candidate,null);assert.equal(evidence.progress.applied,false);assert.equal(evidence.progress.maySave,false);
    verification.nativeParseFailureMatched=true;return {ok:false,reason:'native_json_parse_failed'};
  }
  verification.nativeResponseParsed=true;
  const checked=prepared.validateSelection(raw,seeded.context);
  if(!checked.ok){
    assert.equal(result.status,'fallback');assert.equal(result.reason,checked.reason);assert.equal(result.candidate,null);assert.equal(evidence.progress.applied,false);assert.equal(evidence.progress.maySave,false);
    verification.runtimeRejectionMatched=true;return {ok:false,reason:checked.reason};
  }
  assert.equal(result.status,'candidate');assert.equal(result.policyVersion,prepared.requestData.policyVersion);assert.equal(result.schemaVersion,'liubai-clarity-1');assert.deepEqual(result.candidate,checked.candidate);
  assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion','requestId','revision','route','flow'].sort());noPrivateMetadata(result.candidate);
  assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);assert.equal(evidence.progress.applied,true);assert.equal(evidence.progress.maySave,true);
  assert.equal(applyClarityReply(seeded.session,seeded.ticket,result).ok,true);assert.deepEqual(evidence.progress.retentionVisibility,prepared.checkVisibleMaterial(seeded.session));
  verification.nativeRawCompiledMatched=true;verification.actualStateApplied=true;return saveAndReopen(seeded.session,prepared);
}
function safeRejection(value){return typeof value?.reason==='string'&&/^[a-z_]{1,80}$/u.test(value.reason)?value.reason:'unclassified_preview_rejection';}
function preflightRejection(call){
  const evidence=call.evidence;
  let rejection;
  if(PREFLIGHT_HTTP.has(call.httpStatus)&&!evidence?.api)rejection={reason:call.rejection??'preview_rejected',httpStatus:call.httpStatus,scope:'preview'};
  else if(call.verification.hostEnvelopeMatched&&call.verification.exactRequestMatched){
    if(PREFLIGHT_HTTP.has(evidence?.transport?.httpStatus))rejection={reason:evidence?.api?.result?.reason??'provider_rejected',httpStatus:evidence.transport.httpStatus,scope:'provider'};
    else if(evidence?.transport?.dispatches===0&&PREFLIGHT_REASONS.has(evidence?.api?.result?.reason))rejection={reason:evidence.api.result.reason,httpStatus:evidence.api.httpStatus,scope:'api'};
  }
  if(!rejection)return null;
  rejection.category=({provider_auth_failed:'authentication_rejected',provider_model_unavailable:'model_unavailable',provider_access_denied:'access_denied',
    provider_balance_low:'quota_or_balance_rejected',provider_request_rejected:'request_rejected',provider_rate_limited:'rate_limited'})[rejection.reason]??'unclassified_preflight_rejection';
  return rejection;
}

export async function runModelComparisonEvaluation({runId,origin=MODEL_COMPARISON_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validModelComparisonRunId(runId)||origin!==MODEL_COMPARISON_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function'||typeof now!=='function')throw new TypeError('invalid_model_comparison_evaluation');
  const samples=await loadModelComparisonFixtures();
  const registeredAttempts=samples.flatMap((sample,index)=>modelComparisonOrder(index).map(arm=>({caseId:sample.id,arm,requestId:modelComparisonRequestId(runId,sample.id,arm),status:'registered'})));
  const cases=samples.map((sample,index)=>({caseId:sample.id,index,order:modelComparisonOrder(index),group:'known_regression',requirements:sample.requirements,forbiddenAdditions:sample.forbiddenAdditions,
    expectedRelation:sample.expectedRelation,...(sample.origin===undefined?{}:{origin:sample.origin}),
    arms:Object.fromEntries(MODEL_COMPARISON_ARMS.map(arm=>[arm.id,{handled:false,complete:false,status:'registered',calls:[]}])),complete:false,semanticReview:'pending_manual_review'}));
  const report={synthetic:true,label:MODEL_COMPARISON_LABEL,kind:'fixed_examples_known_model_comparison',runId,origin,startedAt:new Date(now()).toISOString(),source:MODEL_COMPARISON_SOURCE,
    requestedModels:MODEL_COMPARISON_ARMS,registeredAttempts,plannedMaximumModelCalls:24,retries:0,clientStepAttempts:0,modelDispatchesObserved:0,nativeResponseCount:0,cases,
    armReadiness:Object.fromEntries(MODEL_COMPARISON_ARMS.map(arm=>[arm.id,{status:'not_yet_observed',firstCaseId:null,failure:null}])),complete:false,
    productionIntegrated:false,semanticReview:'pending_manual_review',contentReleaseGate:'not_met',
    scope:'八个全已见context，三型号各一次，共24格预注册；按case轮转顺序，非随机、非盲测，不代表泛化或新版flow验收。首FULL格同时核实际账户接入，不另付费probe或重试。',
    control:'固定E示例、输入、三字段输出和validator；实际provider body除model外相同。别名returnedModel单列，不推断底层快照。',
    usage:'沿用真实API账本和实际tokens；单价未知，金额未知，不能记为零费用。没有额外付费审校。'};
  const save=async()=>persist(structuredClone(report));
  const registration=(caseId,arm)=>registeredAttempts.find(item=>item.caseId===caseId&&item.arm===arm);
  function terminal(row,arm,status){row.arms[arm].handled=true;row.arms[arm].status=status;registration(row.caseId,arm).status=status;}
  await save();report.health={dispatched:true,httpStatus:null};await save();let health;
  try{
    const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,MODEL_COMPARISON_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+MODEL_COMPARISON_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}
  await save();let stopRemaining=null;
  for(const [index,sample]of samples.entries()){
    const row=cases[index];let seeds,comparison;
    try{
      seeds=Object.fromEntries(MODEL_COMPARISON_ARMS.map(arm=>[arm.id,prepareModelComparisonFixture(sample,runId,health.startedAt,arm.id)]));
      assert.notEqual(seeds.reference.session,seeds.max.session);assert.notEqual(seeds.reference.session,seeds.flash.session);
      assert.deepEqual(seeds.reference.context,seeds.max.context);assert.deepEqual(seeds.reference.context,seeds.flash.context);
      comparison=await prepareModelComparison(seeds.reference.context);row.control=comparison.control;
    }catch{
      row.failure='model_comparison_preparation_rejected';for(const arm of row.order)terminal(row,arm,'skipped_preparation_failure');await save();continue;
    }
    await save();
    for(const arm of row.order){
      const armRow=row.arms[arm],readiness=report.armReadiness[arm];
      if(stopRemaining){armRow.failure=stopRemaining.reason;terminal(row,arm,stopRemaining.status);await save();continue;}
      if(readiness.status==='preflight_rejected'){armRow.failure=readiness.failure.reason;terminal(row,arm,'skipped_after_preflight_rejection');await save();continue;}
      if(now()<health.startedAt||now()>=health.expiresAt){armRow.failure='preview_expired_before_attempt';terminal(row,arm,'skipped_expired');await save();continue;}
      const seeded=seeds[arm],selected=comparison.arms[arm],call={arm,requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,context:seeded.context,httpStatus:null,evidence:null,
        verification:{hostEnvelopeMatched:false,exactRequestMatched:false,nativeRawCompiledMatched:false,actualStateApplied:false},stateVerification:null};
      armRow.calls.push(call);report.clientStepAttempts++;registration(sample.id,arm).status='dispatching';await save();
      const started=now();let response,received;
      try{
        response=await fetchImpl(`${origin}/evaluate/${sample.id}/${arm}`,{method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)});
        call.httpStatus=response.status;received=await response.json();
      }catch{call.failure='preview_transport_failed';}
      if(response&&response.status!==200){call.rejection=safeRejection(received);call.failure='preview_request_rejected';}
      else if(!call.failure){
        call.evidence=received;
        report.modelDispatchesObserved+=received?.transport?.dispatches===1?1:0;
        if(received?.transport?.httpStatus===200&&received.transport.response?.choices?.some(choice=>typeof choice.message?.content==='string'))report.nativeResponseCount++;
      }
      // Every observation is durable before verification or the next dispatch;
      // a persistence exception escapes and stops the batch instead of being
      // reclassified as a transport/model failure and then silently continued.
      call.elapsedMs=Math.max(0,now()-started);await save();
      if(call.evidence){
        try{call.stateVerification=verify(call,seeded,selected,comparison.control,{sample,runId,arm});armRow.complete=call.stateVerification.ok;
          if(!armRow.complete)armRow.failure=call.stateVerification.reason;
        }catch{call.failure='model_comparison_evidence_candidate_or_state_rejected';}
      }
      if(call.failure)armRow.failure=call.failure;
      const rejection=preflightRejection(call);if(rejection)call.providerRejection=rejection;
      // Only the registered FULL first case doubles as account/transport
      // preflight. A later 400 may reject that sample rather than the model;
      // it cannot silently remove the remaining different registered cases.
      const denied=index===0?rejection:null;
      if(denied){readiness.status='preflight_rejected';readiness.firstCaseId??=sample.id;readiness.failure={...denied,requestId:call.requestId,caseId:sample.id};}
      else if(call.evidence?.transport?.httpStatus===200){readiness.status='observed_inference_response';readiness.firstCaseId??=sample.id;}
      const sourceReason=call.evidence?.progress?.stopReason??call.evidence?.api?.result?.reason??call.rejection;
      if(SOURCE_REASONS.has(sourceReason))stopRemaining={reason:sourceReason,status:'skipped_source_changed'};
      else if(sourceReason==='usage_out_of_bounds')stopRemaining={reason:sourceReason,status:'skipped_safety_stop'};
      terminal(row,arm,armRow.complete?'candidate_saved':denied?'preflight_rejected':call.verification.nativeParseFailureMatched?'native_parse_failed':
        call.verification.runtimeRejectionMatched?'runtime_rejected':call.verification.incompleteNativeResponseMatched?'native_incomplete':
        call.verification.providerFailureRecorded?'provider_failed':call.failure==='preview_request_rejected'?'preview_rejected':call.failure==='preview_transport_failed'?'transport_failed':'evidence_rejected');
      await save();
    }
    row.complete=row.order.every(arm=>row.arms[arm].complete);await save();
  }
  const slots=cases.flatMap(row=>Object.values(row.arms)),calls=slots.flatMap(slot=>slot.calls);
  report.complete=slots.length===24&&slots.every(slot=>slot.handled);
  report.completedCaseCount=cases.filter(row=>row.complete).length;report.completedArmCount=slots.filter(slot=>slot.complete).length;report.memorySavedArmCount=report.completedArmCount;
  report.skippedSlotCount=slots.filter(slot=>slot.status.startsWith('skipped_')).length;report.fixedBatchFullyDispatched=report.clientStepAttempts===24&&report.modelDispatchesObserved===24;
  report.runtimeRejectedOutputCount=calls.filter(call=>call.verification.runtimeRejectionMatched).length;
  report.nativeParseFailureCount=calls.filter(call=>call.verification.nativeParseFailureMatched).length;
  report.nativeIncompleteCount=calls.filter(call=>call.verification.incompleteNativeResponseMatched).length;
  report.completedAt=new Date(now()).toISOString();await save();return report;
}

export function modelComparisonSourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-example-review.mjs','ai/experiments/clarity-review-examples.mjs','ai/experiments/clarity-example-review.test.mjs','ai/experiments/clarity-model-comparison.test.mjs',
    'ai/experiments/clarity-guided-reflect.mjs','ai/experiments/clarity-faithful-dialogue.mjs','ai/experiments/clarity-source-checked.mjs','ai/experiments/clarity-duration-source.mjs',
    'ai/experiments/clarity-retained-concern.mjs','ai/experiments/clarity-retention-ledger.mjs','ai/experiments/clarity-materials.mjs','ai/clarity.mjs','ai/clarity-grounding.mjs','ai/clarity-turn.mjs',
    'ai/runtime.mjs','ai/ledger.mjs','ai/providers.mjs','ai/provider-transport.mjs','server/api.mjs','server/organizer-config.mjs','server/secrets.mjs','public/clarity-contract.mjs','public/clarity-state.mjs',
    'ai/fixtures/clarity-relation-plan-known.mjs','ai/fixtures/clarity-relation-plan-fresh.mjs','scripts/experiments/clarity-relation-plan-fixtures.mjs','scripts/experiments/clarity-example-review-fixtures.mjs',
    'scripts/experiments/clarity-model-comparison-fixtures.mjs','scripts/experiments/clarity-model-comparison-worker.mjs','scripts/experiments/clarity-model-comparison-worker.test.mjs',
    'scripts/experiments/clarity-model-comparison-live.mjs','scripts/experiments/clarity-model-comparison-live.test.mjs','openspec/changes/clarity-tarot-reflection/model-comparison-v1-evaluation.md','package.json'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,
    sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validModelComparisonRunId(args[1]))throw new TypeError('invalid_model_comparison_cli');
  const output=new URL(`../../work/model-comparison-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_model_comparison_ledger');
  const source=modelComparisonSourceMetadata();if(source.sourceTreeDirty)throw Error('model_comparison_requires_frozen_source');mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const report=await runModelComparisonEvaluation({runId:args[1],persist:value=>{
    const temporary=fileURLToPath(output)+'.tmp';writeFileSync(temporary,JSON.stringify({...source,...value},null,2));renameSync(temporary,fileURLToPath(output));
  }});
  console.log(JSON.stringify({file:output.href,attempts:report.clientStepAttempts,dispatches:report.modelDispatchesObserved,savedArms:report.memorySavedArmCount,
    skipped:report.skippedSlotCount,complete:report.complete,fullyDispatched:report.fixedBatchFullyDispatched,semanticReview:report.semanticReview}));
  // Completion means all slots have terminal handling, never content quality.
  if(!report.complete)process.exitCode=1;
}
