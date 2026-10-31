import test from 'node:test';
import assert from 'node:assert/strict';
import {buildClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {createProviderAdapter} from '../../ai/provider-transport.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {RETAINED_CONCERN_POLICY,RETAINED_CONCERN_SCHEMA} from '../../ai/experiments/clarity-retained-concern.mjs';
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';
import {createRetentionV3Worker} from './clarity-retention-v3-worker.mjs';
import {runRetentionV3Evaluation} from './clarity-retention-v3-live.mjs';
import {V2_LABEL,V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,V2_FULL_ID,prepareV2Step,requestIdFor,seedV2Session,checkContinuationSession} from './clarity-material-v2-fixtures.mjs';

const RUN='v3_synthetic_run',START=1_790_000_000_000,LABEL='liubai-material-retention-preview-3';
const fakeSecret='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const env=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:fakeSecret});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});
const request=(id=V2_CASE_IDS[0],step=1,token)=>new Request(`${V2_ORIGIN}/evaluate/${id}/${step}`,{method:'POST',
  headers:{'X-Liubai-Evaluation-Run':RUN,...(token?{'Content-Type':'application/json'}:{})},...(token?{body:JSON.stringify({continuationToken:token})}:{})});
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);

function modelOutput(body){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_retained_material_user_data')return {reply:'这次谈到的经历和期待都可以先留下。',title:'合成材料记录',claims:[]};
  assert.equal(data.kind,'liubai_clarity_user_data');
  return {modeId:'concern',goal:'理清这件小事',reply:'这次已经谈到的具体部分先留着。',question:{text:data.turnPlan.question,target:data.turnPlan.target,evidenceIds:[data.statements.at(-1).id]},
    claims:[],finish:false,title:'合成材料记录'};
}
function upstream({sent=[],errorStatus=0}={}){
  return async(endpoint,options)=>{
    sent.push(JSON.parse(options.body));
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(JSON.parse(options.body))),reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_EXTRA_MUST_NOT_LEAK'}});
  };
}
function fakeApi({calls=[],defaultStatus=status()}={}){
  const seen=new Set();
  return async(request,environment,options)=>{
    const url=new URL(request.url);calls.push(url.pathname);
    if(url.pathname==='/api/ai/status')return Response.json(defaultStatus);
    assert.equal(request.headers.get('origin'),url.origin);
    const payload=await request.json(),context=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
    const prepared=await options.prepareClarityRun(context,route.profile);
    if(seen.has(payload.requestId))return Response.json({status:'fallback',reason:'duplicate_request'},{status:429});seen.add(payload.requestId);
    const adapter=createProviderAdapter({route,apiKey:'synthetic-v3-test-key-not-real',fetchImpl:(endpoint,init)=>{
      const guarded={method:init.method,redirect:init.redirect,body:init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('headers_must_remain_opaque');}});
      return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...result,flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}

test('experiment versions are factory-only, with distinct labels and request/session identities',async()=>{
  for(const version of [0,1,6,'3',null])assert.throws(()=>createMaterialV2Worker({experimentVersion:version}),/invalid_material_experiment_version/u);
  const two=createMaterialV2Worker({now:()=>START}),three=createRetentionV3Worker({now:()=>START,experimentVersion:2});
  const r2=await(await two.fetch(new Request(`${V2_ORIGIN}/health`),env())).json();
  const r3=await(await three.fetch(new Request(`${V2_ORIGIN}/health`),{...env(),LIUBAI_MATERIAL_EXPERIMENT_VERSION:2})).json();
  assert.equal(r2.label,V2_LABEL);assert.equal(r3.label,LABEL);assert.equal(Object.keys(r3).length,4);
  const old=prepareV2Step(V2_FULL_ID,RUN,START,1),fresh=prepareV2Step(V2_FULL_ID,RUN,START,1,null,3);
  assert.match(old.session.id,/^material2_/u);assert.match(fresh.session.id,/^retention3_/u);
  assert.notEqual(old.ticket.requestId,fresh.ticket.requestId);assert.equal(fresh.ticket.requestId,requestIdFor(RUN,V2_FULL_ID,1,3));
  assert.throws(()=>seedV2Session(V2_FULL_ID,RUN,START,9),/invalid_material_experiment_version/u);
  assert.throws(()=>checkContinuationSession({},V2_FULL_ID,RUN,2,9),/invalid_material_experiment_version/u);
});

test('native v3 JSON without an event claim produces the complete fixed literal material',async()=>{
  const sent=[],worker=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const result=await(await worker.fetch(request(),env())).json();
  assert.equal(result.label,LABEL);assert.equal(result.api.result.status,'candidate');
  assert.equal(result.api.result.policyVersion,RETAINED_CONCERN_POLICY);assert.equal(result.api.result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.equal(result.hostRequest.schemaVersion,RETAINED_CONCERN_SCHEMA);assert.equal(result.transport.dispatches,1);
  assert.deepEqual(JSON.parse(result.transport.response.choices[0].message.content).claims,[]);
  assert.equal(result.api.result.candidate.claims.length,1);assert.equal(result.api.result.candidate.claims[0].type,'event');
  assert.match(result.api.result.candidate.claims[0].text,/两个晚上/u);
  assert.match(result.api.result.candidate.claims[0].text,/标签是不是写得太复杂/u);
  assert.equal(result.progress.applied,true);assert.deepEqual(result.progress.retentionVisibility,{status:'visible',allVisible:true});
  assert.equal(result.requestId,requestIdFor(RUN,V2_CASE_IDS[0],1,3));assert.equal(sent.length,1);
});

test('the four-step v3 chain uses actual prior state and keeps its complete literal final report',async()=>{
  const sent=[],worker=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  let token,client=null,last;
  for(let step=1;step<=4;step++){
    const prepared=prepareV2Step(V2_FULL_ID,RUN,START,step,client,3),response=await worker.fetch(request(V2_FULL_ID,step,token),env());
    assert.equal(response.status,200);last=await response.json();
    assert.deepEqual(last.context,prepared.context);assert.equal(last.requestId,prepared.ticket.requestId);assert.equal(last.context.dialogue.length,step-1);
    assert.equal(last.api.result.status,'candidate');assert.equal(last.api.result.policyVersion,step===4?RETAINED_CONCERN_POLICY:'clarity-warm-19');
    assert.equal(applyClarityReply(prepared.session,prepared.ticket,last.api.result).ok,true);client=prepared.session;
    if(step<4){assert.equal(last.progress.mayContinue,true);assert.equal(typeof last.continuationToken,'string');token=last.continuationToken;}
    else{assert.equal(last.continuationToken,null);assert.equal(client.stage,'reviewing');}
  }
  assert.equal(sent.length,4);assert.equal(client.review.blocks[0].text.length,228);
  assert.match(client.review.blocks[0].text,/怕拒绝以后见面尴尬/u);assert.match(client.review.blocks[0].text,/我没空就一起找其他办法/u);
  assert.deepEqual(last.progress.retentionVisibility,{status:'visible',allVisible:true});
});

test('v2 and v3 continuation MACs, payload versions and fixed identities cannot cross domains',async t=>{
  const derive=crypto.subtle.deriveKey.bind(crypto.subtle),domains=[];
  t.mock.method(crypto.subtle,'deriveKey',(algorithm,...args)=>{domains.push({salt:new TextDecoder().decode(algorithm.salt),info:new TextDecoder().decode(algorithm.info)});return derive(algorithm,...args);});
  const calls2=[],calls3=[],two=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({calls:calls2}),fetchImpl:upstream()}),
    three=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi({calls:calls3}),fetchImpl:upstream()});
  const first2=await(await two.fetch(request(V2_FULL_ID),env())).json(),first3=await(await three.fetch(request(V2_FULL_ID),env())).json();
  assert.equal(first2.progress.mayContinue,true);assert.equal(first3.progress.mayContinue,true);
  const count2=calls2.length,count3=calls3.length;
  assert.equal((await three.fetch(request(V2_FULL_ID,2,first2.continuationToken),env())).status,400);
  assert.equal((await two.fetch(request(V2_FULL_ID,2,first3.continuationToken),env())).status,400);
  assert.equal(calls2.length,count2);assert.equal(calls3.length,count3);
  assert.ok(domains.some(d=>d.salt==='liubai-material-v2-preview'&&d.info==='liubai-material-v2-continuation-1'));
  assert.ok(domains.some(d=>d.salt==='liubai-material-retention-v3-preview'&&d.info==='liubai-material-v3-continuation-1'));
  const accepted=await(await three.fetch(request(V2_FULL_ID,2,first3.continuationToken),env())).json();
  assert.equal(accepted.progress.applied,true);assert.match(accepted.context.sessionId,/^retention3_/u);
});

test('v3 retains the existing preflight, run scope and arbitrary-input rejection gates',async()=>{
  let prepareCalls=0,apiCalls=0,upstreamCalls=0;
  const worker=createRetentionV3Worker({now:()=>START,prepareRun:()=>{prepareCalls++;throw Error('must_not_prepare');},fetchImpl:()=>{upstreamCalls++;},handleApiImpl:request=>{
    apiCalls++;assert.equal(new URL(request.url).pathname,'/api/ai/status');return Response.json({...status(),defaultProfile:{...status().defaultProfile,defaultRevision:99}});
  }});
  assert.equal((await worker.fetch(request(),env())).status,409);assert.equal(apiCalls,1);assert.equal(prepareCalls,0);assert.equal(upstreamCalls,0);
  for(const bad of [new Request(`${V2_ORIGIN}/evaluate/${V2_CASE_IDS[0]}/1`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},body:JSON.stringify({experimentVersion:2})}),
    new Request(`${V2_ORIGIN}/evaluate/${V2_CASE_IDS[0]}/1`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN,Authorization:'KEY_MUST_NOT_LEAK'}})]){
    const result=await worker.fetch(bad,env());assert.equal(result.status,400);assert.doesNotMatch(await result.text(),/KEY_MUST_NOT_LEAK/u);
  }
  assert.equal(apiCalls,1);assert.equal((await worker.fetch(request(),{...env(),LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START-V2_TTL_MS)})).status,410);
});

test('v3 capture keeps credentials opaque and excludes reasoning, provider error prose and arbitrary usage',async()=>{
  const worker=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const result=await(await worker.fetch(request(),env())).json();
  assert.deepEqual(result.transport.response.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
  assert.doesNotMatch(JSON.stringify(result),/synthetic-v3-test-key-not-real|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_EXTRA_MUST_NOT_LEAK|Authorization/u);
  const failure=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({errorStatus:403})});
  const failed=await(await failure.fetch(request(),env())).json();assert.equal(failed.api.result.status,'fallback');assert.equal(failed.transport.response,null);
  assert.doesNotMatch(JSON.stringify(failed),/PROVIDER_ERROR_MUST_NOT_LEAK/u);
});

test('the actual v3 client and Worker factory interoperate through all seven fake API steps without persisting tokens',async()=>{
  const snapshots=[],urls=[],sent=[],worker=createRetentionV3Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:value=>snapshots.push(value),fetchImpl:(url,options)=>{
    urls.push(url);if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,urls.length-1);
    return worker.fetch(new Request(url,options),env());
  }});
  assert.equal(report.clientStepAttempts,7);assert.equal(report.modelDispatchesObserved,7);assert.equal(report.completedCaseCount,4);assert.equal(sent.length,7);
  const full=report.samples.find(sample=>sample.caseId===V2_FULL_ID);
  assert.equal(full.calls.length,4);assert.deepEqual(full.calls.map(call=>call.context.dialogue.length),[0,1,2,3]);
  assert.ok(full.calls.every(call=>call.verification.hostEnvelopeMatched&&call.verification.exactTransportRequestMatched&&call.verification.nativeRawCompiledUnchanged&&call.verification.actualStateApplied));
  assert.equal(full.calls.at(-1).stateVerification.allActiveMaterialVisible,true);
  assert.match(full.calls.at(-1).stateVerification.visibleReview.blocks[0].text,/怕拒绝以后见面尴尬/u);
  assert.match(full.calls.at(-1).stateVerification.visibleReview.blocks[0].text,/我没空就一起找其他办法/u);
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|liubai-material-v3-continuation|synthetic-v3-test-key-not-real/u);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});
