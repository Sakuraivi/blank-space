// Explicit synthetic paid evaluation. No network or writes on module import.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {applyClarityReply,saveClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {V2_LABEL,V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,validRunId,isFullCase,fixtureFor,prepareV2Step,matchesExpectedConcernQuestion} from './clarity-material-v2-fixtures.mjs';
const visible=review=>({title:review.title,blocks:review.blocks.map(({id,type,group,label,text})=>({id,type,group,label,text}))});
function saveAndReopen(session){
  const before=visible(session.review),values=new Map([['liubai.records.v1','[]']]);
  assert.equal(saveClarityRecord(session,{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}).ok,true);
  const reopened=new Map(JSON.parse(JSON.stringify([...values]))),entries=readRecordEntries({getItem:k=>reopened.get(k)??null});
  assert.equal(entries.length,1);assert.equal(entries[0].record.id,session.id);assert.deepEqual(visible(entries[0].record.review),before);
  assert.equal(reopened.get('liubai.records.v1'),'[]');
  return {ok:true,visibleReview:before,recordStore:RECORD_STORE,scope:'仅内存保存和JSON序列化读回，不是浏览器刷新、localStorage或PNG验证。'};
}
function acceptEvidence(e,prepared,{runId,caseId,step,final}){
  assert.equal(e.synthetic,true);assert.equal(e.label,V2_LABEL);assert.equal(e.runId,runId);assert.equal(e.caseId,caseId);assert.equal(e.step,step);
  assert.equal(e.kind,isFullCase(caseId)?'fixed_dialogue_step':'controlled_review_only');
  assert.equal(e.requestId,prepared.ticket.requestId);assert.equal(e.revision,prepared.ticket.revision);assert.deepEqual(e.context,prepared.context);assert.deepEqual(e.route,V2_ROUTE);
  assert.equal(e.api?.httpStatus,200);const result=e.api.result;
  assert.equal(result.status,'candidate');assert.equal(result.flow,'clarity-v2');assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.equal(result.policyVersion,final?'clarity-material-experiment-2':'clarity-warm-19');assert.deepEqual(result.route,V2_ROUTE);
  assert.equal(result.candidate.finish,final);assert.equal(e.progress?.applied,true);
  assert.equal(applyClarityReply(prepared.session,prepared.ticket,result).ok,true);
  if(final){assert.equal(result.candidate.question,null);assert.equal(prepared.session.stage,'reviewing');return saveAndReopen(prepared.session);}
  assert.equal(prepared.session.stage,'exploring');
  assert.equal(matchesExpectedConcernQuestion(prepared.session,fixtureFor(caseId),step-1),true);
  assert.equal(e.progress?.mayContinue,true);
  return {ok:true,scope:'使用真实问题和回答更新工作状态；target匹配不等于语义提问有效性通过。'};
}

export async function runMaterialV2Evaluation({runId,origin=V2_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validRunId(runId)||origin!==V2_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function')throw new TypeError('invalid_v2_evaluation_options');
  const report={synthetic:true,kind:'fixed_v2_review_and_dialogue',label:V2_LABEL,runId,origin,startedAt:new Date(now()).toISOString(),expectedRoute:V2_ROUTE,
    retries:0,clientStepAttempts:0,modelDispatchesObserved:0,samples:[],semanticReview:'pending_manual_review',complete:false,
    scope:'三个新合成收尾及一个固定四轮对话；运行前未给策略实现者看材料，不是统计盲测或真人体验。',
    usage:'保留实际tokens，精确别名单价未核实时金额未知；错误和超时也可能计费。'};
  const save=async()=>persist(structuredClone(report));await save();
  report.health={dispatched:true,httpStatus:null};await save();let health;
  try{
    const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,V2_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+V2_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}
  await save();
  for(const caseId of V2_CASE_IDS){
    const fixture=fixtureFor(caseId),full=isFullCase(caseId),sample={caseId,kind:full?'fixed_full_dialogue':'controlled_review_only',requirements:fixture.requirements,
      forbiddenAdditions:fixture.forbiddenAdditions,meaningfulDistinctions:fixture.meaningfulDistinctions,...(full?{turnRequirements:fixture.turnRequirements}:{}),calls:[],complete:false,semanticReview:'pending_manual_review'};
    report.samples.push(sample);await save();let session=null,continuationToken=null;
    for(let step=1;step<=(full?4:1);step++){
      const final=!full||step===4;
      if(now()<health.startedAt||now()>=health.expiresAt){sample.stopReason='preview_expired_before_step';break;}
      let prepared;try{prepared=prepareV2Step(caseId,runId,health.startedAt,step,session);}catch{sample.stopReason='fixture_or_question_boundary';break;}
      const call={step,requestId:prepared.ticket.requestId,revision:prepared.ticket.revision,context:prepared.context,dispatches:1,httpStatus:null,evidence:null,stateVerification:null};
      sample.calls.push(call);report.clientStepAttempts++;await save();const started=now();
      try{
        const options={method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)};
        if(step>1){assert.equal(typeof continuationToken,'string');options.headers['Content-Type']='application/json';options.body=JSON.stringify({continuationToken});}
        const response=await fetchImpl(`${origin}/evaluate/${caseId}/${step}`,options);call.httpStatus=response.status;
        if(response.status!==200){response.body?.cancel().catch(()=>{});call.failure='preview_request_rejected';sample.stopReason='preview_request_rejected';}
        else{
          const raw=await response.json();continuationToken=raw.continuationToken;
          // Tokens authorize the next fixed step. Never persist or log them.
          const {continuationToken:ignored,...evidence}=raw;call.evidence=evidence;
          report.modelDispatchesObserved+=evidence.transport?.dispatches===1?1:0;await save();
          try{call.stateVerification=acceptEvidence(evidence,prepared,{runId,caseId,step,final});session=prepared.session;
            if(!final)assert.equal(typeof continuationToken,'string');else sample.complete=true;
          }catch{call.stateVerification={ok:false,failure:'candidate_or_state_rejected'};sample.stopReason=evidence.progress?.stopReason??'candidate_or_state_rejected';}
        }
      }catch{call.failure='preview_transport_failed';sample.stopReason='preview_transport_failed';}
      call.elapsedMs=Math.max(0,now()-started);await save();if(sample.stopReason)break;
    }
    continuationToken=null;await save();
  }
  report.complete=report.samples.length===V2_CASE_IDS.length;
  report.completedCaseCount=report.samples.filter(s=>s.complete).length;report.completedAt=new Date(now()).toISOString();await save();return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validRunId(args[1]))throw new TypeError('invalid_v2_evaluation_cli');
  const output=new URL(`../../work/material-v2-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_v2_evaluation_ledger');
  mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const result=await runMaterialV2Evaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify(value,null,2))});
  console.log(JSON.stringify({file:output.href,clientStepAttempts:result.clientStepAttempts,modelDispatchesObserved:result.modelDispatchesObserved,completedCaseCount:result.completedCaseCount??0,semanticReview:result.semanticReview}));
  if(!result.complete||result.completedCaseCount!==V2_CASE_IDS.length)process.exitCode=1;
}
