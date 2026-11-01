// Offline, counterfactual replay only. Never a production migration or retry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareClarityV3Compatibility} from '../../ai/experiments/clarity-v3-compatibility.mjs';
import {buildClarityModelRequest,validateClarityResponse} from '../../ai/clarity-v3.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {deriveConversationPolicy} from '../../public/clarity-v3-intent.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION} from '../../public/clarity-v3-contract.mjs';
import {beginClarityRequest,applyClarityReply,addExpression,pauseClaritySession,editClarityBlock,saveClarityRecord,
  readRecordEntries,recordText,exportWorkingText} from '../../public/clarity-v3-state.mjs';

export const COMPATIBILITY_CAPTURE_SHA='a18934bc7727e80f05a71334aeae7867af76a0fef84d75a6344f99b6bfbd8e9b';
export const COMPATIBILITY_EVALUATION_SHA='fa6bd66ac17c9e5e53a8ab5a312b922e39b6247bde29be2cb8be122e374b08b5';
const CAPTURE_COMMIT='29e4983f6e25eb7f24733656635e54b4c1dcaf82';
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const envelope=(ticket,candidate)=>({status:'candidate',flow:CLARITY_FLOW,schemaVersion:CLARITY_SCHEMA_VERSION,
  requestId:ticket.requestId,revision:ticket.revision,candidate:structuredClone(candidate)});
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
const errorOf=operation=>{try{operation();return null;}catch(error){return error.message;}};
function saveProbe(session){
  const storage=memory(),saved=saveClarityRecord(session,storage),read=readRecordEntries(storage);
  return {ok:saved.ok,reason:saved.reason??null,record:saved.record??null,
    roundTripExact:saved.ok&&read.length===1&&equal(saved.record,read[0].record),externalStorageWrites:0,
    humanConfirmationObserved:false,confirmationAssumption:'programmatic_test_confirmation'};
}
async function inspectArm(call,semanticGrade){
  const p=await prepareClarityV3Compatibility(call),candidate=p.mapping.candidate;
  const normal=p.createSession(),normalTicket=beginClarityRequest(normal);
  const normalValidation=validateClarityResponse(candidate,normalTicket.context);
  const nativeToV3=validateClarityResponse(p.raw,normalTicket.context);

  // Deliberately test the unsafe shortcut without applying or saving it. A
  // legacy automatic stage is not observed evidence of a new Host operation.
  const oldStageValidation=validateClarityResponse(candidate,structuredClone(p.sourceContext));
  const button=p.createSession(),buttonTicket=beginClarityRequest(button,{review:true});
  const buttonValidation=validateClarityResponse(candidate,buttonTicket.context);

  const session=p.createSession({explicitReview:true}),ticket=beginClarityRequest(session,{review:true});
  const policy=deriveConversationPolicy(ticket.context),route=getPersonalRoute(call.evidence.route.providerId,call.evidence.route.modelId);
  const prepared=buildClarityModelRequest(ticket.context,route.profile),body=prepareProviderRequest(prepared,route);
  const checked=validateClarityResponse(candidate,ticket.context);
  assert.equal(checked.ok,true,'counterfactual_v3_validation_failed');
  assert.deepEqual(checked.candidate,candidate,'validation_transformed_the_captured_words');
  const applied=applyClarityReply(session,ticket,envelope(ticket,checked.candidate));assert.equal(applied.ok,true);
  const saved=saveProbe(session);assert.ok(saved.ok&&saved.roundTripExact);
  const insights=p.raw.claims.filter(c=>c.type==='insight').map(c=>c.text);
  const insightBlock=saved.record.review.blocks.find(b=>b.id==='insight');
  const event=p.mapping.candidate.claims.find(c=>c.type==='event');
  const preservation={replyUnchanged:candidate.reply===p.raw.reply,titleUnchanged:candidate.title===p.raw.title,
    analysisTextsUnchanged:equal(candidate.claims.filter(c=>c.type!=='event').map(c=>c.text),p.raw.claims.map(c=>c.text)),
    insightParagraphsExact:insightBlock?.text===insights.join('\n\n'),
    allSourceTextRetained:saved.record.review.blocks.find(b=>b.id==='context')?.text===event.text,
    originalQuestionsAndAnswersExact:equal(ticket.context.dialogue,p.sourceContext.dialogue),
    originalSourcesExact:equal(ticket.context.statements.slice(0,p.sourceContext.statements.length),p.sourceContext.statements),
    simulatedControlExcludedFromRecord:!recordText(saved.record).includes('请AI整理成一份。')};
  assert.ok(Object.values(preservation).every(Boolean),'counterfactual_text_or_source_changed');
  return {arm:call.arm,requestedModel:route.modelId,nativeContentSha256:p.nativeContentSha256,
    original:{requestId:call.requestId,apiStatus:call.evidence.api.result.status,reason:call.evidence.api.result.reason??null,oldReplay:p.oldValidation},
    raw:p.raw,mapping:p.mapping,normalContinuation:{hostOperation:'ordinary_continue',ticketKind:normalTicket.kind,
      validation:normalValidation,applied:false,saved:false},
    nativeThreeFieldsToV3:{validation:nativeToV3},
    legacyStageCarryover:{validation:oldStageValidation,policy:deriveConversationPolicy(p.sourceContext),
      authorityEvidence:'legacy_review_snapshot_only',newUserReviewObserved:false,applied:false,saved:false,
      eligibleForRealOutcome:false,meaning:'Technical stage acceptance cannot authenticate a historical new-user intent.'},
    explicitButtonAssumption:{validation:buttonValidation,ticketKind:buttonTicket.kind,newUserReviewObserved:false,
      counterfactualHostOperation:true,sourceCount:buttonTicket.context.statements.length,applied:false,saved:false},
    explicitRequestAssumption:{newUserReviewObserved:false,counterfactual:true,
      addedControl:ticket.context.statements.at(-1),context:ticket.context,policy,
      request:{body:JSON.parse(body.body),byteLength:body.byteLength,maximumBytes:route.maxRequestBytes,maxOutputTokens:route.maxOutputTokens,
        dispatched:false},validation:checked,applied:applied.ok,review:structuredClone(session.review),saved,preservation},
    semanticStatus:{priorGrade:semanticGrade,inheritedWithoutRegrading:true,formatAcceptanceIsNotSemanticRepair:true,
      nativeV3ModelSuccess:false,eligibleForProduction:false},modelCalls:0};
}
function controls(p){
  const candidate=p.mapping.candidate,results=[];
  const test=(name,run)=>results.push({name,...run()});
  test('explicit_analysis_ban_survives_later_review',()=>{
    const s=p.createSession();addExpression(s,'不用分析。',{kind:'request'});addExpression(s,'请AI整理成一份。',{kind:'request'});
    const t=beginClarityRequest(s,{review:true}),r=validateClarityResponse(candidate,t.context);
    return {ok:!r.ok&&r.reason==='interpretation_not_allowed',reason:r.reason};
  });
  for(const [name,text]of [['pause','暂停一下。'],['end','结束，不保存。']])test(name+'_wins_review',()=>{
    const s=p.createSession();addExpression(s,text,{kind:'request'});const reason=errorOf(()=>beginClarityRequest(s,{review:true}));
    return {ok:reason==='local_control_required',reason};
  });
  test('old_response_identity_cannot_apply_as_v3',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true});
    const result=applyClarityReply(s,t,{...envelope(t,candidate),flow:'clarity-v2',schemaVersion:'liubai-clarity-1'});
    return {ok:!result.ok&&result.reason==='invalid_response'&&s.review===null,reason:result.reason};
  });
  test('late_response_after_pause_never_applies',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true}),before=exportWorkingText(s);pauseClaritySession(s);
    const result=applyClarityReply(s,t,envelope(t,candidate));
    return {ok:!result.ok&&result.reason==='inactive'&&s.review===null&&exportWorkingText(s)===before,reason:result.reason};
  });
  test('source_revision_invalidates_the_previous_ticket',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true});addExpression(s,'这是独立的合成续说控制。');
    const result=applyClarityReply(s,t,envelope(t,candidate));
    return {ok:!result.ok&&result.reason==='inactive'&&s.review===null,reason:result.reason};
  });
  test('fourth_claim_is_rejected_without_slicing',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true}),bad=structuredClone(candidate);
    bad.claims.push(structuredClone(bad.claims.at(-1)));const r=validateClarityResponse(bad,t.context);
    return {ok:!r.ok&&bad.claims.length===4,reason:r.reason,claimCount:bad.claims.length};
  });
  test('total_text_capacity_is_not_raised',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true}),bad=structuredClone(candidate);
    bad.claims[1].text='合成容量控制'.repeat(40);bad.claims[2].text='合成容量控制'.repeat(40);
    const r=validateClarityResponse(bad,t.context);return {ok:!r.ok&&r.reason==='response_too_large',reason:r.reason,
      textCount:bad.claims.reduce((n,c)=>n+c.text.length,0)};
  });
  test('trusted_request_byte_capacity_is_not_raised',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true}),route=getPersonalRoute('bailian','deepseek-v4-pro-0813');
    const request=structuredClone(buildClarityModelRequest(t.context,route.profile));request.instruction.text+='\n'+'容量控制'.repeat(3000);
    const reason=errorOf(()=>prepareProviderRequest(request,route));return {ok:reason==='input_too_large',reason,maximumBytes:route.maxRequestBytes};
  });
  test('confirmed_manual_text_survives_another_mapped_candidate',()=>{
    const s=p.createSession({explicitReview:true}),t=beginClarityRequest(s,{review:true});assert.equal(applyClarityReply(s,t,envelope(t,candidate)).ok,true);
    const manual='这是本人手改的合成保护控制。';editClarityBlock(s,'insight',manual);assert.equal(saveProbe(s).ok,true);
    addExpression(s,'请AI整理成一份。',{kind:'request'});const next=beginClarityRequest(s,{review:true});
    assert.equal(applyClarityReply(s,next,envelope(next,candidate)).ok,true);const save=saveProbe(s);
    return {ok:s.review.blocks.find(b=>b.id==='insight')?.text===manual&&s.stale&&!save.ok&&save.reason==='review_stale',
      manualPreserved:s.review.blocks.find(b=>b.id==='insight')?.text===manual,stale:s.stale,saveReason:save.reason};
  });
  assert.ok(results.every(r=>r.ok),'compatibility_negative_control_failed');return results;
}

export async function runV3CompatibilityProbe(evaluation){
  assert.equal(digest(JSON.stringify(evaluation)),COMPATIBILITY_EVALUATION_SHA,'capture_document_changed');
  assert.equal(evaluation?.liveReportSha256,COMPATIBILITY_CAPTURE_SHA,'capture_digest_changed');
  assert.equal(evaluation.live?.sourceCommit,CAPTURE_COMMIT,'capture_source_changed');
  assert.equal(digest(JSON.stringify(evaluation.live,null,2)),COMPATIBILITY_CAPTURE_SHA,'capture_content_changed');
  assert.equal(evaluation.modelScreeningGate,'not_met');
  const capture=evaluation.live.cases.find(c=>c.caseId==='RELATION_K_FULL');assert.ok(capture);
  const semantic=evaluation.semanticReview.cases.find(c=>c.caseId===capture.caseId),arms=[];
  for(const arm of ['reference','max','flash']){
    assert.equal(capture.arms[arm].calls.length,1);arms.push(await inspectArm(capture.arms[arm].calls[0],semantic.arms[arm].grade));
  }
  const reference=await prepareClarityV3Compatibility(capture.arms.reference.calls[0]),negativeControls=controls(reference);
  return {version:'clarity-v3-compatibility-probe-1',counterfactual:true,modelCalls:0,providerRequests:0,sharedLedgerWrites:0,externalStorageWrites:0,
    capture:{sourceCommit:CAPTURE_COMMIT,evaluationSerializedSha256:COMPATIBILITY_EVALUATION_SHA,liveSha256:COMPATIBILITY_CAPTURE_SHA,caseId:capture.caseId,knownRegression:true},
    unchangedPriorAssessment:{modelScreeningGate:evaluation.modelScreeningGate,originalCandidateCount:evaluation.counts.candidate,
      originalRejectedCount:evaluation.counts.runtimeRejected,eligibleCandidates:[]},
    arms,negativeControls,complete:true,nativeV3Verified:false,productionIntegrated:false,
    conclusion:'The captured text can be represented under explicit new Host assumptions; legacy stage alone does not establish user intent. This does not repair prior native failures or certify a new model response.',
    limitations:['Single known FULL context, three already observed model outputs; no fresh or human evidence.',
      'Host additions, source mapping, event construction and authorization are explicitly counterfactual.',
      'Mechanical compatibility does not remove any previously observed semantic omissions.']};
}
export function compatibilityProbeSourceMetadata(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const files=['ai/experiments/clarity-v3-compatibility.mjs','ai/experiments/clarity-v3-compatibility.test.mjs',
    'scripts/experiments/clarity-v3-compatibility-probe.mjs','scripts/experiments/clarity-v3-compatibility-probe.test.mjs',
    'ai/clarity-v3.mjs','public/clarity-v3-contract.mjs','public/clarity-v3-intent.mjs','public/clarity-v3-state.mjs','public/clarity-state.mjs',
    'ai/experiments/clarity-example-review.mjs','ai/experiments/clarity-review-examples.mjs','ai/experiments/clarity-faithful-dialogue.mjs',
    'ai/experiments/clarity-source-checked.mjs','ai/experiments/clarity-duration-source.mjs','ai/experiments/clarity-retained-concern.mjs',
    'ai/experiments/clarity-retention-ledger.mjs','ai/experiments/clarity-materials.mjs','ai/provider-transport.mjs','ai/providers.mjs',
    'ai/evaluations/2026-11-01-model-comparison-v1.json','openspec/changes/clarity-tarot-reflection/v3-compatibility-probe.md','package.json'];
  return {sourceCommit:git(['rev-parse','HEAD']),sourceTreeDirty:git(['status','--porcelain']).length>0,
    sourceDigests:files.map(file=>({file,sha256:digest(readFileSync(new URL('../../'+file,import.meta.url)))}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==2)throw Error('invalid_compatibility_probe_cli');
  const source=compatibilityProbeSourceMetadata();if(source.sourceTreeDirty)throw Error('compatibility_requires_frozen_source');
  const output=new URL('../../work/v3-compatibility-probe.json',import.meta.url);if(existsSync(output))throw Error('existing_compatibility_probe');
  const evaluation=JSON.parse(readFileSync(new URL('../../ai/evaluations/2026-11-01-model-comparison-v1.json',import.meta.url),'utf8'));
  const report=await runV3CompatibilityProbe(evaluation);mkdirSync(dirname(fileURLToPath(output)),{recursive:true});
  writeFileSync(output,JSON.stringify({...source,...report},null,2));
  console.log(JSON.stringify({file:fileURLToPath(output),complete:report.complete,modelCalls:0,
    arms:report.arms.map(a=>({arm:a.arm,bytes:a.explicitRequestAssumption.request.byteLength,applied:a.explicitRequestAssumption.applied})),controls:report.negativeControls.length}));
}
