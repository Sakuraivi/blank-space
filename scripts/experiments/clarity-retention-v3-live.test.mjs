import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {buildClarityModelRequest,clarityContract} from '../../ai/clarity.mjs';
import {prepareRetainedConcernRun} from '../../ai/experiments/clarity-retained-concern.mjs';
import {runCandidate} from '../../ai/runtime.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,V2_FULL_ID,prepareV2Step} from './clarity-material-v2-fixtures.mjs';
import {runRetentionV3Evaluation,RETENTION_V3_LABEL} from './clarity-retention-v3-live.mjs';

const RUN='native3_test_run',START=1_790_000_000_000,route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
const health=()=>({label:RETENTION_V3_LABEL,runId:RUN,startedAt:START,expiresAt:START+V2_TTL_MS});
function fakePreview({urls=[],alter=e=>e,nativeRaw=()=>({reply:'这次已经表达的部分可以先留下。',title:'这次的表达',claims:[]})}={}){
  const sessions=new Map();
  return async(url,options)=>{
    urls.push(url);if(url.endsWith('/health'))return Response.json(health());
    const [,caseId,number]=/\/evaluate\/([^/]+)\/(\d)$/u.exec(url),step=Number(number),final=caseId!==V2_FULL_ID||step===4;
    assert.equal(options.redirect,'error');assert.equal(options.headers['X-Liubai-Evaluation-Run'],RUN);
    if(step>1)assert.deepEqual(JSON.parse(options.body),{continuationToken:`opaque-${step}`});
    const state=prepareV2Step(caseId,RUN,START,step,sessions.get(caseId),3);
    const prepared=final?await prepareRetainedConcernRun(state.context,route.profile):{
      requestData:buildClarityModelRequest(state.context,route.profile),run:options=>runCandidate({...options,context:state.context,contract:clarityContract})};
    const transport=prepareProviderRequest(prepared.requestData,route),data=JSON.parse(transport.body),user=JSON.parse(data.messages[1].content);
    const raw=final?nativeRaw(caseId):{modeId:'concern',goal:'理清这件小事',reply:'已经说出的这部分先留着。',
      question:{text:user.turnPlan.question,target:user.turnPlan.target,evidenceIds:[user.statements.at(-1).id]},claims:[],finish:false,title:'这次的小事'};
    const content=typeof raw==='string'?raw:JSON.stringify(raw);
    let result;
    try{const output=JSON.parse(content);result=await prepared.run({adapter:{profile:route.profile,generate:async()=>({status:'completed',output})},isCurrent:()=>true,timeoutMs:1000});}
    catch{result={status:'fallback',reason:'provider_response_failed',candidate:null};}
    result={...result,flow:'clarity-v2',requestId:state.ticket.requestId,revision:state.ticket.revision,route:V2_ROUTE};
    const applied=result.status==='candidate'&&applyClarityReply(state.session,state.ticket,result).ok;
    const progress={applied:!!applied,mayContinue:applied&&!final,stopReason:null,...(final&&applied?{retentionVisibility:prepared.checkVisibleMaterial(state.session)}:{})};
    if(applied)sessions.set(caseId,state.session);
    return Response.json(alter(structuredClone({synthetic:true,label:RETENTION_V3_LABEL,kind:caseId===V2_FULL_ID?'fixed_dialogue_step':'controlled_review_only',
      runId:RUN,caseId,step,requestId:state.ticket.requestId,revision:state.ticket.revision,context:state.context,route:V2_ROUTE,
      hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding??null},
      transport:{dispatches:1,request:data,httpStatus:200,response:{choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}}},
      api:{httpStatus:200,result},progress,continuationToken:progress.mayContinue?`opaque-${step+1}`:null})));
  };
}

test('native v3 verifies seven exact requests and raw outputs, then saves all active material without migrating old output',async()=>{
  const snapshots=[],urls=[];
  const report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:x=>snapshots.push(x),fetchImpl:fakePreview({urls})});
  assert.equal(report.clientStepAttempts,7);assert.equal(report.modelDispatchesObserved,7);assert.equal(report.completedCaseCount,4);
  assert.equal(report.nativeResponseCount,7);assert.equal(report.nativeProtocolRequested,true);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');assert.equal(report.productionIntegrated,false);
  for(const sample of report.samples){
    assert.equal(sample.complete,true);
    for(const call of sample.calls){
      assert.match(call.requestId,/^retention3_/u);assert.equal(call.verification.exactTransportRequestMatched,true);
      assert.equal(call.verification.nativeRawCompiledUnchanged,true);assert.equal(call.verification.actualStateApplied,true);
    }
    const final=sample.calls.at(-1);assert.equal(final.stateVerification.allActiveMaterialVisible,true);
    assert.deepEqual(JSON.parse(final.evidence.transport.response.choices[0].message.content).claims,[]);
    assert.equal(final.stateVerification.visibleReview.blocks[0].text,final.retention.retainedText);
  }
  const full=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.deepEqual(full.calls.map(c=>c.context.dialogue.length),[0,1,2,3]);
  const correction=report.samples.find(s=>s.caseId==='V2_CORRECTED_FEELING').calls[0].retention.retainedText;
  assert.match(correction,/生气/u);assert.doesNotMatch(correction,/失落/u);
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|opaque-/u);
  assert.equal(urls.length,8);
});

test('client persists each attempt before its dispatch and a persistence failure prevents paid steps',async()=>{
  let latest,steps=0;const wrapped=fakePreview();
  await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:v=>{latest=v;},fetchImpl:(url,options)=>{
    if(!url.endsWith('/health')){steps++;assert.equal(latest.clientStepAttempts,steps);}
    return wrapped(url,options);
  }});assert.equal(steps,7);
  let dispatches=0;await assert.rejects(runRetentionV3Evaluation({runId:RUN,persist:()=>{throw Error('disk_failed');},fetchImpl:()=>{dispatches++;}}),/disk_failed/);
  assert.equal(dispatches,0);
});

test('v2 health and arbitrary origin stop before any model step',async()=>{
  let calls=0;const report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:async()=>{calls++;return Response.json({...health(),label:'liubai-material-preview-2'});}});
  assert.equal(calls,1);assert.equal(report.clientStepAttempts,0);assert.equal(report.health.failure,'health_failed');
  assert.equal(report.nativeResponseCount,0);
  await assert.rejects(runRetentionV3Evaluation({runId:RUN,origin:'https://blank.sakura.observer',persist:()=>{},fetchImpl:()=>{calls++;}}));assert.equal(calls,1);
});

test('changed request bytes, snapshot binding, raw or server coverage cannot be counted as a valid saved result',async()=>{
  for(const type of ['request','binding','raw','coverage']){
    const report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:fakePreview({alter:e=>{
      if(e.caseId===V2_FULL_ID&&e.step===4){
        if(type==='request')e.transport.request.temperature=9;
        if(type==='binding')e.hostRequest.binding.snapshotId='other';
        if(type==='raw')e.transport.response.choices[0].message.content=JSON.stringify({reply:'不同的回复。',title:'这次的表达',claims:[]});
        if(type==='coverage')e.progress.retentionVisibility={status:'material_not_visible',allVisible:false};
      }return e;
    }})});
    const full=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.equal(full.complete,false);assert.equal(full.calls[3].stateVerification.ok,false);
    assert.equal(report.completedCaseCount,3);
  }
});

test('native format or analysis failures remain failed without stripping fences, migrating or retrying',async()=>{
  for(const output of ['```json\n{"reply":"原生失败","title":"记录","claims":[]}\n```',
    {reply:'非法event。',title:'记录',claims:[{type:'event',text:'不能让模型重写原话。',anchorIds:['m1']}]}]){
    const urls=[],report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:fakePreview({urls,nativeRaw:()=>output})});
    assert.equal(report.clientStepAttempts,7);assert.equal(report.completedCaseCount,0);assert.equal(new Set(urls).size,urls.length);
    for(const sample of report.samples){assert.equal(sample.calls.at(-1).stateVerification.ok,false);assert.equal(sample.complete,false);}
  }
});

test('failed first full step stops future material, preserves attempts and never retries',async()=>{
  const urls=[],base=fakePreview();
  const report=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:(url,options)=>{
    urls.push(url);if(url.endsWith(`/${V2_FULL_ID}/1`))return new Response('PRIVATE_PROXY_ERROR',{status:503});return base(url,options);
  }});
  const full=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.equal(full.calls.length,1);assert.equal(full.calls[0].context.statements.length,1);
  assert.equal(report.clientStepAttempts,4);assert.equal(report.completedCaseCount,3);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_PROXY_ERROR/);
  assert.equal(urls.some(url=>url.endsWith(`/${V2_FULL_ID}/2`)),false);
});

test('importing native v3 CLI performs no network or filesystem writes',async()=>{
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no_write');};globalThis.fetch=()=>{calls++;throw Error('no_network');};syncBuiltinESMExports();
  try{assert.equal(typeof(await import(`./clarity-retention-v3-live.mjs?test=${Date.now()}`)).runRetentionV3Evaluation,'function');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
