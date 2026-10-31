// Explicit synthetic native-model evaluation. Imports do not call the network,
// read credentials, or write files. The four known fixtures are regression
// cases, not a new holdout or evidence from first-time users.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildClarityModelRequest,validateClarityResponse,CLARITY_POLICY_VERSION} from '../../ai/clarity.mjs';
import {prepareRetainedConcernRun,RETAINED_CONCERN_POLICY,RETAINED_CONCERN_SCHEMA} from '../../ai/experiments/clarity-retained-concern.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {applyClarityReply,saveClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,validRunId,isFullCase,fixtureFor,prepareV2Step,matchesExpectedConcernQuestion} from './clarity-material-v2-fixtures.mjs';

export const RETENTION_V3_LABEL='liubai-material-retention-preview-3';
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
const visible=review=>({title:review.title,blocks:review.blocks.map(({id,type,group,label,text})=>({id,type,group,label,text}))});
const digest=value=>createHash('sha256').update(value).digest('hex');

function saveAndReopen(session,prepared){
  const coverage=prepared.checkVisibleMaterial(session);assert.deepEqual(coverage,{status:'visible',allVisible:true});
  const before=visible(session.review),values=new Map([['liubai.records.v1','[]']]);
  assert.equal(saveClarityRecord(session,{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}).ok,true);
  assert.deepEqual(prepared.checkVisibleMaterial(session),coverage);
  const reopened=new Map(JSON.parse(JSON.stringify([...values]))),entries=readRecordEntries({getItem:k=>reopened.get(k)??null});
  assert.equal(entries.length,1);assert.equal(entries[0].record.id,session.id);assert.deepEqual(visible(entries[0].record.review),before);
  assert.equal(entries[0].record.review.blocks.find(b=>b.id==='context'&&b.group==='main')?.text,prepared.ledger.retainedText);
  assert.equal(reopened.get('liubai.records.v1'),'[]');
  assert.doesNotMatch(JSON.stringify(entries[0].record),/sourceDigest|retiredBy|questionAssociations/);
  return {ok:true,allActiveMaterialVisible:true,recordStore:RECORD_STORE,visibleReview:before,savedRecord:entries[0].record,
    scope:'仅内存保存和JSON序列化读回，不是浏览器刷新、localStorage或PNG验证。'};
}

async function verifyAndApply(call,prepared,{runId,caseId,step,final}){
  const e=call.evidence,v=call.verification;
  assert.equal(e.synthetic,true);assert.equal(e.label,RETENTION_V3_LABEL);assert.equal(e.runId,runId);assert.equal(e.caseId,caseId);assert.equal(e.step,step);
  assert.equal(e.kind,isFullCase(caseId)?'fixed_dialogue_step':'controlled_review_only');
  assert.equal(e.requestId,prepared.ticket.requestId);assert.equal(e.revision,prepared.ticket.revision);assert.deepEqual(e.context,prepared.context);assert.deepEqual(e.route,V2_ROUTE);
  const native=final?await prepareRetainedConcernRun(prepared.context,route.profile):null;
  const request=native?.requestData??buildClarityModelRequest(prepared.context,route.profile);
  assert.equal(e.hostRequest.policyVersion,request.policyVersion);assert.equal(e.hostRequest.schemaVersion,request.schemaVersion);assert.deepEqual(e.hostRequest.binding,native?.binding??null);
  const expected=prepareProviderRequest(request,route);
  assert.equal(expected.body,JSON.stringify(e.transport.request));
  v.hostEnvelopeMatched=true;v.exactTransportRequestMatched=true;v.transportRequestSha256=digest(expected.body);
  assert.equal(e.transport.dispatches,1);assert.equal(e.api?.httpStatus,200);assert.equal(e.transport.httpStatus,200);
  const result=e.api.result;
  assert.equal(result.status,'candidate');assert.equal(result.flow,'clarity-v2');assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.equal(result.requestId,prepared.ticket.requestId);assert.equal(result.revision,prepared.ticket.revision);assert.deepEqual(result.route,V2_ROUTE);
  assert.equal(result.policyVersion,final?RETAINED_CONCERN_POLICY:CLARITY_POLICY_VERSION);
  const choices=e.transport.response?.choices;assert.equal(choices?.length,1);assert.equal(choices[0].finish_reason,'stop');
  // Parse the native response as-is: no historical mapping, fence removal,
  // added claims or hidden retry can turn a failed response into a success.
  const raw=JSON.parse(choices[0].message.content);
  const checked=native?native.validateSelection(raw,prepared.context):validateClarityResponse(raw,prepared.context);
  assert.equal(checked.ok,true);assert.deepEqual(checked.candidate,result.candidate);v.nativeRawCompiledUnchanged=true;
  assert.equal(result.candidate.finish,final);assert.equal(e.progress?.applied,true);
  assert.equal(applyClarityReply(prepared.session,prepared.ticket,result).ok,true);v.actualStateApplied=true;
  if(final){
    assert.equal(result.candidate.question,null);assert.equal(prepared.session.stage,'reviewing');
    assert.deepEqual(e.progress.retentionVisibility,native.checkVisibleMaterial(prepared.session));
    call.retention={version:native.ledger.version,snapshotId:native.ledger.snapshotId,retainedText:native.ledger.retainedText,
      retainedLength:native.ledger.retainedLength,questionAssociations:native.ledger.questionAssociations,
      semanticCoverage:'unverified',associationMeaning:native.ledger.associationMeaning};
    return saveAndReopen(prepared.session,native);
  }
  assert.equal(prepared.session.stage,'exploring');assert.equal(e.progress.mayContinue,true);
  assert.equal(matchesExpectedConcernQuestion(prepared.session,fixtureFor(caseId),step-1),true);
  return {ok:true,scope:'真实上一回复及Host问题驱动下一固定回答；目标匹配不证明一般提问质量。'};
}

export async function runRetentionV3Evaluation({runId,origin=V2_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validRunId(runId)||origin!==V2_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function')throw new TypeError('invalid_retention_v3_options');
  const report={synthetic:true,kind:'native_v3_known_regression',label:RETENTION_V3_LABEL,runId,origin,startedAt:new Date(now()).toISOString(),expectedRoute:V2_ROUTE,
    reviewPolicy:RETAINED_CONCERN_POLICY,reviewSchema:RETAINED_CONCERN_SCHEMA,retries:0,clientStepAttempts:0,modelDispatchesObserved:0,nativeResponseCount:0,samples:[],complete:false,
    nativeProtocolRequested:true,productionIntegrated:false,semanticReview:'pending_manual_review',contentReleaseGate:'not_met',
    scope:'四个已知合成回归案例，最多七次真实调用；不是新holdout、用户研究或全产品验收。',
    usage:'保留失败及实际tokens；精确别名单价未核实时金额未知，不把未知费用记为0。'};
  const save=async()=>persist(structuredClone(report));await save();
  report.health={dispatched:true,httpStatus:null};await save();let health;
  try{
    const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,RETENTION_V3_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+V2_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}
  await save();
  for(const caseId of V2_CASE_IDS){
    const fixture=fixtureFor(caseId),full=isFullCase(caseId),sample={caseId,kind:full?'fixed_full_dialogue':'controlled_review_only',requirements:fixture.requirements,
      forbiddenAdditions:fixture.forbiddenAdditions,meaningfulDistinctions:fixture.meaningfulDistinctions,...(full?{turnRequirements:fixture.turnRequirements}:{}),
      calls:[],complete:false,semanticReview:'pending_manual_review'};
    report.samples.push(sample);await save();let session=null,continuationToken=null;
    for(let step=1;step<=(full?4:1);step++){
      if(now()<health.startedAt||now()>=health.expiresAt){sample.stopReason='preview_expired_before_step';break;}
      let prepared;try{prepared=prepareV2Step(caseId,runId,health.startedAt,step,session,3);}catch{sample.stopReason='fixture_or_question_boundary';break;}
      const call={step,requestId:prepared.ticket.requestId,revision:prepared.ticket.revision,context:prepared.context,dispatches:1,httpStatus:null,evidence:null,
        nativeResponseCaptured:false,verification:{hostEnvelopeMatched:false,exactTransportRequestMatched:false,nativeRawCompiledUnchanged:false,actualStateApplied:false},stateVerification:null};
      sample.calls.push(call);report.clientStepAttempts++;await save();const started=now();
      try{
        const options={method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)};
        if(step>1){assert.equal(typeof continuationToken,'string');options.headers['Content-Type']='application/json';options.body=JSON.stringify({continuationToken});}
        const response=await fetchImpl(`${origin}/evaluate/${caseId}/${step}`,options);call.httpStatus=response.status;
        if(response.status!==200){response.body?.cancel().catch(()=>{});call.failure='preview_request_rejected';sample.stopReason='preview_request_rejected';}
        else{
          const {continuationToken:nextToken,...evidence}=await response.json();continuationToken=nextToken;call.evidence=evidence;
          call.nativeResponseCaptured=evidence.transport?.httpStatus===200&&evidence.transport.response?.choices?.some(c=>typeof c.message?.content==='string')===true;
          if(call.nativeResponseCaptured)report.nativeResponseCount++;
          report.modelDispatchesObserved+=evidence.transport?.dispatches===1?1:0;await save();
          try{
            call.stateVerification=await verifyAndApply(call,prepared,{runId,caseId,step,final:!full||step===4});session=prepared.session;
            if(full&&step<4)assert.equal(typeof continuationToken,'string');else sample.complete=true;
          }catch{call.stateVerification={ok:false,failure:'evidence_candidate_or_state_rejected'};sample.stopReason=evidence.progress?.stopReason??evidence.api?.result?.reason??'evidence_candidate_or_state_rejected';}
        }
      }catch{call.failure='preview_transport_failed';sample.stopReason='preview_transport_failed';}
      call.elapsedMs=Math.max(0,now()-started);await save();if(sample.stopReason)break;
    }
    continuationToken=null;await save();
  }
  report.complete=report.samples.length===V2_CASE_IDS.length;report.completedCaseCount=report.samples.filter(s=>s.complete).length;
  report.completedAt=new Date(now()).toISOString();await save();return report;
}

function sourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-retained-concern.mjs','ai/experiments/clarity-retention-ledger.mjs','ai/clarity.mjs','ai/clarity-grounding.mjs',
    'ai/clarity-turn.mjs','public/clarity-state.mjs','ai/provider-transport.mjs','server/api.mjs',
    'scripts/experiments/clarity-material-v2-worker.mjs','scripts/experiments/clarity-retention-v3-worker.mjs',
    'scripts/experiments/clarity-material-v2-fixtures.mjs','ai/fixtures/clarity-material-v2-samples.mjs','scripts/experiments/clarity-retention-v3-live.mjs'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,
    sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validRunId(args[1]))throw new TypeError('invalid_retention_v3_cli');
  const output=new URL(`../../work/retention-v3-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_retention_v3_ledger');
  const source=sourceMetadata();if(source.sourceTreeDirty)throw Error('retention_v3_requires_frozen_source');
  mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const result=await runRetentionV3Evaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,clientStepAttempts:result.clientStepAttempts,modelDispatchesObserved:result.modelDispatchesObserved,
    completedCaseCount:result.completedCaseCount??0,semanticReview:result.semanticReview}));
  if(!result.complete||result.completedCaseCount!==V2_CASE_IDS.length)process.exitCode=1;
}
