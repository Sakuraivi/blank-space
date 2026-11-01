import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {applyClarityReply,saveClarityRecord,readClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {EXAMPLE_LABEL,EXAMPLE_ORIGIN,EXAMPLE_TTL_MS,EXAMPLE_ROUTE,validExampleRunId,loadExampleReviewFixtures,exampleArmOrder,exampleRequestId,prepareExampleFixture,prepareExamplePair} from './clarity-example-review-fixtures.mjs';
const route=getPersonalRoute(EXAMPLE_ROUTE.providerId,EXAMPLE_ROUTE.modelId),digest=value=>createHash('sha256').update(value).digest('hex');
function noPrivateMetadata(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  assert.equal(['focus','anchorId','anchorIds','selectionTrace','snapshotId','exampleBlock','pairControl','instruction'].includes(key),false);noPrivateMetadata(item);}}
function saveAndReopen(session,prepared){
  assert.deepEqual(prepared.checkVisibleMaterial(session),{status:'visible',allVisible:true});
  const expected=readClarityRecord({formatVersion:2,id:session.id,modeId:session.modeId,createdAt:session.createdAt,confirmed:true,review:session.review});assert.ok(expected);
  const values=new Map([['liubai.records.v1','[]']]),saved=saveClarityRecord(session,{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
  assert.equal(saved.ok,true);assert.deepEqual(saved.record,expected);const serialized=new Map(JSON.parse(JSON.stringify([...values])));
  const entries=readRecordEntries({getItem:key=>serialized.get(key)??null});assert.equal(entries.length,1);assert.deepEqual(entries[0].record,expected);
  assert.deepEqual(JSON.parse(serialized.get(RECORD_STORE))[0],expected);assert.equal(serialized.get('liubai.records.v1'),'[]');
  assert.equal(expected.review.blocks.find(block=>block.id==='context'&&block.group==='main')?.text,prepared.ledger.retainedText);noPrivateMetadata(expected);
  return {ok:true,allActiveMaterialVisible:true,savedRecord:expected,scope:'每臂独立的内存保存与JSON读回，不代表浏览器操作或语义通过。'};
}
function verify(call,seeded,prepared,pairControl,{sample,runId,arm}){
  const e=call.evidence,result=e.api.result,v=call.verification;
  assert.equal(e.synthetic,true);assert.equal(e.label,EXAMPLE_LABEL);assert.equal(e.kind,'paired_example_review_arm');assert.equal(e.runId,runId);assert.equal(e.caseId,sample.id);assert.equal(e.arm,arm);
  assert.equal(e.requestId,seeded.ticket.requestId);assert.equal(e.revision,seeded.ticket.revision);assert.deepEqual(e.context,seeded.context);assert.deepEqual(e.route,EXAMPLE_ROUTE);assert.deepEqual(e.pairControl,pairControl);
  assert.equal(Object.hasOwn(e,'continuationToken'),false);assert.equal(e.hostRequest.policyVersion,prepared.requestData.policyVersion);assert.equal(e.hostRequest.schemaVersion,'liubai-material-retention-3');assert.deepEqual(e.hostRequest.binding,prepared.binding);
  const expected=prepareProviderRequest(prepared.requestData,route);assert.equal(JSON.stringify(e.transport.request),expected.body);v.hostEnvelopeMatched=true;v.exactRequestMatched=true;v.requestSha256=digest(expected.body);
  assert.equal(e.transport.dispatches,1);assert.equal(e.transport.httpStatus,200);assert.equal(e.api.httpStatus,200);
  assert.equal(result.flow,'clarity-v2');assert.equal(result.requestId,seeded.ticket.requestId);assert.equal(result.revision,seeded.ticket.revision);assert.deepEqual(result.route,EXAMPLE_ROUTE);
  const choices=e.transport.response?.choices;assert.equal(choices?.length,1);assert.equal(choices[0].finish_reason,'stop');
  const raw=JSON.parse(choices[0].message.content),checked=prepared.validateSelection(raw,seeded.context);
  if(!checked.ok){assert.equal(result.status,'fallback');assert.equal(result.reason,checked.reason);assert.equal(result.candidate,null);assert.equal(e.progress.applied,false);assert.equal(e.progress.maySave,false);
    v.runtimeRejectionMatched=true;return {ok:false,reason:checked.reason};}
  assert.equal(result.status,'candidate');assert.equal(result.policyVersion,prepared.requestData.policyVersion);assert.equal(result.schemaVersion,'liubai-clarity-1');assert.deepEqual(result.candidate,checked.candidate);
  assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion','requestId','revision','route','flow'].sort());noPrivateMetadata(result.candidate);
  assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);assert.equal(e.progress.applied,true);assert.equal(e.progress.maySave,true);
  assert.equal(applyClarityReply(seeded.session,seeded.ticket,result).ok,true);assert.deepEqual(e.progress.retentionVisibility,prepared.checkVisibleMaterial(seeded.session));
  v.nativeRawCompiledMatched=true;v.actualStateApplied=true;return saveAndReopen(seeded.session,prepared);
}
export async function runExampleReviewEvaluation({runId,origin=EXAMPLE_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validExampleRunId(runId)||origin!==EXAMPLE_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function'||typeof now!=='function')throw new TypeError('invalid_example_evaluation');
  const samples=await loadExampleReviewFixtures();
  const registeredAttempts=samples.flatMap((sample,index)=>exampleArmOrder(index).map(arm=>({caseId:sample.id,arm,requestId:exampleRequestId(runId,sample.id,arm)})));
  const report={synthetic:true,label:EXAMPLE_LABEL,kind:'paired_known_review_examples',runId,origin,startedAt:new Date(now()).toISOString(),expectedRoute:EXAMPLE_ROUTE,registeredAttempts,
    plannedMaximumModelCalls:16,retries:0,clientStepAttempts:0,modelDispatchesObserved:0,nativeResponseCount:0,pairs:[],complete:false,
    productionIntegrated:false,semanticReview:'pending_manual_review',contentReleaseGate:'not_met',
    scope:'八个全已见回归context；每例两臂各一次，偶数baseline先、奇数examples先，十六次全部预注册。另一臂是预注册比较，不是失败后的重试；输入与state独立。不是盲测或泛化证明。',
    control:'模型请求仅system末尾追加固定完整示例，输入/输出/validator及其他transport字段保持一致。模型复述示例或语义污染须另行审阅。',
    usage:'沿用默认服务的账本、tokens及原预算；未知单价不记为零费用，不调用额外付费审校。'};
  const save=async()=>persist(structuredClone(report));await save();report.health={dispatched:true,httpStatus:null};await save();let health;
  try{const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,EXAMPLE_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+EXAMPLE_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}await save();
  for(const [index,sample] of samples.entries()){
    const order=exampleArmOrder(index),row={caseId:sample.id,index,order,group:'known_regression',requirements:sample.requirements,forbiddenAdditions:sample.forbiddenAdditions,
      expectedRelation:sample.expectedRelation,...(sample.origin===undefined?{}:{origin:sample.origin}),arms:{baseline:{complete:false,calls:[]},examples:{complete:false,calls:[]}},complete:false,semanticReview:'pending_manual_review'};
    report.pairs.push(row);await save();
    // Both prepared requests and both initial states exist before either arm
    // generates anything. No arm output can become the other's input.
    let seeds,pair;try{seeds={baseline:prepareExampleFixture(sample,runId,health.startedAt,'baseline'),examples:prepareExampleFixture(sample,runId,health.startedAt,'examples')};
      assert.notEqual(seeds.baseline.session,seeds.examples.session);assert.deepEqual(seeds.baseline.context,seeds.examples.context);
      pair=await prepareExamplePair(seeds.baseline.context,route.profile);row.pairControl=pair.comparison;
    }catch{row.failure='pair_preparation_or_control_rejected';await save();continue;}
    for(const arm of order){
      const armRow=row.arms[arm],seeded=seeds[arm],prepared=pair[arm];
      if(now()<health.startedAt||now()>=health.expiresAt){armRow.failure='preview_expired_before_attempt';await save();continue;}
      const call={arm,requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,context:seeded.context,httpStatus:null,evidence:null,
        verification:{hostEnvelopeMatched:false,exactRequestMatched:false,nativeRawCompiledMatched:false,actualStateApplied:false},stateVerification:null};
      armRow.calls.push(call);report.clientStepAttempts++;await save();const start=now();
      try{const response=await fetchImpl(`${origin}/evaluate/${sample.id}/${arm}`,{method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)});call.httpStatus=response.status;
        if(response.status!==200){response.body?.cancel().catch(()=>{});call.failure='preview_request_rejected';armRow.failure=call.failure;}
        else{call.evidence=await response.json();const e=call.evidence;report.modelDispatchesObserved+=e.transport?.dispatches===1?1:0;
          if(e.transport?.httpStatus===200&&e.transport.response?.choices?.some(choice=>typeof choice.message?.content==='string'))report.nativeResponseCount++;await save();
          try{call.stateVerification=verify(call,seeded,prepared,pair.comparison,{sample,runId,arm});armRow.complete=call.stateVerification.ok;
            if(!armRow.complete)armRow.failure=call.stateVerification.reason;
          }catch{call.failure='example_evidence_candidate_or_state_rejected';armRow.failure=call.failure;}}
      }catch{call.failure='preview_transport_failed';armRow.failure=call.failure;}call.elapsedMs=Math.max(0,now()-start);await save();
    }
    row.complete=row.arms.baseline.complete&&row.arms.examples.complete;await save();
  }
  report.complete=report.pairs.length===8;report.completedPairCount=report.pairs.filter(pair=>pair.complete).length;
  report.completedArmCount=report.pairs.flatMap(pair=>Object.values(pair.arms)).filter(arm=>arm.complete).length;report.memorySavedArmCount=report.completedArmCount;
  report.runtimeRejectedOutputCount=report.pairs.flatMap(pair=>Object.values(pair.arms).flatMap(arm=>arm.calls)).filter(call=>call.verification.runtimeRejectionMatched).length;
  report.completedAt=new Date(now()).toISOString();await save();return report;
}
export function exampleReviewSourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-example-review.mjs','ai/experiments/clarity-review-examples.mjs','ai/experiments/clarity-example-review.test.mjs',
    'ai/experiments/clarity-guided-reflect.mjs','ai/experiments/clarity-faithful-dialogue.mjs','ai/experiments/clarity-source-checked.mjs',
    'ai/experiments/clarity-duration-source.mjs','ai/experiments/clarity-retained-concern.mjs','ai/experiments/clarity-retention-ledger.mjs','ai/experiments/clarity-materials.mjs',
    'ai/clarity.mjs','ai/clarity-grounding.mjs','ai/clarity-turn.mjs','ai/runtime.mjs','ai/ledger.mjs','ai/providers.mjs','ai/provider-transport.mjs','server/api.mjs','server/organizer-config.mjs','server/secrets.mjs',
    'public/clarity-contract.mjs','public/clarity-state.mjs','ai/fixtures/clarity-relation-plan-known.mjs','ai/fixtures/clarity-relation-plan-fresh.mjs',
    'scripts/experiments/clarity-relation-plan-fixtures.mjs','scripts/experiments/clarity-semantic-audit-worker.mjs',
    'scripts/experiments/clarity-example-review-fixtures.mjs','scripts/experiments/clarity-example-review-worker.mjs','scripts/experiments/clarity-example-review-live.mjs',
    'scripts/experiments/clarity-example-review-worker.test.mjs','openspec/changes/clarity-tarot-reflection/example-review-v1-evaluation.md','package.json'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validExampleRunId(args[1]))throw new TypeError('invalid_example_cli');
  const output=new URL(`../../work/example-review-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_example_ledger');
  const source=exampleReviewSourceMetadata();if(source.sourceTreeDirty)throw Error('example_requires_frozen_source');mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const report=await runExampleReviewEvaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,attempts:report.clientStepAttempts,dispatches:report.modelDispatchesObserved,savedArms:report.memorySavedArmCount,completePairs:report.completedPairCount,semanticReview:report.semanticReview}));
  if(!report.complete||report.completedPairCount!==8||report.completedArmCount!==16)process.exitCode=1;
}
