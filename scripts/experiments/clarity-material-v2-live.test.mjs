import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {createProviderAdapter,MAX_RESPONSE_BYTES} from '../../ai/provider-transport.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {V2_LABEL,V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,V2_FULL_ID,prepareV2Step,checkContinuationSession} from './clarity-material-v2-fixtures.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {createMaterialV2Worker} from './clarity-material-v2-worker.mjs';
import {runMaterialV2Evaluation} from './clarity-material-v2-live.mjs';
const RUN='v2_synthetic_run',START=1_790_000_000_000;
const fakeSecret='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const env=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:fakeSecret});
const health=()=>({label:V2_LABEL,runId:RUN,startedAt:START,expiresAt:START+V2_TTL_MS});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});
const req=(id=V2_CASE_IDS[0],step=1,options={})=>new Request(`${V2_ORIGIN}/evaluate/${id}/${step}`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},...options});
const route=getPersonalRoute('bailian','deepseek-v4-pro-0813');
function modelOutput(body,{earlyFinish=false,badTarget=false}={}){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_material_set_user_data'){
    const anchors=data.materialIndex.anchors.filter(a=>a.selectable);
    return {reply:'这次已经说清的部分，可以先留下。',title:'合成测试记录',claims:[{type:'event',anchorIds:[anchors.at(-1).id],supersedes:[]}]};
  }
  return {modeId:'concern',goal:'理清这件小事',reply:'已经说出的这部分先留着。',question:earlyFinish?null:{text:data.turnPlan.question,target:badTarget?'unknown':data.turnPlan.target,evidenceIds:[data.statements.at(-1).id]},
    claims:earlyFinish?[{type:'event',text:data.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]:[],finish:earlyFinish,title:'合成测试记录'};
}
function fakeApi({calls=[],transportRequests=[],defaultStatus=status(),badBody=false,transformResult=value=>value}={}){
  const seen=new Set();
  return async(request,environment,options)=>{
    const url=new URL(request.url);calls.push(url.pathname);
    if(url.pathname==='/api/ai/status')return Response.json(defaultStatus);
    assert.equal(request.headers.get('origin'),url.origin);
    const payload=await request.json(),context=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
    const prepared=await options.prepareClarityRun(context,route.profile);
    if(seen.has(payload.requestId))return Response.json({status:'fallback',reason:'duplicate_request'},{status:429});seen.add(payload.requestId);
    const adapter=createProviderAdapter({route,apiKey:'synthetic-test-key-never-real',fetchImpl:(endpoint,init)=>{
      transportRequests.push(JSON.parse(init.body));
      const guarded={method:init.method,redirect:init.redirect,body:badBody?init.body+' ':init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('headers_must_be_opaque');}});
      return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...transformResult(result,payload),flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}
function upstream({sent=[],errorStatus=0,earlyFinish=false}={}){
  return async(endpoint,options)=>{
    sent.push(JSON.parse(options.body));
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput(JSON.parse(options.body),{earlyFinish})),reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,arbitrary:'USAGE_MUST_NOT_LEAK'}});
  };
}
const continuation=(id,step,token)=>req(id,step,{headers:{'X-Liubai-Evaluation-Run':RUN,'Content-Type':'application/json'},body:JSON.stringify({continuationToken:token})});

test('fixtures have deterministic review identities and full first turn contains no invented dialogue',()=>{
  for(const id of V2_CASE_IDS){const one=prepareV2Step(id,RUN,START,1),two=prepareV2Step(id,RUN,START,1);assert.deepEqual(one.context,two.context);assert.equal(one.ticket.requestId,two.ticket.requestId);assert.deepEqual(one.context.dialogue,[]);}
  assert.equal(prepareV2Step(V2_FULL_ID,RUN,START,1).context.stage,'reflect');
});
test('worker rejects arbitrary inputs, run mismatch, expiration and missing signing configuration before API/upstream',async()=>{
  let calls=0;const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:()=>{calls++;},fetchImpl:()=>{calls++;}});
  const bad=[
    req(V2_CASE_IDS[0],1,{body:JSON.stringify({personalApiKey:'BODY_SECRET'})}),req(V2_CASE_IDS[0],1,{headers:{Cookie:'COOKIE_SECRET'}}),
    req(V2_CASE_IDS[0],1,{body:'null'}),req(V2_CASE_IDS[0],1,{body:'[]'}),req(V2_CASE_IDS[0],1,{body:'""'}),
    req(V2_CASE_IDS[0],1,{headers:{Authorization:'KEY_SECRET'}}),req(V2_CASE_IDS[0],1,{headers:{'X-Liubai-Evaluation-Run':'old_run'}}),
    req('unknown'),req(V2_CASE_IDS[0],2),continuation(V2_FULL_ID,2,'forged'),
  ];
  for(const request of bad){const result=await worker.fetch(request,env());assert.ok(result.status>=400);assert.doesNotMatch(await result.text(),/BODY_SECRET|COOKIE_SECRET|KEY_SECRET/);}
  assert.equal((await worker.fetch(req(),{...env(),LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START-V2_TTL_MS)})).status,410);
  assert.equal((await worker.fetch(req(V2_FULL_ID),{...env(),LIUBAI_SECRET_KEY:undefined})).status,400);
  assert.equal(calls,0);
});
test('strict empty proxy streams pass; hanging or non-final empty streams reject in bounded time',async()=>{
  const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const empty=req(undefined,1,{body:new ReadableStream({start(c){c.close();}}),duplex:'half'});
  assert.equal((await(await worker.fetch(empty,env())).json()).transport.dispatches,1);
  let calls=0;const blocked=createMaterialV2Worker({now:()=>START,handleApiImpl:()=>{calls++;}});
  for(const stream of [new ReadableStream({cancel(){return new Promise(()=>{});}}),new ReadableStream({start(c){c.enqueue(new Uint8Array());c.close();}})]){
    const before=Date.now();assert.equal((await blocked.fetch(req(undefined,1,{body:stream,duplex:'half'}),env())).status,400);assert.ok(Date.now()-before<1000);
  }assert.equal(calls,0);
});
test('default route mismatch and exact request-byte mismatch never dispatch upstream',async()=>{
  for(const wrong of [true,false]){const sent=[];const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({defaultStatus:wrong?{...status(),defaultProfile:{...status().defaultProfile,defaultRevision:99}}:status(),badBody:!wrong}),fetchImpl:upstream({sent})});
    const r=await worker.fetch(req(),env());assert.equal(sent.length,0);if(wrong)assert.equal(r.status,409);else assert.equal((await r.json()).transport.dispatches,0);}
});
test('signed continuation retains real state; tampering, wrong step, wrong case and changed secret fail before API',async()=>{
  const calls=[],sent=[],worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({calls}),fetchImpl:upstream({sent})});
  const first=await(await worker.fetch(req(V2_FULL_ID),env())).json();assert.equal(first.progress.mayContinue,true);assert.equal(typeof first.continuationToken,'string');
  const before=calls.length,token=first.continuationToken;
  const tampered=token.slice(0,-2)+(token.at(-2)==='A'?'B':'A')+token.at(-1);
  for(const r of [continuation(V2_FULL_ID,2,tampered),continuation(V2_FULL_ID,3,token),continuation(V2_CASE_IDS[0],1,token)])assert.equal((await worker.fetch(r,env())).status,400);
  assert.equal(calls.length,before);
  assert.equal((await worker.fetch(continuation(V2_FULL_ID,2,token),{...env(),LIUBAI_SECRET_KEY:'B'.repeat(44)})).status,400);assert.equal(calls.length,before);
  const next=await(await worker.fetch(continuation(V2_FULL_ID,2,token),env())).json();assert.equal(next.progress.mayContinue,true);assert.equal(next.context.dialogue.length,1);
  assert.equal(next.context.dialogue[0].question,first.api.result.candidate.question.text);assert.equal(next.context.statements.length,2);
  const again=await(await worker.fetch(continuation(V2_FULL_ID,2,token),env())).json();assert.equal(again.api.httpStatus,429);assert.equal(again.transport.dispatches,0);assert.equal(sent.length,2);
});
test('worker stops early completion and does not issue a continuation for unused fixed answers',async()=>{
  const sent=[],worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({transformResult:(value,payload)=>({...value,candidate:{...value.candidate,finish:true,question:null,
    claims:[{type:'event',text:payload.session.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]}})}),fetchImpl:upstream({sent})});
  const first=await(await worker.fetch(req(V2_FULL_ID),env())).json();
  assert.equal(first.context.statements.length,1);assert.equal(sent.length,1);
  assert.equal(first.continuationToken,null);assert.equal(first.progress.stopReason,'finished_before_fixture_end');
});
test('a mismatched actual question stops before the next fixed answer is appended',async()=>{
  const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({transformResult:value=>({...value,candidate:{...value.candidate,
    question:{...value.candidate.question,target:'unknown'}}})}),fetchImpl:upstream()});
  const first=await(await worker.fetch(req(V2_FULL_ID),env())).json();assert.equal(first.progress.applied,true);
  assert.equal(first.progress.mayContinue,false);assert.equal(first.progress.stopReason,'question_target_mismatch');assert.equal(first.continuationToken,null);
});
test('same target with unrelated text or a moment scene cannot authorize another fixed answer',async()=>{
  for(const mode of ['wrong_text','moment']){
    const transformResult=value=>value.candidate?.finish?value:{...value,candidate:{...value.candidate,
      ...(mode==='moment'?{modeId:'moment'}:{question:{...value.candidate.question,text:'明天你打算几点起床？'}})}};
    const makeWorker=()=>createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi({transformResult}),fetchImpl:upstream()});
    const first=await(await makeWorker().fetch(req(V2_FULL_ID),env())).json();
    assert.equal(first.api.result.candidate.question.target,'event');assert.equal(first.progress.applied,true);
    assert.equal(first.progress.mayContinue,false);assert.equal(first.continuationToken,null);
    assert.equal(first.progress.stopReason,mode==='moment'?'scene_mismatch':'question_text_mismatch');
    const prepared=prepareV2Step(V2_FULL_ID,RUN,START,1);
    assert.equal(applyClarityReply(prepared.session,prepared.ticket,first.api.result).ok,true);
    assert.equal(checkContinuationSession(prepared.session,V2_FULL_ID,RUN,2),false);
    assert.throws(()=>prepareV2Step(V2_FULL_ID,RUN,START,2,prepared.session),/v2_question_or_mode_mismatch/);
    const urls=[],worker=makeWorker();
    const report=await runMaterialV2Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:async(url,options)=>{
      urls.push(url);const response=await worker.fetch(new Request(url,options),env());
      if(url.endsWith(`/${V2_FULL_ID}/1`)){
        // Even a faulty preview claiming permission to continue cannot make
        // the client apply an unrelated same-target question or wrong scene.
        const evidence=await response.json();return Response.json({...evidence,progress:{...evidence.progress,mayContinue:true},continuationToken:'fake_authorization_must_not_be_used'});
      }return response;
    }});
    const full=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.equal(full.calls.length,1);assert.equal(full.calls[0].stateVerification.ok,false);
    assert.equal(urls.some(url=>url.endsWith(`/${V2_FULL_ID}/2`)),false);
  }
});
test('expiration after a completed API result prevents state application and continuation',async()=>{
  let clock=START;
  const original=fakeApi();
  const worker=createMaterialV2Worker({now:()=>clock,fetchImpl:upstream(),handleApiImpl:async(...args)=>{
    const response=await original(...args);if(new URL(args[0].url).pathname==='/api/ai/generate')clock=START+V2_TTL_MS;return response;
  }});
  const first=await(await worker.fetch(req(V2_FULL_ID),env())).json();
  assert.equal(first.api.result.status,'candidate');assert.equal(first.progress.applied,false);assert.equal(first.progress.stopReason,'preview_inactive_after_generation');assert.equal(first.continuationToken,null);
});
test('captured output excludes headers, reasoning, error body and arbitrary usage fields',async()=>{
  const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const e=await(await worker.fetch(req(),env())).json();assert.equal(e.transport.dispatches,1);assert.deepEqual(e.transport.response.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
  assert.doesNotMatch(JSON.stringify(e),/synthetic-test-key-never-real|REASONING_MUST|USAGE_MUST|Authorization/);
  const failed=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({errorStatus:403})});
  const f=await(await failed.fetch(req(),env())).json();assert.equal(f.transport.response,null);assert.doesNotMatch(JSON.stringify(f),/PROVIDER_ERROR_MUST/);
});
test('oversized successful clone cannot deadlock its original response tee',async()=>{
  const worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:async()=>new Response(' '.repeat(MAX_RESPONSE_BYTES+1))});
  let timer;try{const r=await Promise.race([worker.fetch(req(),env()),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),250);})]);assert.ok(r);assert.equal((await r.json()).transport.response,null);}finally{clearTimeout(timer);}
});
test('client persists all seven attempts before dispatch, follows authentic questions, strips tokens, saves final bodies',async()=>{
  const snapshots=[],urls=[],sent=[],worker=createMaterialV2Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const report=await runMaterialV2Evaluation({runId:RUN,now:()=>START,persist:v=>snapshots.push(v),fetchImpl:(url,options)=>{
    urls.push(url);if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,urls.length-1);
    return worker.fetch(new Request(url,options),env());
  }});
  assert.equal(report.clientStepAttempts,7);assert.equal(report.modelDispatchesObserved,7);assert.equal(report.completedCaseCount,4);assert.equal(sent.length,7);
  const full=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.equal(full.calls.length,4);assert.deepEqual(full.calls.map(c=>c.context.dialogue.length),[0,1,2,3]);
  assert.equal(full.calls.at(-1).stateVerification.ok,true);assert.equal(full.calls.at(-1).evidence.api.result.policyVersion,'clarity-material-experiment-2');
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|liubai-material-v2-continuation/);assert.equal(report.semanticReview,'pending_manual_review');
});
test('failed full step stops that case without retries or later fixture material',async()=>{
  const urls=[],snapshots=[];
  const report=await runMaterialV2Evaluation({runId:RUN,now:()=>START,persist:v=>snapshots.push(v),fetchImpl:async(url)=>{
    urls.push(url);return url.endsWith('/health')?Response.json(health()):new Response('PROXY_ERROR_SECRET',{status:403});
  }});
  assert.equal(report.clientStepAttempts,4);assert.equal(report.completedCaseCount,0);assert.equal(new Set(urls).size,urls.length);
  assert.equal(report.samples.find(s=>s.caseId===V2_FULL_ID).calls.length,1);assert.doesNotMatch(JSON.stringify(report),/PROXY_ERROR_SECRET/);
});
test('old preview binding, arbitrary origin and failed persistence stop before paid calls',async()=>{
  let calls=0;
  const result=await runMaterialV2Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:async()=>{calls++;return Response.json({...health(),runId:'different_run'});}});
  assert.equal(calls,1);assert.equal(result.clientStepAttempts,0);
  await assert.rejects(runMaterialV2Evaluation({runId:RUN,origin:'https://blank.sakura.observer',persist:()=>{},fetchImpl:()=>{calls++;}}));
  await assert.rejects(runMaterialV2Evaluation({runId:RUN,persist:()=>{throw Error('disk_failed');},fetchImpl:()=>{calls++;}}),/disk_failed/);assert.equal(calls,1);
});
test('importing the CLI does not dispatch network or write files',async()=>{
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no_write');};globalThis.fetch=()=>{calls++;throw Error('no_network');};syncBuiltinESMExports();
  try{assert.equal(typeof(await import(`./clarity-material-v2-live.mjs?test=${Date.now()}`)).runMaterialV2Evaluation,'function');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
