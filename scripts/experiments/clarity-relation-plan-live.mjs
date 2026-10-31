import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {applyClarityReply,saveClarityRecord,readClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {RELATION_LABEL,RELATION_ORIGIN,RELATION_TTL_MS,RELATION_ROUTE,validRelationRunId,loadRelationPlanFixtures,prepareRelationFixture} from './clarity-relation-plan-fixtures.mjs';
const route=getPersonalRoute(RELATION_ROUTE.providerId,RELATION_ROUTE.modelId),digest=value=>createHash('sha256').update(value).digest('hex');
function noPrivatePlan(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  assert.equal(['focus','anchorId','anchorIds','focusTrace','selectionTrace','snapshotId'].includes(key),false);noPrivatePlan(item);}}
function saveAndReopen(session,prepared){
  assert.deepEqual(prepared.checkVisibleMaterial(session),{status:'visible',allVisible:true});
  const expected=readClarityRecord({formatVersion:2,id:session.id,modeId:session.modeId,createdAt:session.createdAt,confirmed:true,review:session.review});assert.ok(expected);
  const values=new Map([['liubai.records.v1','[]']]),saved=saveClarityRecord(session,{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
  assert.equal(saved.ok,true);assert.deepEqual(saved.record,expected);
  const serialized=new Map(JSON.parse(JSON.stringify([...values]))),entries=readRecordEntries({getItem:key=>serialized.get(key)??null});
  assert.equal(entries.length,1);assert.deepEqual(entries[0].record,expected);assert.deepEqual(JSON.parse(serialized.get(RECORD_STORE))[0],expected);
  assert.equal(serialized.get('liubai.records.v1'),'[]');
  assert.equal(expected.review.blocks.find(block=>block.id==='context'&&block.group==='main')?.text,prepared.ledger.retainedText);noPrivatePlan(expected);
  return {ok:true,allActiveMaterialVisible:true,savedRecord:expected,scope:'仅真实state的内存保存及JSON读回，不代表浏览器刷新、图片导出或语义通过。'};
}
function verify(call,seeded,prepared,{sample,runId,policyVersion,schemaVersion}){
  const e=call.evidence,result=e.api.result,v=call.verification;
  assert.equal(e.synthetic,true);assert.equal(e.label,RELATION_LABEL);assert.equal(e.kind,'controlled_relation_review');assert.equal(e.runId,runId);assert.equal(e.caseId,sample.id);
  assert.equal(e.requestId,seeded.ticket.requestId);assert.equal(e.revision,seeded.ticket.revision);assert.deepEqual(e.context,seeded.context);assert.deepEqual(e.route,RELATION_ROUTE);
  assert.equal(Object.hasOwn(e,'continuationToken'),false);assert.equal(e.hostRequest.policyVersion,policyVersion);assert.equal(e.hostRequest.schemaVersion,schemaVersion);assert.deepEqual(e.hostRequest.binding,prepared.binding);
  const expected=prepareProviderRequest(prepared.requestData,route);assert.equal(JSON.stringify(e.transport.request),expected.body);v.hostEnvelopeMatched=true;v.exactRequestMatched=true;v.requestSha256=digest(expected.body);
  assert.equal(e.transport.dispatches,1);assert.equal(e.transport.httpStatus,200);assert.equal(e.api.httpStatus,200);
  assert.equal(result.flow,'clarity-v2');assert.equal(result.requestId,seeded.ticket.requestId);assert.equal(result.revision,seeded.ticket.revision);assert.deepEqual(result.route,RELATION_ROUTE);
  const choices=e.transport.response?.choices;assert.equal(choices?.length,1);assert.equal(choices[0].finish_reason,'stop');
  const raw=JSON.parse(choices[0].message.content),focus=prepared.checkFocus(raw),checked=prepared.validateSelection(raw,seeded.context);assert.deepEqual(e.focusCheck,focus);call.focusCheck=focus;
  if(!checked.ok){assert.equal(result.status,'fallback');assert.equal(result.reason,checked.reason);assert.equal(result.candidate,null);assert.equal(e.progress.applied,false);assert.equal(e.progress.maySave,false);
    v.runtimeRejectionMatched=true;return {ok:false,reason:checked.reason};}
  assert.equal(focus.ok,true);assert.equal(result.status,'candidate');assert.equal(result.policyVersion,policyVersion);assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.deepEqual(result.candidate,checked.candidate);assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion','requestId','revision','route','flow'].sort());noPrivatePlan(result.candidate);
  assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);assert.equal(e.progress.applied,true);assert.equal(e.progress.maySave,true);
  assert.equal(applyClarityReply(seeded.session,seeded.ticket,result).ok,true);assert.deepEqual(e.progress.retentionVisibility,prepared.checkVisibleMaterial(seeded.session));
  v.nativeRawCompiledMatched=true;v.actualStateApplied=true;return saveAndReopen(seeded.session,prepared);
}
export async function runRelationPlanEvaluation({runId,origin=RELATION_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validRelationRunId(runId)||origin!==RELATION_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function'||typeof now!=='function')throw new TypeError('invalid_relation_evaluation');
  const samples=await loadRelationPlanFixtures(),{prepareRelationPlanRun,RELATION_PLAN_POLICY,RELATION_PLAN_SCHEMA}=await import('../../ai/experiments/clarity-relation-plan.mjs');
  const report={synthetic:true,label:RELATION_LABEL,kind:'controlled_relation_plan_review',runId,origin,startedAt:new Date(now()).toISOString(),expectedRoute:RELATION_ROUTE,
    policyVersion:RELATION_PLAN_POLICY,schemaVersion:RELATION_PLAN_SCHEMA,plannedMaximumModelCalls:8,retries:0,clientStepAttempts:0,modelDispatchesObserved:0,nativeResponseCount:0,samples:[],complete:false,
    productionIntegrated:false,semanticReview:'pending_manual_review',contentReleaseGate:'not_met',
    scope:'四个已知及四个策略冻结后读取的受控concern/review，单次生成并实际应用、内存保存读回；不是对话、自然路由或语义验收。focus:null和引用合法均不证明已连起两难。',
    usage:'复用组织者默认服务账本与tokens；未核实单价时费用未知。'};
  const save=async()=>persist(structuredClone(report));await save();report.health={dispatched:true,httpStatus:null};await save();let health;
  try{const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,RELATION_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+RELATION_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}await save();
  for(const sample of samples){
    const row={caseId:sample.id,group:sample.group,requirements:sample.requirements,forbiddenAdditions:sample.forbiddenAdditions,expectedRelation:sample.expectedRelation,
      ...(sample.origin===undefined?{}:{origin:sample.origin}),calls:[],complete:false,semanticReview:'pending_manual_review'};report.samples.push(row);await save();
    if(now()<health.startedAt||now()>=health.expiresAt){row.failure='preview_expired_before_attempt';await save();continue;}
    let seeded,prepared;try{seeded=prepareRelationFixture(sample,runId,health.startedAt);prepared=await prepareRelationPlanRun(seeded.context,route.profile);prepareProviderRequest(prepared.requestData,route);}
    catch{row.failure='relation_preparation_or_capacity_rejected';await save();continue;}
    const call={requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,context:seeded.context,httpStatus:null,evidence:null,
      verification:{hostEnvelopeMatched:false,exactRequestMatched:false,nativeRawCompiledMatched:false,actualStateApplied:false},stateVerification:null};row.calls.push(call);report.clientStepAttempts++;await save();const start=now();
    try{const response=await fetchImpl(`${origin}/evaluate/${sample.id}`,{method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)});call.httpStatus=response.status;
      if(response.status!==200){response.body?.cancel().catch(()=>{});call.failure='preview_request_rejected';}
      else{call.evidence=await response.json();const e=call.evidence;report.modelDispatchesObserved+=e.transport?.dispatches===1?1:0;
        if(e.transport?.httpStatus===200&&e.transport.response?.choices?.some(choice=>typeof choice.message?.content==='string'))report.nativeResponseCount++;await save();
        try{call.stateVerification=verify(call,seeded,prepared,{sample,runId,policyVersion:RELATION_PLAN_POLICY,schemaVersion:RELATION_PLAN_SCHEMA});row.complete=call.stateVerification.ok;
          if(!row.complete)row.failure=call.stateVerification.reason;
        }catch{call.failure='relation_evidence_candidate_or_state_rejected';row.failure=call.failure;}}
    }catch{call.failure='preview_transport_failed';row.failure=call.failure;}call.elapsedMs=Math.max(0,now()-start);await save();
  }
  report.complete=report.samples.length===samples.length;report.completedCaseCount=report.samples.filter(sample=>sample.complete).length;report.memorySavedCaseCount=report.completedCaseCount;
  report.runtimeRejectedOutputCount=report.samples.flatMap(sample=>sample.calls).filter(call=>call.verification.runtimeRejectionMatched).length;
  report.completedAt=new Date(now()).toISOString();await save();return report;
}
export function relationPlanSourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-relation-plan.mjs','ai/experiments/clarity-retained-concern.mjs','ai/experiments/clarity-retention-ledger.mjs','ai/runtime.mjs','ai/ledger.mjs','ai/providers.mjs','ai/provider-transport.mjs',
    'server/api.mjs','server/organizer-config.mjs','public/clarity-contract.mjs','public/clarity-state.mjs','ai/fixtures/clarity-relation-plan-known.mjs','ai/fixtures/clarity-relation-plan-fresh.mjs',
    'scripts/experiments/clarity-semantic-audit-worker.mjs','scripts/experiments/clarity-relation-plan-fixtures.mjs','scripts/experiments/clarity-relation-plan-worker.mjs','scripts/experiments/clarity-relation-plan-live.mjs',
    'ai/experiments/clarity-faithful-dialogue.mjs','ai/experiments/clarity-source-checked.mjs','ai/experiments/clarity-duration-source.mjs',
    'ai/experiments/clarity-materials.mjs','ai/clarity.mjs','ai/clarity-grounding.mjs','ai/clarity-turn.mjs','server/secrets.mjs'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validRelationRunId(args[1]))throw new TypeError('invalid_relation_cli');
  const output=new URL(`../../work/relation-plan-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_relation_ledger');
  const source=relationPlanSourceMetadata();if(source.sourceTreeDirty)throw Error('relation_requires_frozen_source');mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const report=await runRelationPlanEvaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,attempts:report.clientStepAttempts,dispatches:report.modelDispatchesObserved,savedCases:report.memorySavedCaseCount,semanticReview:report.semanticReview}));
  if(!report.complete||report.completedCaseCount!==8)process.exitCode=1;
}
