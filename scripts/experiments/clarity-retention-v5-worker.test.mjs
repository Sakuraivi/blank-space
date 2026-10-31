import test from 'node:test';
import assert from 'node:assert/strict';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {createProviderAdapter} from '../../ai/provider-transport.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute,isTrustedRoute} from '../../ai/providers.mjs';
import {SOURCE_CHECKED_REFLECT_POLICY,SOURCE_CHECKED_REVIEW_POLICY} from '../../ai/experiments/clarity-source-checked.mjs';
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';
import {createRetentionV3Worker} from './clarity-retention-v3-worker.mjs';
import {createRetentionV4Worker} from './clarity-retention-v4-worker.mjs';
import {createRetentionV5Worker} from './clarity-retention-v5-worker.mjs';
import {runRetentionV5Evaluation} from './clarity-retention-v5-live.mjs';
import {V2_LABEL,V2_ORIGIN,V2_ROUTE,V2_CASE_IDS,V2_FULL_ID,prepareV2Step,requestIdFor} from './clarity-material-v2-fixtures.mjs';
import {V4_BOUNDARY_IDS} from './clarity-retention-v4-fixtures.mjs';
import {V5_CASE_IDS,V5_PROBE_IDS,isV5Probe,fixtureForV5,purposeForV5Case,prepareV5Step,checkV5ContinuationSession} from './clarity-retention-v5-fixtures.mjs';

const RUN='v5_synthetic_run',START=1_790_000_000_000,LABEL='liubai-duration-source-preview-5';
const SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const env=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:SECRET});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});
const request=(id=V2_FULL_ID,step=1,token)=>new Request(`${V2_ORIGIN}/evaluate/${id}/${step}`,{method:'POST',
  headers:{'X-Liubai-Evaluation-Run':RUN,...(token?{'Content-Type':'application/json'}:{})},...(token?{body:JSON.stringify({continuationToken:token})}:{})});
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);

// These scripted responses exercise contracts, not live routing correctness.
function modelOutput(body,{inventFullAt=0,wrongOwner=false,modeBypass=false,knowledgeAmount=false}={}){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_retained_material_user_data')return {reply:'这次说出的经历和期待都可以先留下。',title:'合成材料记录',claims:[]};
  assert.equal(data.kind,'liubai_clarity_user_data');
  const match=/_probe_([1-8])$/u.exec(data.sessionId),id=match?V5_PROBE_IDS[Number(match[1])-1]:null;
  const modes={ROUTE_CONCRETE_CONCERN:'concern',ROUTE_INTEREST_OPENER:'moment',ROUTE_HAPPY_MOMENT:'moment',ROUTE_CHOICE_TRADEOFF:'choice'};
  const modeId=modeBypass?'moment':modes[id]??'concern',finish=id==='ROUTE_HAPPY_MOMENT'&&!modeBypass;
  let reply='你刚才说出的这部分，可以慢慢说。';
  if(!id&&data.statements.length===inventFullAt)reply='那两小时的投入，可以先说清楚。';
  if(wrongOwner&&id==='QTY_SEPARATE_OWNERS')reply='阿岚搬椅子花了四十五分钟。';
  if(modeBypass&&id==='QTY_NO_AMOUNT')reply='那两小时让你觉得很烦。';
  if(knowledgeAmount&&id==='ROUTE_INTEREST_OPENER')reply='可以先从两小时的观鸟体验聊起。';
  return {modeId,goal:'理清这件小事',reply,
    question:finish?null:{text:modeId==='concern'?data.turnPlan.question:modeId==='choice'?'怎样的安排更方便长期参加？':'你想从哪一方面聊起？',
      target:modeId==='concern'?data.turnPlan.target:modeId==='choice'?'tradeoff':'unknown',evidenceIds:[data.statements.at(-1).id]},
    claims:finish?[{type:'event',text:data.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]:[],finish,title:'合成材料记录'};
}
function upstream({sent=[],errorStatus=0,fenced=false,...modelOptions}={}){
  return async(endpoint,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    const raw=JSON.stringify(modelOutput(body,modelOptions)),content=fenced?'```json\n'+raw+'\n```':raw;
    return Response.json({choices:[{finish_reason:'stop',message:{content,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'}});
  };
}
function fakeApi({calls=[],defaultStatus=status(),badBytes=false}={}){
  const seen=new Set();
  return async(request,environment,options)=>{
    const url=new URL(request.url);calls.push(url.pathname);
    if(url.pathname==='/api/ai/status')return Response.json(defaultStatus);
    assert.equal(request.headers.get('origin'),url.origin);
    const payload=await request.json(),context=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
    const prepared=await options.prepareClarityRun(context,route.profile);
    if(seen.has(payload.requestId))return Response.json({status:'fallback',reason:'duplicate_request'},{status:429});seen.add(payload.requestId);
    const adapter=createProviderAdapter({route,apiKey:'synthetic-v5-test-key-never-real',fetchImpl:(endpoint,init)=>{
      const guarded={method:init.method,redirect:init.redirect,body:badBytes?init.body+' ':init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('headers_must_remain_opaque');}});
      return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...result,flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}

test('v5 fixes nine cases and Host purposes while all probe state IDs remain neutral',()=>{
  assert.equal(V5_CASE_IDS.length,9);assert.equal(V5_PROBE_IDS.length,8);assert.equal(V5_CASE_IDS[0],V2_FULL_ID);
  for(const id of V5_CASE_IDS){
    const p=prepareV5Step(id,RUN,START,1);assert.equal(p.ticket.requestId,requestIdFor(RUN,id,1,5));
    assert.equal(purposeForV5Case(id),id==='ROUTE_INTEREST_OPENER'?'knowledge_opener':'personal_reflection');
    if(id===V2_FULL_ID){assert.deepEqual(p.context,prepareV2Step(id,RUN,START,1,null,5).context);continue;}
    assert.equal(p.context.sessionId,`retention5_${RUN}_probe_${V5_PROBE_IDS.indexOf(id)+1}`);assert.equal(p.context.stage,'reflect');
    assert.deepEqual(p.context.dialogue,[]);assert.deepEqual(p.context.claims,[]);assert.equal(p.context.allowNextStep,false);
    assert.equal(p.context.modeId,V4_BOUNDARY_IDS.includes(id)?'auto':'concern');assert.equal(p.context.goal,V4_BOUNDARY_IDS.includes(id)?null:'梳理这次表达');
    assert.deepEqual(p.context.statements,fixtureForV5(id).statements??fixtureForV5(id).context.statements);
    for(const name of V5_PROBE_IDS)assert.equal(JSON.stringify(p.context).includes(name),false);
    assert.doesNotMatch(JSON.stringify(p.context),/requirements|expectedMode|forbiddenAdditions/u);
    assert.equal(checkV5ContinuationSession(p.session,id,RUN,2),false);assert.throws(()=>prepareV5Step(id,RUN,START,2));
  }
  assert.throws(()=>purposeForV5Case('unknown'),/invalid_v5_fixture/u);
});

test('the frozen qualified-source refusal returns auditable zero-model evidence before preparation or billing',async()=>{
  const calls=[],sent=[],worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi({calls}),fetchImpl:upstream({sent})});
  const value=await(await worker.fetch(request('QTY_QUALIFIED_CONDITIONAL'),env())).json();
  assert.equal(value.label,LABEL);assert.equal(value.kind,'source_boundary_probe');assert.equal(value.preparationUnsupported,true);
  assert.equal(value.hostRequest,null);assert.deepEqual(value.transport,{dispatches:0,request:null,response:null,httpStatus:null,elapsedMs:null});
  assert.deepEqual(calls,['/api/ai/status']);assert.equal(sent.length,0);assert.equal(value.api.httpStatus,null);
  assert.deepEqual(value.api.result,{status:'fallback',reason:'unsupported_duration_source_scope'});
  assert.equal(value.durationChecks.preparation.status,'unsupported');assert.ok(value.durationChecks.preparation.sourceForms.length>0);
  assert.equal(value.durationChecks.raw,null);assert.equal(value.durationChecks.compiled,null);
  assert.equal(value.progress.applied,false);assert.equal(value.progress.probeComplete,false);assert.equal(value.progress.mayContinue,false);assert.equal(value.continuationToken,null);
});

test('twelve fixed attempts produce eleven model dispatches, preserving actual full state and independent probe boundaries',async t=>{
  const sent=[],worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})}),evidence=[];
  for(const id of V5_CASE_IDS){
    let token,client=null;
    for(let step=1;step<=(id===V2_FULL_ID?4:1);step++){
      const prepared=prepareV5Step(id,RUN,START,step,client),value=await(await worker.fetch(request(id,step,token),env())).json();evidence.push(value);
      assert.equal(value.label,LABEL);assert.deepEqual(value.context,prepared.context);
      if(value.preparationUnsupported){assert.equal(id,'QTY_QUALIFIED_CONDITIONAL');continue;}
      assert.equal(value.api.result.status,'candidate',`${id}/${step}: ${value.api.result.reason}`);assert.equal(value.progress.applied,true);assert.equal(value.transport.dispatches,1);
      assert.equal(value.hostRequest.binding.purpose,purposeForV5Case(id));
      assert.equal(value.api.result.policyVersion,step===4?SOURCE_CHECKED_REVIEW_POLICY:SOURCE_CHECKED_REFLECT_POLICY);
      assert.equal(value.durationChecks.raw.ok,true);assert.equal(value.durationChecks.compiled.ok,true);
      assert.equal(applyClarityReply(prepared.session,prepared.ticket,value.api.result).ok,true);client=prepared.session;
      assert.doesNotMatch(JSON.stringify(value.transport.request),/expectedMode|requirements|forbiddenAdditions/u);
      for(const name of V5_PROBE_IDS)assert.equal(JSON.stringify(value.transport.request).includes(name),false);
      if(isV5Probe(id)){
        assert.equal(value.kind,'source_boundary_probe');assert.equal(value.progress.probeComplete,true);assert.equal(value.continuationToken,null);assert.equal(value.progress.mayContinue,false);
        assert.equal(Object.hasOwn(value.progress,'retentionVisibility'),false);
      }else if(step<4){assert.equal(value.progress.mayContinue,true);assert.equal(checkV5ContinuationSession(client,id,RUN,step+1),true);token=value.continuationToken;}
      else{assert.deepEqual(value.progress.retentionVisibility,{status:'visible',allVisible:true});assert.equal(value.continuationToken,null);}
    }
  }
  assert.equal(evidence.length,12);assert.equal(sent.length,11);assert.equal(evidence.filter(v=>v.preparationUnsupported).length,1);
  const last=evidence.filter(v=>v.caseId===V2_FULL_ID).at(-1);assert.match(last.api.result.candidate.claims[0].text,/怕拒绝以后见面尴尬/u);
  // Measure the complete captured provider body, using the original signed
  // route's byte budget. Never copy/mutate that route to make the check pass.
  assert.equal(isTrustedRoute(route),true);assert.equal(route.maxRequestBytes,12000);
  const bodyBytes=evidence.filter(value=>value.transport.request).map(value=>({caseId:value.caseId,step:value.step,
    bytes:new TextEncoder().encode(JSON.stringify(value.transport.request)).byteLength}));
  assert.equal(bodyBytes.length,11);assert.ok(bodyBytes.every(value=>value.bytes<=route.maxRequestBytes));
  const fullBodyBytes=bodyBytes.filter(value=>value.caseId===V2_FULL_ID);assert.deepEqual(fullBodyBytes.map(value=>value.step),[1,2,3,4]);
  t.diagnostic(JSON.stringify({maxBodyBytes:Math.max(...bodyBytes.map(value=>value.bytes)),routeMaxRequestBytes:route.maxRequestBytes,fullBodyBytes,bodyBytes}));
});

test('the original invented two hours fails raw checking and the full chain stops without appending later answers',async()=>{
  const sent=[],worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent,inventFullAt:2})});
  const first=await(await worker.fetch(request(),env())).json();assert.equal(first.progress.mayContinue,true);
  const failed=await(await worker.fetch(request(V2_FULL_ID,2,first.continuationToken),env())).json();
  assert.equal(failed.api.result.status,'fallback');assert.equal(failed.api.result.reason,'duration_source_mismatch');assert.equal(failed.progress.applied,false);
  assert.equal(failed.context.statements.length,2);assert.equal(failed.context.dialogue.length,1);assert.equal(failed.durationChecks.raw.status,'rejected');
  assert.equal(failed.durationChecks.raw.reason,'new_duration_surface_form');assert.equal(failed.durationChecks.compiled,null);
  assert.match(failed.transport.response.choices[0].message.content,/两小时/u);assert.equal(failed.continuationToken,null);assert.equal(failed.progress.mayContinue,false);
  assert.equal((await worker.fetch(request(V2_FULL_ID,3,'forged'),env())).status,400);assert.equal(sent.length,2);
});

test('a same-form wrong owner remains a candidate with explicitly unverified attribution',async()=>{
  const worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({wrongOwner:true})});
  const value=await(await worker.fetch(request('QTY_SEPARATE_OWNERS'),env())).json();assert.equal(value.api.result.status,'candidate');
  assert.match(value.api.result.candidate.reply,/阿岚搬椅子花了四十五分钟/u);assert.equal(value.durationChecks.raw.ok,true);assert.equal(value.durationChecks.compiled.ok,true);
  for(const checked of [value.durationChecks.raw,value.durationChecks.compiled]){
    assert.equal(checked.coverage,'duration_surface_forms_only');assert.equal(checked.semanticTruth,'unverified');assert.equal(checked.attribution,'unverified');
  }
  assert.equal(value.semanticReview,'pending_manual_review');assert.equal(value.progress.probeComplete,true);
});

test('only the Host-fixed interest probe is exempt; model moment cannot bypass personal checks',async()=>{
  const worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({modeBypass:true,knowledgeAmount:true})});
  const personal=await(await worker.fetch(request('QTY_NO_AMOUNT'),env())).json();assert.equal(personal.hostRequest.binding.purpose,'personal_reflection');
  assert.equal(personal.api.result.status,'fallback');assert.equal(personal.durationChecks.raw.status,'rejected');assert.equal(personal.progress.probeComplete,false);
  const knowledge=await(await worker.fetch(request('ROUTE_INTEREST_OPENER'),env())).json();assert.equal(knowledge.api.result.status,'candidate');
  assert.equal(knowledge.hostRequest.binding.purpose,'knowledge_opener');assert.equal(knowledge.durationChecks.preparation.coverage,'not_applicable_host_knowledge_scope');
  assert.equal(knowledge.durationChecks.raw.status,'not_applicable');assert.equal(knowledge.durationChecks.compiled.status,'not_applicable');
});

test('native response fences are preserved and never become a repaired raw duration check',async()=>{
  const worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({fenced:true})});
  const value=await(await worker.fetch(request('QTY_REPEATED_DURATION'),env())).json();
  assert.equal(value.api.result.status,'fallback');assert.equal(value.durationChecks.raw,null);assert.equal(value.durationChecks.compiled,null);
  assert.match(value.transport.response.choices[0].message.content,/^```json/u);assert.equal(value.progress.applied,false);
});

test('v5 version, label, request IDs and authenticated continuation domains remain isolated from v2/v3/v4',async t=>{
  const derive=crypto.subtle.deriveKey.bind(crypto.subtle),domains=[];
  t.mock.method(crypto.subtle,'deriveKey',(algorithm,...args)=>{domains.push({salt:new TextDecoder().decode(algorithm.salt),info:new TextDecoder().decode(algorithm.info)});return derive(algorithm,...args);});
  const workers=[createMaterialV2Worker,createRetentionV3Worker,createRetentionV4Worker,createRetentionV5Worker].map(factory=>factory({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream(),experimentVersion:2}));
  const health=await Promise.all(workers.map(async worker=>(await worker.fetch(new Request(`${V2_ORIGIN}/health`),env())).json()));
  assert.deepEqual(health.map(value=>value.label),[V2_LABEL,'liubai-material-retention-preview-3','liubai-guided-retention-preview-4',LABEL]);
  const first=await Promise.all(workers.map(async worker=>(await worker.fetch(request(),env())).json()));assert.equal(new Set(first.map(v=>v.requestId)).size,4);
  for(let i=0;i<3;i++){
    assert.equal((await workers[3].fetch(request(V2_FULL_ID,2,first[i].continuationToken),env())).status,400);
    assert.equal((await workers[i].fetch(request(V2_FULL_ID,2,first[3].continuationToken),env())).status,400);
  }
  assert.ok(domains.some(d=>d.salt==='liubai-duration-source-v5-preview'&&d.info==='liubai-material-v5-continuation-1'));
  const next=await(await workers[3].fetch(request(V2_FULL_ID,2,first[3].continuationToken),env())).json();assert.equal(next.progress.mayContinue,true);
  assert.equal((await workers[3].fetch(request(V2_CASE_IDS[0]),env())).status,404);
  for(const worker of workers.slice(0,3))assert.equal((await worker.fetch(request('QTY_NO_AMOUNT'),env())).status,404);
  for(const version of [0,1,7,'5',null])assert.throws(()=>createMaterialV2Worker({experimentVersion:version}),/invalid_material_experiment_version/u);
});

test('v5 retains route/body gates and opaque credentials while failed provider output remains unmodified evidence',async()=>{
  const sent=[],calls=[],worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi({calls,defaultStatus:{...status(),defaultProfile:{...status().defaultProfile,defaultRevision:99}}}),fetchImpl:upstream({sent})});
  assert.equal((await worker.fetch(request('QTY_NO_AMOUNT'),env())).status,409);assert.deepEqual(calls,['/api/ai/status']);assert.equal(sent.length,0);
  const bytes=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi({badBytes:true}),fetchImpl:upstream({sent})});
  const mismatch=await(await bytes.fetch(request('QTY_NO_AMOUNT'),env())).json();assert.equal(mismatch.transport.dispatches,0);assert.equal(sent.length,0);assert.equal(mismatch.api.result.status,'fallback');
  const healthy=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const value=await(await healthy.fetch(request('QTY_NO_AMOUNT'),env())).json();assert.deepEqual(value.transport.response.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
  assert.doesNotMatch(JSON.stringify(value),/synthetic-v5-test-key-never-real|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK|Authorization/u);
  const error=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({errorStatus:403})});
  const failed=await(await error.fetch(request('QTY_NO_AMOUNT'),env())).json();assert.equal(failed.transport.response,null);assert.equal(failed.api.result.status,'fallback');
  assert.equal(failed.durationChecks.raw,null);assert.equal(failed.durationChecks.compiled,null);assert.doesNotMatch(JSON.stringify(failed),/PROVIDER_ERROR_MUST_NOT_LEAK/u);
  for(const bad of [request('QTY_NO_AMOUNT',2),new Request(`${V2_ORIGIN}/evaluate/QTY_NO_AMOUNT/1`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},body:JSON.stringify({purpose:'knowledge_opener',apiKey:'BODY_MUST_NOT_LEAK'})})]){
    const response=await healthy.fetch(bad,env());assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/BODY_MUST_NOT_LEAK/u);
  }
});

test('the actual v5 client and Worker factory agree on twelve attempts, eleven model calls, one saved review and one unsupported source',async()=>{
  const snapshots=[],urls=[],sent=[],worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const report=await runRetentionV5Evaluation({runId:RUN,now:()=>START,persist:value=>snapshots.push(value),fetchImpl:(url,options)=>{
    urls.push(url);if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,urls.length-1);
    return worker.fetch(new Request(url,options),env());
  }});
  assert.equal(report.complete,true);assert.equal(report.clientStepAttempts,12);assert.equal(report.modelDispatchesObserved,11);assert.equal(sent.length,11);
  assert.equal(report.completedCaseCount,8);assert.equal(report.completedBoundaryProbes,7);assert.equal(report.memorySavedCaseCount,1);assert.equal(report.sourceUnsupportedCaseCount,1);
  assert.equal(report.runtimeRejectedOutputCount,0);assert.equal(report.durationRejectedOutputCount,0);
  const full=report.samples.find(sample=>sample.caseId===V2_FULL_ID);assert.equal(full.calls.length,4);assert.equal(full.complete,true);
  assert.ok(full.calls.every(call=>call.verification.hostEnvelopeMatched&&call.verification.exactTransportRequestMatched&&call.verification.nativeRawCompiledUnchanged&&call.verification.actualStateApplied));
  assert.equal(full.calls.at(-1).stateVerification.allActiveMaterialVisible,true);
  const unsupported=report.samples.find(sample=>sample.caseId==='QTY_QUALIFIED_CONDITIONAL');assert.equal(unsupported.complete,false);
  assert.equal(unsupported.calls[0].stateVerification.sourceUnsupported,true);assert.equal(unsupported.calls[0].stateVerification.modelDispatched,false);
  for(const sample of report.samples.filter(sample=>isV5Probe(sample.caseId)))for(const call of sample.calls){
    for(const id of V5_PROBE_IDS){assert.equal(JSON.stringify(call.context).includes(id),false);assert.equal(JSON.stringify(call.evidence.transport.request).includes(id),false);}
    assert.doesNotMatch(JSON.stringify(call.context),/requirements|expectedMode|forbiddenAdditions/u);
  }
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|liubai-material-v5-continuation|synthetic-v5-test-key-never-real/u);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});
