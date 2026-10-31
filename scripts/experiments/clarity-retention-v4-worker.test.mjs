import test from 'node:test';
import assert from 'node:assert/strict';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {createProviderAdapter} from '../../ai/provider-transport.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {GUIDED_REFLECT_POLICY} from '../../ai/experiments/clarity-guided-reflect.mjs';
import {FAITHFUL_RETAINED_CONCERN_POLICY} from '../../ai/experiments/clarity-retained-concern.mjs';
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';
import {createRetentionV3Worker} from './clarity-retention-v3-worker.mjs';
import {createRetentionV4Worker} from './clarity-retention-v4-worker.mjs';
import {runRetentionV4Evaluation} from './clarity-retention-v4-live.mjs';
import {V2_LABEL,V2_ORIGIN,V2_ROUTE,V2_CASE_IDS,V2_FULL_ID,prepareV2Step,requestIdFor} from './clarity-material-v2-fixtures.mjs';
import {V4_CASE_IDS,V4_BOUNDARY_IDS,isBoundaryCase,fixtureForV4,prepareV4Step,checkV4ContinuationSession} from './clarity-retention-v4-fixtures.mjs';

const RUN='v4_synthetic_run',START=1_790_000_000_000,LABEL='liubai-guided-retention-preview-4';
const SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const env=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:SECRET});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});
const request=(id=V2_CASE_IDS[0],step=1,token)=>new Request(`${V2_ORIGIN}/evaluate/${id}/${step}`,{method:'POST',
  headers:{'X-Liubai-Evaluation-Run':RUN,...(token?{'Content-Type':'application/json'}:{})},...(token?{body:JSON.stringify({continuationToken:token})}:{})});
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);

// Scripted fake model responses exercise protocol/state integration only.
// Their mode choices are not semantic scores or live model evidence.
function modelOutput(body,{wrongBoundaryMode=false,wrongFullMode=false,badFullRefs=false}={}){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_retained_material_user_data')return {reply:'这次说到的具体经历和期待都可以先留下。',title:'合成材料记录',claims:[]};
  assert.equal(data.kind,'liubai_clarity_user_data');
  const probe=/_probe_([1-4])$/u.exec(data.sessionId);
  const id=probe?V4_BOUNDARY_IDS[Number(probe[1])-1]:undefined;
  const modes={ROUTE_CONCRETE_CONCERN:'concern',ROUTE_INTEREST_OPENER:'moment',ROUTE_HAPPY_MOMENT:'moment',ROUTE_CHOICE_TRADEOFF:'choice'};
  const modeId=id?(wrongBoundaryMode?'moment':modes[id]):wrongFullMode?'moment':'concern';
  const finish=id==='ROUTE_HAPPY_MOMENT'&&!wrongBoundaryMode;
  const target=modeId==='concern'?data.turnPlan.target:modeId==='choice'?'tradeoff':'unknown';
  return {modeId,goal:'理清这件小事',reply:'你刚才说到的这部分，可以慢慢说。',
    question:finish?null:{text:modeId==='concern'?data.turnPlan.question:modeId==='choice'?'两种安排各自怎样才方便长期参加？':'你想从哪一方面聊起？',target,evidenceIds:['u1']},
    claims:finish?[{type:'event',text:data.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]:
      !id&&badFullRefs?[{type:'thought',text:'已有安排。',evidenceIds:['invented'],derivation:'inferred',supersedes:[]}]:[],finish,title:'合成材料记录'};
}
function upstream({sent=[],errorStatus=0,...modelOptions}={}){
  return async(endpoint,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(body,modelOptions)),reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
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
    const adapter=createProviderAdapter({route,apiKey:'synthetic-v4-test-key-never-real',fetchImpl:(endpoint,init)=>{
      const guarded={method:init.method,redirect:init.redirect,body:badBytes?init.body+' ':init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('headers_must_remain_opaque');}});
      return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...result,flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}

test('v4 fixture identities isolate all cases while boundary contexts contain only actual first-turn state',()=>{
  assert.equal(V4_CASE_IDS.length,8);assert.equal(V4_BOUNDARY_IDS.length,4);assert.deepEqual(V4_CASE_IDS.slice(0,4),V2_CASE_IDS);
  for(const id of V4_CASE_IDS){
    const p=prepareV4Step(id,RUN,START,1);assert.match(p.session.id,/^retention4_/u);assert.equal(p.ticket.requestId,requestIdFor(RUN,id,1,4));
    if(!isBoundaryCase(id)){assert.deepEqual(p.context,prepareV2Step(id,RUN,START,1,null,4).context);continue;}
    assert.equal(p.context.modeId,'auto');assert.equal(p.context.goal,null);assert.equal(p.context.stage,'reflect');assert.deepEqual(p.context.dialogue,[]);assert.deepEqual(p.context.claims,[]);
    assert.deepEqual(p.context.statements,fixtureForV4(id).statements);assert.equal(p.session.pending.requestId,p.ticket.requestId);
    assert.equal(p.session.id,`retention4_${RUN}_probe_${V4_BOUNDARY_IDS.indexOf(id)+1}`);
    for(const boundaryId of V4_BOUNDARY_IDS)assert.equal(JSON.stringify(p.context).includes(boundaryId),false);
    assert.doesNotMatch(JSON.stringify(p.context),/expectedMode|requirements|forbiddenAdditions/u);
    assert.equal(checkV4ContinuationSession(p.session,id,RUN,2),false);
    assert.throws(()=>prepareV4Step(id,RUN,START,2),/invalid_v4_boundary_step/u);
    assert.throws(()=>prepareV4Step(id,RUN,START,1,p.session),/invalid_v4_boundary_step/u);
  }
});

test('v4 uses eleven fake model calls through real apply state: seven known calls and four independent probes',async()=>{
  const sent=[],worker=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const samples=[];
  for(const id of V4_CASE_IDS){
    let token,client=null;const steps=id===V2_FULL_ID?4:1;
    for(let step=1;step<=steps;step++){
      const prepared=prepareV4Step(id,RUN,START,step,client),response=await worker.fetch(request(id,step,token),env());assert.equal(response.status,200);
      const value=await response.json();samples.push(value);assert.equal(value.label,LABEL);assert.deepEqual(value.context,prepared.context);
      assert.equal(value.api.result.status,'candidate');assert.equal(value.transport.dispatches,1);assert.equal(value.progress.applied,true);
      assert.equal(applyClarityReply(prepared.session,prepared.ticket,value.api.result).ok,true);client=prepared.session;
      if(isBoundaryCase(id)){
        assert.equal(value.kind,'scene_boundary_probe');assert.equal(value.context.stage,'reflect');assert.equal(value.context.modeId,'auto');
        assert.equal(value.api.result.policyVersion,GUIDED_REFLECT_POLICY);assert.equal(value.progress.probeComplete,true);assert.equal(value.progress.mayContinue,false);
        assert.equal(value.continuationToken,null);assert.equal(value.progress.stopReason,null);assert.equal(Object.hasOwn(value.progress,'retentionVisibility'),false);
        assert.equal(client.modeId,value.api.result.candidate.modeId);assert.equal(client.stage,value.api.result.candidate.finish?'reviewing':'exploring');
        assert.doesNotMatch(JSON.stringify(value.transport.request),/expectedMode|requirements|forbiddenAdditions/u);
        for(const boundaryId of V4_BOUNDARY_IDS)assert.equal(JSON.stringify(value.transport.request).includes(boundaryId),false);
        const data=JSON.parse(value.transport.request.messages[1].content);assert.equal(data.modeId,'auto');assert.equal(data.goal,null);assert.deepEqual(data.statements,fixtureForV4(id).statements);
      }else if(step<steps){
        assert.equal(value.api.result.policyVersion,GUIDED_REFLECT_POLICY);assert.equal(value.progress.mayContinue,true);assert.equal(typeof value.continuationToken,'string');token=value.continuationToken;
        assert.equal(Object.hasOwn(value.progress,'retentionVisibility'),false);assert.equal(checkV4ContinuationSession(client,id,RUN,step+1),true);
      }else{
        assert.equal(value.api.result.policyVersion,FAITHFUL_RETAINED_CONCERN_POLICY);assert.deepEqual(value.progress.retentionVisibility,{status:'visible',allVisible:true});
        assert.equal(value.continuationToken,null);assert.equal(client.stage,'reviewing');
      }
    }
  }
  assert.equal(sent.length,11);assert.equal(samples.length,11);assert.equal(samples.filter(s=>s.kind==='scene_boundary_probe').length,4);
  const full=samples.filter(s=>s.caseId===V2_FULL_ID);assert.deepEqual(full.map(s=>s.context.dialogue.length),[0,1,2,3]);
  assert.match(full.at(-1).api.result.candidate.claims[0].text,/怕拒绝以后见面尴尬/u);
  assert.match(full.at(-1).api.result.candidate.claims[0].text,/我没空就一起找其他办法/u);
});

test('a legal but semantically wrong boundary mode remains a candidate for independent semantic review',async()=>{
  const worker=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({wrongBoundaryMode:true})});
  const value=await(await worker.fetch(request('ROUTE_CONCRETE_CONCERN'),env())).json();
  assert.equal(fixtureForV4(value.caseId).expectedMode,'concern');assert.equal(value.api.result.status,'candidate');assert.equal(value.api.result.candidate.modeId,'moment');
  assert.equal(value.progress.applied,true);assert.equal(value.progress.probeComplete,true);assert.equal(value.progress.stopReason,null);assert.equal(value.continuationToken,null);
  assert.equal(value.semanticReview,'pending_manual_review');
});

test('known full-dialogue mode drift or illegal refs stop instead of submitting the next fixed answer',async()=>{
  for(const options of [{wrongFullMode:true},{badFullRefs:true}]){
    const sent=[],worker=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent,...options})});
    const value=await(await worker.fetch(request(V2_FULL_ID),env())).json();
    assert.equal(value.progress.mayContinue,false);assert.equal(value.continuationToken,null);assert.equal(sent.length,1);
    if(options.wrongFullMode){assert.equal(value.api.result.status,'candidate');assert.equal(value.progress.applied,true);assert.equal(value.progress.stopReason,'scene_mismatch');}
    else{assert.equal(value.api.result.status,'fallback');assert.equal(value.api.result.reason,'invalid_claim');assert.equal(value.progress.applied,false);}
    assert.equal((await worker.fetch(request(V2_FULL_ID,2,'forged'),env())).status,400);assert.equal(sent.length,1);
  }
});

test('v4 labels, HKDF/MAC token domains and request IDs cannot cross v2/v3 boundaries',async t=>{
  const derive=crypto.subtle.deriveKey.bind(crypto.subtle),domains=[];
  t.mock.method(crypto.subtle,'deriveKey',(algorithm,...args)=>{domains.push({salt:new TextDecoder().decode(algorithm.salt),info:new TextDecoder().decode(algorithm.info)});return derive(algorithm,...args);});
  const workers=[createMaterialV2Worker,createRetentionV3Worker,createRetentionV4Worker].map(factory=>factory({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream(),experimentVersion:2}));
  const health=await Promise.all(workers.map(async worker=>(await worker.fetch(new Request(`${V2_ORIGIN}/health`),env())).json()));
  assert.deepEqual(health.map(h=>h.label),[V2_LABEL,'liubai-material-retention-preview-3',LABEL]);
  const first=await Promise.all(workers.map(async worker=>(await worker.fetch(request(V2_FULL_ID),env())).json()));
  assert.equal(new Set(first.map(v=>v.requestId)).size,3);assert.equal(new Set(first.map(v=>v.context.sessionId)).size,3);
  for(let a=0;a<workers.length;a++)for(let b=0;b<workers.length;b++)if(a!==b)assert.equal((await workers[a].fetch(request(V2_FULL_ID,2,first[b].continuationToken),env())).status,400);
  assert.ok(domains.some(d=>d.salt==='liubai-guided-retention-v4-preview'&&d.info==='liubai-material-v4-continuation-1'));
  const next=await(await workers[2].fetch(request(V2_FULL_ID,2,first[2].continuationToken),env())).json();assert.equal(next.progress.mayContinue,true);assert.equal(next.progress.applied,true);
  for(const version of [0,1,7,'4',null])assert.throws(()=>createMaterialV2Worker({experimentVersion:version}),/invalid_material_experiment_version/u);
  for(const worker of workers.slice(0,2))assert.equal((await worker.fetch(request(V4_BOUNDARY_IDS[0]),env())).status,404);
});

test('v4 retains preflight, body/route byte binding and boundary no-continuation gates before upstream billing',async()=>{
  let prepared=0,apiCalls=0,upstreamCalls=0;
  const worker=createRetentionV4Worker({now:()=>START,prepareRun:()=>{prepared++;throw Error('must_not_prepare');},fetchImpl:()=>{upstreamCalls++;},
    handleApiImpl:()=>{apiCalls++;return Response.json({...status(),defaultProfile:{...status().defaultProfile,defaultRevision:99}});}});
  assert.equal((await worker.fetch(request(),env())).status,409);assert.equal(apiCalls,1);assert.equal(prepared,0);assert.equal(upstreamCalls,0);
  for(const bad of [request(V4_BOUNDARY_IDS[0],2),new Request(`${V2_ORIGIN}/evaluate/${V4_BOUNDARY_IDS[0]}/1`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},body:JSON.stringify({expectedMode:'concern',apiKey:'BODY_MUST_NOT_LEAK'})}),
    new Request(`${V2_ORIGIN}/evaluate/${V4_BOUNDARY_IDS[0]}/1`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN,Authorization:'KEY_MUST_NOT_LEAK'}})]){
    const r=await worker.fetch(bad,env());assert.ok(r.status>=400);assert.doesNotMatch(await r.text(),/BODY_MUST_NOT_LEAK|KEY_MUST_NOT_LEAK/u);
  }
  assert.equal(apiCalls,1);assert.equal(upstreamCalls,0);
  const sent=[],bytes=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi({badBytes:true}),fetchImpl:upstream({sent})});
  const rejected=await(await bytes.fetch(request(V4_BOUNDARY_IDS[0]),env())).json();assert.equal(rejected.transport.dispatches,0);assert.equal(rejected.api.result.status,'fallback');assert.equal(sent.length,0);
});

test('v4 captures native JSON and bounded usage while credentials, reasoning and provider failures remain opaque',async()=>{
  const worker=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const value=await(await worker.fetch(request(V4_BOUNDARY_IDS[0]),env())).json();
  assert.deepEqual(value.transport.response.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
  assert.doesNotMatch(JSON.stringify(value),/synthetic-v4-test-key-never-real|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK|Authorization/u);
  const error=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({errorStatus:403})});
  const failed=await(await error.fetch(request(V4_BOUNDARY_IDS[0]),env())).json();assert.equal(failed.api.result.status,'fallback');assert.equal(failed.progress.probeComplete,false);assert.equal(failed.transport.response,null);
  assert.doesNotMatch(JSON.stringify(failed),/PROVIDER_ERROR_MUST_NOT_LEAK/u);
});

test('the actual v4 client and Worker factory interoperate through eleven steps without persisting tokens or fixture expectations in model input',async()=>{
  const snapshots=[],urls=[],sent=[],worker=createRetentionV4Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const report=await runRetentionV4Evaluation({runId:RUN,now:()=>START,persist:value=>snapshots.push(value),fetchImpl:(url,options)=>{
    urls.push(url);if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,urls.length-1);
    return worker.fetch(new Request(url,options),env());
  }});
  assert.equal(report.clientStepAttempts,11);assert.equal(report.modelDispatchesObserved,11);assert.equal(report.completedCaseCount,8);assert.equal(sent.length,11);
  assert.equal(report.completedBoundaryProbes,4);assert.equal(report.memorySavedCaseCount,4);
  const full=report.samples.find(sample=>sample.caseId===V2_FULL_ID);assert.equal(full.calls.length,4);
  assert.ok(full.calls.every(call=>call.verification.hostEnvelopeMatched&&call.verification.exactTransportRequestMatched&&call.verification.nativeRawCompiledUnchanged&&call.verification.actualStateApplied));
  assert.equal(full.calls.at(-1).stateVerification.allActiveMaterialVisible,true);
  for(const sample of report.samples.filter(sample=>isBoundaryCase(sample.caseId))){
    assert.equal(sample.calls.length,1);assert.equal(sample.complete,true);
    const call=sample.calls[0];assert.equal(call.context.modeId,'auto');assert.equal(call.context.goal,null);
    assert.doesNotMatch(JSON.stringify(call.context),/expectedMode|requirements|forbiddenAdditions/u);
    assert.doesNotMatch(JSON.stringify(call.evidence.transport.request),/expectedMode|requirements|forbiddenAdditions/u);
    for(const boundaryId of V4_BOUNDARY_IDS)assert.equal(JSON.stringify(call.evidence.transport.request).includes(boundaryId),false);
  }
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|liubai-material-v4-continuation|synthetic-v4-test-key-never-real/u);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});
