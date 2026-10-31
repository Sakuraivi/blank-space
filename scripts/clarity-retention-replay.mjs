// Explicit offline migration of four fixed synthetic historical cases. A
// rewritten candidate is not a new model response or a content-quality pass.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildClarityModelRequest,validateClarityResponse,CLARITY_POLICY_VERSION} from '../ai/clarity.mjs';
import {prepareConcernMaterialSetRun} from '../ai/experiments/clarity-material-set.mjs';
import {buildRetentionLedger} from '../ai/experiments/clarity-retention-ledger.mjs';
import {prepareRetainedConcernRun,RETAINED_CONCERN_POLICY,RETAINED_CONCERN_SCHEMA} from '../ai/experiments/clarity-retained-concern.mjs';
import {getPersonalRoute} from '../ai/providers.mjs';
import {prepareProviderRequest} from '../ai/provider-transport.mjs';
import {CLARITY_SCHEMA_VERSION} from '../public/clarity-contract.mjs';
import {applyClarityReply,isCurrentClarity,saveClarityRecord,readRecordEntries,RECORD_STORE} from '../public/clarity-state.mjs';
import {prepareV2Step,V2_ROUTE} from './experiments/clarity-material-v2-fixtures.mjs';

const SOURCE=new URL('../ai/evaluations/2026-11-01-material-set-v2.json',import.meta.url);
const OUTPUT=new URL('../ai/evaluations/2026-11-01-retention-ledger.json',import.meta.url);
const CASES=Object.freeze(['V2_GROUP_FEEDBACK','V2_FREQUENCY_EXCEPTION','V2_CORRECTED_FEELING','V2_FULL_DIALOGUE']);
const SOURCE_COMMIT='1c5fbba',SOURCE_ARTIFACT_COMMIT='006edcd';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
function sourceMetadata(){
  const options={cwd:repositoryRoot,encoding:'utf8',windowsHide:true,maxBuffer:256*1024,stdio:['ignore','pipe','pipe']};
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],options).trim();assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
  const status=execFileSync('git',['--no-optional-locks','status','--porcelain','--untracked-files=normal'],options);
  return {sourceCommit,sourceTreeDirty:status.trim().length>0,
    sourceMetadataMeaning:'HEAD为执行时只读Git元数据，具体执行源码由sourceDigests绑定；dirty时不能仅凭HEAD声称源码已提交。'};
}
const visible=review=>({title:review.title,blocks:review.blocks.map(({id,type,group,label,text})=>({id,type,group,label,text}))});
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const sourceFiles=Object.freeze([
  'ai/experiments/clarity-retained-concern.mjs','ai/experiments/clarity-retention-ledger.mjs',
  'ai/experiments/clarity-materials.mjs','ai/experiments/clarity-material-set.mjs','ai/clarity-grounding.mjs',
  'ai/clarity.mjs','ai/clarity-turn.mjs','ai/runtime.mjs','ai/providers.mjs','ai/provider-transport.mjs',
  'public/clarity-state.mjs','public/clarity-contract.mjs','scripts/experiments/clarity-material-v2-fixtures.mjs',
  'ai/fixtures/clarity-material-v2-samples.mjs','scripts/clarity-retention-replay.mjs',
]);

function sourceReport(){
  const bytes=readFileSync(SOURCE),value=JSON.parse(bytes.toString('utf8'));
  assert.equal(value.method,'frozen_v2_policy_new_fixtures_stepwise_live_and_offline_replay');
  assert.equal(value.sourceCommit,SOURCE_COMMIT);assert.equal(value.policyFrozenCommit,'6d6675a');
  assert.equal(value.modelDispatches,7);assert.equal(value.productionIntegrated,false);
  assert.deepEqual(value.live.expectedRoute,V2_ROUTE);assert.equal(value.live.runId,'m20261101v2a');
  assert.deepEqual(value.live.samples.map(sample=>sample.caseId),CASES);
  assert.equal(value.live.samples.reduce((n,sample)=>n+sample.calls.length,0),7);
  return {value,digest:hash(bytes),byteLength:bytes.byteLength};
}

function parsedAcceptedOutput(evidence){
  const choices=evidence.transport.response?.choices;
  assert.equal(choices?.length,1);assert.equal(choices[0].finish_reason,'stop');
  // No Markdown stripping, shape auto-detection or alternate parser.
  return JSON.parse(choices[0].message.content);
}

async function verifyHistoricalCall(call,state,final,route,caseId,runId){
  const evidence=call.evidence;
  assert.equal(evidence.synthetic,true);assert.equal(evidence.runId,runId);assert.equal(evidence.caseId,caseId);
  assert.equal(evidence.step,call.step);assert.equal(call.requestId,state.ticket.requestId);
  assert.equal(evidence.requestId,state.ticket.requestId);assert.equal(evidence.revision,state.ticket.revision);
  assert.deepEqual(evidence.context,state.context);assert.deepEqual(evidence.route,V2_ROUTE);
  assert.equal(evidence.transport.dispatches,1);assert.equal(evidence.transport.httpStatus,200);
  const prepared=final?await prepareConcernMaterialSetRun(state.context,route.profile):null;
  const request=prepared?.requestData??buildClarityModelRequest(state.context,route.profile);
  assert.equal(evidence.hostRequest.policyVersion,request.policyVersion);
  assert.equal(evidence.hostRequest.schemaVersion,request.schemaVersion);
  assert.deepEqual(evidence.hostRequest.binding,prepared?.binding??null);
  const transport=prepareProviderRequest(request,route);
  assert.equal(transport.body,JSON.stringify(evidence.transport.request));
  const origin={sourceRequestId:evidence.requestId,sourcePolicyVersion:evidence.hostRequest.policyVersion,
    sourceSchemaVersion:evidence.hostRequest.schemaVersion,sourceBinding:evidence.hostRequest.binding,
    context:state.context,hostEnvelopeVerified:true,exactTransportRequestMatched:true,
    transportRequestByteLength:new TextEncoder().encode(transport.body).length,
    transportRequestSha256:hash(transport.body),transportRequest:evidence.transport.request};
  if(caseId==='V2_GROUP_FEEDBACK'){
    assert.equal(evidence.api.result.status,'fallback');assert.equal(evidence.api.result.reason,'provider_response_failed');
    assert.throws(()=>parsedAcceptedOutput(evidence),SyntaxError);
    assert.equal(state.session.review,null);
    return {origin,raw:null,preservedFailure:{reason:evidence.api.result.reason,
      originalContent:evidence.transport.response.choices[0].message.content,
      strictJSON:false,markdownWasNotStripped:true,originalOutcomeUnchanged:true}};
  }
  assert.equal(evidence.api.httpStatus,200);assert.equal(evidence.api.result.status,'candidate');
  assert.equal(evidence.api.result.requestId,state.ticket.requestId);assert.equal(evidence.api.result.revision,state.ticket.revision);
  assert.equal(evidence.api.result.schemaVersion,CLARITY_SCHEMA_VERSION);
  const raw=parsedAcceptedOutput(evidence);
  const checked=prepared?prepared.validateSelection(raw,state.context):validateClarityResponse(raw,state.context);
  assert.equal(checked.ok,true);assert.deepEqual(checked.candidate,evidence.api.result.candidate);
  assert.equal(evidence.api.result.policyVersion,final?request.policyVersion:CLARITY_POLICY_VERSION);
  return {origin,raw,preservedFailure:null};
}

function mapAnalysisOnly(raw){
  assert.ok(exact(raw,['reply','title','claims']));assert.ok(Array.isArray(raw.claims));
  const notes=[];
  for(const claim of raw.claims){
    if(claim.type==='event'){
      assert.ok(exact(claim,['type','anchorIds','supersedes']));
      continue;
    }
    assert.ok(['insight','unknown'].includes(claim.type));
    assert.ok(exact(claim,['type','text','anchorIds','supersedes']));
    // Explicit v2 -> v3 migration. The historical output remains untouched;
    // v3 assigns the complete event and model-batch replacements in the Host.
    notes.push({type:claim.type,text:claim.text,anchorIds:structuredClone(claim.anchorIds)});
  }
  return {reply:raw.reply,title:raw.title,claims:notes};
}

function saveAndReadBack(session,prepared){
  const before=visible(session.review),store=new Map([['liubai.records.v1','[]']]);
  const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
  assert.deepEqual(prepared.checkVisibleMaterial(session),{status:'visible',allVisible:true});
  const saved=saveClarityRecord(session,storage);assert.equal(saved.ok,true);
  assert.deepEqual(prepared.checkVisibleMaterial(session),{status:'visible',allVisible:true});
  const serialized=JSON.stringify([...store]),reopened=new Map(JSON.parse(serialized));
  const entries=readRecordEntries({getItem:key=>reopened.get(key)??null});
  assert.equal(entries.length,1);assert.equal(entries[0].record.id,session.id);
  assert.deepEqual(visible(entries[0].record.review),before);
  assert.equal(entries[0].record.review.blocks.find(block=>block.id==='context'&&block.group==='main')?.text,prepared.ledger.retainedText);
  assert.equal(reopened.get('liubai.records.v1'),'[]');
  assert.equal(session.stage,'kept');
  assert.equal(serialized.includes('sourceDigest'),false);assert.equal(serialized.includes('retiredBy'),false);
  return {ok:true,beforeSaveVisible:true,afterSaveVisible:true,afterReadBackVisible:true,
    recordStore:RECORD_STORE,visibleReview:before,savedRecord:entries[0].record,
    serializedReadBackMatched:true,legacyStoreUnchanged:true,ledgerInternalsNotSaved:true,
    scope:'内存保存与JSON序列化读回；未验证真实浏览器、localStorage、刷新或PNG。'};
}

// Fixed sources only. Export/import is read-only and never writes OUTPUT.
export async function evaluateRetentionReplay(){
  const startedAt=new Date().toISOString(),sourceState=sourceMetadata(),source=sourceReport(),baseline=source.value;
  const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
  assert.ok(route);const samples=[],historicalSteps=[];
  for(const sample of baseline.live.samples){
    assert.equal(sample.calls.length,sample.caseId==='V2_FULL_DIALOGUE'?4:1);
    let priorSession=null,priorLedger;
    for(const call of sample.calls){
      const final=sample.caseId!=='V2_FULL_DIALOGUE'||call.step===4;
      const state=prepareV2Step(sample.caseId,baseline.live.runId,baseline.live.health.window.startedAt,call.step,priorSession);
      const history=await verifyHistoricalCall(call,state,final,route,sample.caseId,baseline.live.runId);
      const ledger=await buildRetentionLedger(state.context,{previous:priorLedger});
      assert.equal(ledger.reportReady,true);
      const historyStep={caseId:sample.caseId,step:call.step,...history.origin,
        sourceOutcome:call.evidence.api.result.status,ledger,questionAssociationsAreProvenanceOnly:true};
      historicalSteps.push(historyStep);
      if(!final){
        assert.equal(applyClarityReply(state.session,state.ticket,call.evidence.api.result).ok,true);
        assert.equal(state.session.stage,'exploring');priorSession=state.session;priorLedger=ledger;
        continue;
      }
      const prepared=await prepareRetainedConcernRun(state.context,route.profile,{previousLedger:priorLedger});
      assert.deepEqual(prepared.ledger,ledger);
      const preparedTransport=prepareProviderRequest(prepared.requestData,route);
      const base={caseId:sample.caseId,isFreshModelOutput:false,modelCalls:0,networkRequests:0,
        origin:history.origin,sourceOutcome:call.evidence.api.result.status,ledger,
        reportCapacity:{retainedUTF16:ledger.retainedLength,maxEventUTF16:240,maxTotalClaimsUTF16:480,
          analysisRoomUTF16:480-ledger.retainedLength,requestBytes:new TextEncoder().encode(preparedTransport.body).length,
          maxRequestBytes:route.maxRequestBytes,inputFits:true},
        sourceContentQuality:baseline.contentReleaseGate,semanticCoverage:'unverified',isContentSuccess:false};
      if(history.preservedFailure){
        samples.push({...base,status:'preserved_historical_format_failure',mappedCandidateProduced:false,
          originalFailure:history.preservedFailure,compile:null,runtime:null,state:null,save:null,
          meaning:'仅证明原话ledger及容量可构建；旧代码围栏失败未剥离、未补发，未虚构v3模型或保存成功。'});
        continue;
      }
      const mapped=mapAnalysisOnly(history.raw),checked=prepared.validateSelection(mapped,state.context);
      assert.equal(checked.ok,true);assert.equal(checked.candidate.claims[0].text,ledger.retainedText);
      assert.equal(checked.candidate.claims[0].text.length<=240,true);
      const total=checked.candidate.claims.reduce((n,claim)=>n+claim.text.length,0);assert.ok(total<=480);
      assert.deepEqual(checked.candidate.claims.slice(1).map(c=>({type:c.type,text:c.text})),mapped.claims.map(c=>({type:c.type,text:c.text})));
      let localAdapterInvocations=0;
      const result=await prepared.run({adapter:{profile:route.profile,async generate(request){
        localAdapterInvocations++;assert.equal(request,prepared.requestData);return {status:'completed',output:structuredClone(mapped)};
      }},isCurrent:()=>isCurrentClarity(state.session,state.ticket),timeoutMs:1000});
      assert.equal(result.status,'candidate');assert.equal(result.policyVersion,RETAINED_CONCERN_POLICY);
      assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);assert.deepEqual(result.candidate,checked.candidate);
      assert.equal(localAdapterInvocations,1);
      const envelope={...result,flow:'clarity-v2',requestId:state.ticket.requestId,revision:state.ticket.revision,route:V2_ROUTE};
      assert.equal(applyClarityReply(state.session,state.ticket,envelope).ok,true);
      assert.equal(state.session.stage,'reviewing');
      const visibleCheck=prepared.checkVisibleMaterial(state.session);assert.deepEqual(visibleCheck,{status:'visible',allVisible:true});
      const save=saveAndReadBack(state.session,prepared);
      const retired=ledger.units.filter(unit=>unit.status==='retired'),projected=ledger.units.filter(unit=>unit.status==='active'&&unit.projection);
      for(const unit of ledger.units){
        const original=state.context.statements.find(statement=>statement.id===unit.sourceId);assert.ok(original);
        assert.equal(original.text.slice(unit.start,unit.end),unit.quote);
      }
      const correctionEvidence={scope:ledger.correctionScope,retiredHistory:retired,activeProjections:projected,
        sourceSliceIdentityChecked:true,retiredQuotesPreservedInLedger:true,
        retiredQuotesShownInSavedContext:retired.filter(unit=>save.visibleReview.blocks.find(b=>b.id==='context').text.includes(unit.quote)).map(unit=>unit.key)};
      if(sample.caseId==='V2_CORRECTED_FEELING'){
        assert.equal(retired.length,1);assert.equal(retired[0].quote,'我很失落。');
        assert.equal(projected.length,1);assert.equal(projected[0].text,'生气。');
        assert.equal(save.visibleReview.blocks.find(b=>b.id==='context').text.includes('生气。'),true);
        assert.equal(correctionEvidence.retiredQuotesShownInSavedContext.length,0);
      }
      samples.push({...base,status:'offline_migration_applied_and_saved',mappedCandidateProduced:true,
        mapping:{kind:'explicit_v2_analysis_to_v3_only',oldEventDiscarded:true,oldAnalysisSupersedesRemoved:true,
          unchangedAnalysisText:true,mappedRaw:mapped,note:'只迁移历史合法JSON的分析字段；不是一次新的模型生成，也没有向API重发历史requestId。'},
        compile:{ok:true,candidate:checked.candidate,selectionTrace:checked.selectionTrace,totalClaimsUTF16:total},
        runtime:{status:result.status,policyVersion:result.policyVersion,schemaVersion:result.schemaVersion,
          localAdapterInvocations,modelCalls:0,networkRequests:0},
        state:{applied:true,visibleCheck,sourceRevision:state.context.revision,complete:state.session.complete},save,correctionEvidence,
        quality:{status:'unverified_for_v3',knownUnfixedIssues:sample.caseId==='V2_FREQUENCY_EXCEPTION'
          ?['原reply中“另外两次没有出错，其中还各多走了十分钟”的指代歧义原样保留，Host原文保留不能修复它。']
          :['历史模型分析沿用，新增材料可见性不能自动证明理解、认识增量或温馨阅读体验通过。']}});
    }
  }
  assert.deepEqual(samples.map(sample=>sample.caseId),CASES);
  assert.equal(samples.filter(sample=>sample.save?.ok).length,3);
  assert.equal(historicalSteps.length,7);
  assert.equal(hash(readFileSync(SOURCE)),source.digest);
  return {method:'offline_frozen_history_retention_vertical_slice',synthetic:true,isFreshModelOutput:false,
    ...sourceState,startedAt,evaluatedAt:new Date().toISOString(),modelCalls:0,paidModelCalls:0,networkRequests:0,
    productionIntegrated:false,semanticCoverage:'unverified',contentQualityStatus:'not_evaluated',contentReleaseGate:'not_met',
    source:{path:'ai/evaluations/2026-11-01-material-set-v2.json',sha256:source.digest,byteLength:source.byteLength,
      originalSourceCommit:SOURCE_COMMIT,artifactCommit:SOURCE_ARTIFACT_COMMIT,policyFrozenCommit:'6d6675a',
      originalArtifactUnchanged:true,readScope:'仅固定四个合成case和七个原请求；不读取Key、token、数据库或任意外部输入。'},
    sourceDigests:sourceFiles.map(file=>({file,sha256:hash(readFileSync(new URL(`../${file}`,import.meta.url)))})),
    protocol:{policyVersion:RETAINED_CONCERN_POLICY,schemaVersion:RETAINED_CONCERN_SCHEMA,
      publicSchemaVersion:CLARITY_SCHEMA_VERSION,modelOwnsEvent:false,modelOwnsSupersedes:false,
      quoteMeaning:'证明本人曾这样表达，不是外部事实认证或心理分类。'},
    counts:{historicalCases:4,historicalRequestsVerified:7,offlineMappedCases:3,preservedFailedCases:1,memorySavedCases:3},
    mechanicalGate:{passed:true,meaning:'仅三例显式离线迁移及真实状态/保存可见性通过；不等于新模型或产品内容通过。'},
    historicalSteps,samples,
    limits:['没有执行新模型调用、API请求、真实账本写入、部署或生产切换。',
      'GROUP仍为原格式失败，不能靠去围栏、伪造v3回复或只看ledger长度当成功。',
      'v3候选是在离线适配器中重放旧分析，旧requestId只用于内存历史关联，未向API重发。',
      '完整保留原话不代表旧reply歧义、推断质量或拆解深度已修复；未自动重打语义分。',
      '保存验证仅内存和JSON读回，不是浏览器刷新、localStorage、PNG或首次用户研究。',
      '复杂修订、混合旧感受与事实或超容量仍由新实验明确拒绝；现有state编辑/确认/锁继续是权威。']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==2)throw new TypeError('invalid_retention_replay_cli');
  const report=await evaluateRetentionReplay();
  mkdirSync(dirname(fileURLToPath(OUTPUT)),{recursive:true});
  writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({file:OUTPUT.pathname,modelCalls:report.modelCalls,networkRequests:report.networkRequests,
    mappedCases:report.counts.offlineMappedCases,memorySavedCases:report.counts.memorySavedCases,
    preservedFailedCases:report.counts.preservedFailedCases,semanticCoverage:report.semanticCoverage}));
}
