// Private, fixed-target audit evaluation. No network or writes on import.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {AUDIT_LABEL,AUDIT_ORIGIN,AUDIT_TTL_MS,AUDIT_ROUTE,validAuditRunId,loadSemanticAuditFixtures,auditRequestId} from './clarity-semantic-audit-fixtures.mjs';

const route=getPersonalRoute(AUDIT_ROUTE.providerId,AUDIT_ROUTE.modelId);
const digest=value=>createHash('sha256').update(value).digest('hex');

function verifyAudit(call,{sample,prepared,runId,policyVersion,schemaVersion}){
  const e=call.evidence,result=e.api.result,v=call.verification;
  assert.equal(e.synthetic,true);assert.equal(e.label,AUDIT_LABEL);assert.equal(e.kind,'semantic_audit_observation');
  assert.equal(e.runId,runId);assert.equal(e.caseId,sample.id);assert.equal(e.requestId,call.requestId);assert.equal(e.revision,sample.input.context.revision);
  assert.deepEqual(e.route,AUDIT_ROUTE);assert.equal(e.progress.stateApplied,false);assert.equal(Object.hasOwn(e,'continuationToken'),false);
  assert.equal(e.hostRequest.policyVersion,policyVersion);assert.equal(e.hostRequest.schemaVersion,schemaVersion);assert.deepEqual(e.hostRequest.binding,prepared.binding);
  const expected=prepareProviderRequest(prepared.requestData,route);assert.equal(JSON.stringify(e.transport.request),expected.body);
  v.envelopeMatched=true;v.exactRequestMatched=true;v.requestSha256=digest(expected.body);
  assert.equal(e.transport.dispatches,1);assert.equal(e.transport.httpStatus,200);assert.equal(e.api.httpStatus,200);
  assert.equal(Object.hasOwn(result,'candidate'),false);assert.equal(result.flow,'clarity-v2');assert.equal(result.requestId,call.requestId);
  assert.equal(result.revision,sample.input.context.revision);assert.deepEqual(result.route,AUDIT_ROUTE);
  const choices=e.transport.response?.choices;assert.equal(choices?.length,1);assert.equal(choices[0].finish_reason,'stop');
  // Native bytes only: no fence removal, result repair or extra inference.
  const raw=JSON.parse(choices[0].message.content),checked=prepared.validateAuditOutput(raw,sample.input);
  if(!checked.ok){
    assert.equal(result.status,'fallback');assert.equal(result.reason,checked.reason);assert.equal(result.audit,null);assert.equal(e.progress.completed,false);
    v.runtimeRejectionMatched=true;return {completed:false,reason:checked.reason};
  }
  assert.equal(result.status,'completed');assert.equal(result.policyVersion,policyVersion);assert.equal(result.schemaVersion,schemaVersion);
  assert.deepEqual(Object.keys(result).sort(),['status','audit','policyVersion','schemaVersion','requestId','revision','route','flow'].sort());
  assert.deepEqual(result.audit,checked.candidate);assert.equal(e.progress.completed,true);
  assert.equal(result.audit.semanticTruth,'unverified');assert.equal(result.audit.authority,'observation_only');
  assert.equal(result.audit.noFindingsMeaning,'not_detected_not_certified');
  v.nativeRawCompiledMatched=true;v.privateCompletionMatched=true;
  return {completed:true,audit:checked.candidate};
}

export async function runSemanticAuditEvaluation({runId,origin=AUDIT_ORIGIN,fetchImpl=globalThis.fetch,persist,now=()=>Date.now()}={}){
  if(!validAuditRunId(runId)||origin!==AUDIT_ORIGIN||typeof fetchImpl!=='function'||typeof persist!=='function'||typeof now!=='function')throw new TypeError('invalid_semantic_audit_evaluation');
  const samples=await loadSemanticAuditFixtures(),{prepareSemanticAuditRun,SEMANTIC_AUDIT_POLICY,SEMANTIC_AUDIT_SCHEMA}=await import('../../ai/experiments/clarity-semantic-audit.mjs');
  const report={synthetic:true,label:AUDIT_LABEL,kind:'private_semantic_audit',runId,origin,startedAt:new Date(now()).toISOString(),expectedRoute:AUDIT_ROUTE,
    policyVersion:SEMANTIC_AUDIT_POLICY,schemaVersion:SEMANTIC_AUDIT_SCHEMA,plannedMaximumModelCalls:14,retries:0,clientStepAttempts:0,modelDispatchesObserved:0,
    nativeResponseCount:0,samples:[],complete:false,completedCaseCount:0,authority:'observation_only',semanticTruth:'unverified',semanticReview:'pending_manual_review',
    noFindingsMeaning:'not_detected_not_certified',stateMutation:false,productionIntegrated:false,
    scope:'八个已知及六个策略冻结后读取的合成审校目标，每例最多一次；完成、引用合法或空findings不代表语义通过，不生成替换稿或写入用户记录。',
    usage:'沿用组织者默认服务真实账本及tokens；未核实单价时金额未知，不视为零费用。'};
  const save=async()=>persist(structuredClone(report));await save();report.health={dispatched:true,httpStatus:null};await save();let health;
  try{
    const response=await fetchImpl(`${origin}/health`,{redirect:'error',signal:AbortSignal.timeout(20000)});report.health.httpStatus=response.status;health=await response.json();
    assert.equal(response.status,200);assert.equal(health.label,AUDIT_LABEL);assert.equal(health.runId,runId);assert.equal(Object.keys(health).length,4);
    assert.ok(Number.isSafeInteger(health.startedAt)&&health.startedAt>0);assert.equal(health.expiresAt,health.startedAt+AUDIT_TTL_MS);assert.ok(now()>=health.startedAt&&now()<health.expiresAt);
    report.health.window={runId,startedAt:health.startedAt,expiresAt:health.expiresAt};
  }catch{report.health.failure='health_failed';await save();return report;}
  await save();
  for(const sample of samples){
    const row={caseId:sample.id,group:sample.group,input:structuredClone(sample.input),expectedFindings:sample.expectedFindings,reviewReasons:sample.reviewReasons,
      ...(sample.origin===undefined?{}:{origin:sample.origin}),calls:[],completed:false,semanticReview:'pending_manual_review'};report.samples.push(row);await save();
    if(now()<health.startedAt||now()>=health.expiresAt){row.failure='preview_expired_before_attempt';await save();continue;}
    let prepared;try{prepared=await prepareSemanticAuditRun(sample.input,route.profile);prepareProviderRequest(prepared.requestData,route);}
    catch{row.failure='audit_preparation_or_capacity_rejected';await save();continue;}
    const call={requestId:auditRequestId(runId,sample.id),revision:sample.input.context.revision,httpStatus:null,evidence:null,
      verification:{envelopeMatched:false,exactRequestMatched:false,nativeRawCompiledMatched:false,privateCompletionMatched:false}};
    row.calls.push(call);report.clientStepAttempts++;await save();const started=now();
    try{
      const response=await fetchImpl(`${origin}/evaluate/${sample.id}`,{method:'POST',redirect:'error',headers:{'X-Liubai-Evaluation-Run':runId},signal:AbortSignal.timeout(60000)});
      call.httpStatus=response.status;
      if(response.status!==200){response.body?.cancel().catch(()=>{});call.failure='preview_request_rejected';}
      else{
        call.evidence=await response.json();const e=call.evidence;
        report.modelDispatchesObserved+=e.transport?.dispatches===1?1:0;
        if(e.transport?.httpStatus===200&&e.transport.response?.choices?.some(choice=>typeof choice.message?.content==='string'))report.nativeResponseCount++;
        await save();
        try{const checked=verifyAudit(call,{sample,prepared,runId,policyVersion:SEMANTIC_AUDIT_POLICY,schemaVersion:SEMANTIC_AUDIT_SCHEMA});
          row.completed=checked.completed;if(checked.completed)row.audit=checked.audit;else row.failure=checked.reason;
        }catch{call.failure='audit_evidence_or_output_rejected';row.failure=call.failure;}
      }
    }catch{call.failure='preview_transport_failed';row.failure=call.failure;}
    call.elapsedMs=Math.max(0,now()-started);await save();
  }
  report.complete=report.samples.length===samples.length;report.completedCaseCount=report.samples.filter(sample=>sample.completed).length;
  report.runtimeRejectedOutputCount=report.samples.flatMap(sample=>sample.calls).filter(call=>call.verification.runtimeRejectionMatched===true).length;
  report.completedAt=new Date(now()).toISOString();await save();return report;
}

export function semanticAuditSourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-semantic-audit.mjs','ai/runtime.mjs','ai/ledger.mjs','ai/providers.mjs','ai/provider-transport.mjs',
    'server/api.mjs','server/organizer-config.mjs','server/secrets.mjs','public/clarity-contract.mjs',
    'ai/fixtures/clarity-semantic-audit-known.mjs','ai/fixtures/clarity-semantic-audit-fresh.mjs',
    'scripts/experiments/clarity-semantic-audit-fixtures.mjs','scripts/experiments/clarity-semantic-audit-worker.mjs','scripts/experiments/clarity-semantic-audit-live.mjs'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,
    sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL(`../../${file}`,import.meta.url)))}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--run-id'||!validAuditRunId(args[1]))throw new TypeError('invalid_semantic_audit_cli');
  const output=new URL(`../../work/semantic-audit-live-${args[1]}.json`,import.meta.url);if(existsSync(output))throw Error('existing_semantic_audit_ledger');
  const source=semanticAuditSourceMetadata();if(source.sourceTreeDirty)throw Error('semantic_audit_requires_frozen_source');
  mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  const result=await runSemanticAuditEvaluation({runId:args[1],persist:value=>writeFileSync(output,JSON.stringify({...source,...value},null,2))});
  console.log(JSON.stringify({file:output.href,attempts:result.clientStepAttempts,dispatches:result.modelDispatchesObserved,
    completedObservations:result.completedCaseCount,semanticReview:result.semanticReview}));
  if(!result.complete||result.completedCaseCount!==14)process.exitCode=1;
}
