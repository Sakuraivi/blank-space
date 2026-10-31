import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {prepareGuidedReflectRun} from '../../ai/experiments/clarity-guided-reflect.mjs';
import {prepareFaithfulRetainedConcernRun} from '../../ai/experiments/clarity-retained-concern.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {applyClarityReply} from '../../public/clarity-state.mjs';
import {V2_ORIGIN,V2_TTL_MS,V2_ROUTE,V2_FULL_ID,isFullCase,matchesExpectedConcernQuestion} from './clarity-material-v2-fixtures.mjs';
import {V4_BOUNDARY_IDS,isBoundaryCase,fixtureForV4,prepareV4Step} from './clarity-retention-v4-fixtures.mjs';
import {RETENTION_V4_LABEL,runRetentionV3Evaluation} from './clarity-retention-v3-live.mjs';
import {runRetentionV4Evaluation} from './clarity-retention-v4-live.mjs';
const RUN='guided_v4_tests',START=1_790_000_000_000,route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
const health=()=>({label:RETENTION_V4_LABEL,runId:RUN,startedAt:START,expiresAt:START+V2_TTL_MS});
function fakePreview({urls=[],alter=e=>e,wrongBoundaryMode=false,wrongFullMode=false}={}){
  const sessions=new Map();
  return async(url,options)=>{
    urls.push(url);if(url.endsWith('/health'))return Response.json(health());
    const [,id,n]=/\/evaluate\/([^/]+)\/(\d)$/u.exec(url),step=Number(n),full=isFullCase(id),boundary=isBoundaryCase(id),final=!boundary&&(!full||step===4);
    if(step>1)assert.deepEqual(JSON.parse(options.body),{continuationToken:`opaque-${step}`});
    const fixture=fixtureForV4(id),state=prepareV4Step(id,RUN,START,step,sessions.get(id));
    const prepared=await(final?prepareFaithfulRetainedConcernRun:prepareGuidedReflectRun)(state.context,route.profile);
    const transport=JSON.parse(prepareProviderRequest(prepared.requestData,route).body),data=JSON.parse(transport.messages[1].content);
    assert.doesNotMatch(JSON.stringify(data),/"expectedMode"|"requirements"|"forbiddenAdditions"/u);
    if(boundary)for(const label of V4_BOUNDARY_IDS)assert.equal(JSON.stringify(transport).includes(label),false);
    let raw;
    if(final)raw={reply:'这次的表达可以先留下。',title:'这次表达',claims:[]};
    else{
      const mode=boundary?(wrongBoundaryMode?'moment':fixture.expectedMode):wrongFullMode&&step===1?'moment':'concern';
      const finish=boundary&&id==='ROUTE_HAPPY_MOMENT'&&!wrongBoundaryMode;
      raw={modeId:mode,goal:'先聊这件事',reply:'这次已经说出的细节先留着。',title:'这次表达',finish,
        question:finish?null:{text:mode==='concern'?data.turnPlan.question:'你还想从哪个方面说说？',target:mode==='concern'?data.turnPlan.target:mode==='choice'?'tradeoff':'unknown',evidenceIds:[data.statements.at(-1).id]},
        claims:finish?[{type:'event',text:data.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]:[]};
    }
    const value=await prepared.run({adapter:{profile:route.profile,generate:async()=>({status:'completed',output:raw})},isCurrent:()=>true,timeoutMs:1000});
    const result={...value,flow:'clarity-v2',requestId:state.ticket.requestId,revision:state.ticket.revision,route:V2_ROUTE};
    const applied=result.status==='candidate'&&applyClarityReply(state.session,state.ticket,result).ok;
    const mayContinue=applied&&full&&!final&&matchesExpectedConcernQuestion(state.session,fixture,step-1);
    const progress={applied:!!applied,mayContinue:!!mayContinue,stopReason:full&&!final&&applied&&!mayContinue?'scene_mismatch':null,
      ...(boundary?{probeComplete:!!applied}:{}),...(final?{retentionVisibility:prepared.checkVisibleMaterial(state.session)}:{})};
    if(applied)sessions.set(id,state.session);
    return Response.json(alter(structuredClone({synthetic:true,label:RETENTION_V4_LABEL,kind:boundary?'scene_boundary_probe':full?'fixed_dialogue_step':'controlled_review_only',
      runId:RUN,caseId:id,step,requestId:state.ticket.requestId,revision:state.ticket.revision,context:state.context,route:V2_ROUTE,
      hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding},
      transport:{dispatches:1,request:transport,httpStatus:200,response:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}}},
      api:{httpStatus:200,result},progress,continuationToken:mayContinue?`opaque-${step+1}`:null})));
  };
}

test('v4 verifies eleven native calls while distinguishing saved reviews from four first-turn probes',async()=>{
  const snapshots=[],urls=[],report=await runRetentionV4Evaluation({runId:RUN,experimentVersion:3,now:()=>START,persist:x=>snapshots.push(x),fetchImpl:fakePreview({urls})});
  assert.equal(report.label,RETENTION_V4_LABEL);assert.equal(report.clientStepAttempts,11);assert.equal(report.completedCaseCount,8);
  assert.equal(report.completedBoundaryProbes,4);assert.equal(report.memorySavedCaseCount,4);assert.equal(report.nativeResponseCount,11);
  assert.equal(report.contentReleaseGate,'not_met');assert.equal(report.semanticReview,'pending_manual_review');
  for(const s of report.samples){for(const c of s.calls){assert.match(c.requestId,/^retention4_/u);assert.equal(c.verification.nativeRawCompiledUnchanged,true);}
    if(V4_BOUNDARY_IDS.includes(s.caseId)){assert.equal(s.calls.length,1);assert.equal(s.calls[0].context.modeId,'auto');assert.equal(s.calls[0].context.goal,null);
      assert.equal(s.calls[0].stateVerification.boundaryProbe,true);assert.equal(Object.hasOwn(s.calls[0].stateVerification,'savedRecord'),false);}}
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|opaque-/u);assert.equal(urls.length,12);
});

test('a legal but wrong boundary mode stays observable and is not a forced-mode or semantic success',async()=>{
  const report=await runRetentionV4Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:fakePreview({wrongBoundaryMode:true})});
  const s=report.samples.find(s=>s.caseId==='ROUTE_CHOICE_TRADEOFF');assert.equal(s.expectedMode,'choice');assert.equal(s.complete,true);
  assert.equal(s.calls[0].stateVerification.actualMode,'moment');assert.equal(s.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});

test('fixing question references without the actual full scene still stops before future fixed answers',async()=>{
  const urls=[],report=await runRetentionV4Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:fakePreview({urls,wrongFullMode:true})});
  const s=report.samples.find(s=>s.caseId===V2_FULL_ID);assert.equal(s.calls.length,1);assert.equal(s.calls[0].context.statements.length,1);
  assert.equal(s.calls[0].evidence.api.result.candidate.modeId,'moment');assert.equal(s.complete,false);assert.equal(report.clientStepAttempts,8);
  assert.equal(report.memorySavedCaseCount,3);assert.equal(urls.some(u=>u.endsWith(`/${V2_FULL_ID}/2`)),false);
});

test('v4 rejects drifted reflect/review bindings and raw or request bytes without retries',async()=>{
  for(const type of ['request','binding','raw']){
    const urls=[],report=await runRetentionV4Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:fakePreview({urls,alter:e=>{
      if(e.caseId==='ROUTE_INTEREST_OPENER'){
        if(type==='request')e.transport.request.temperature=9;
        if(type==='binding')e.hostRequest.binding.snapshotId='other';
        if(type==='raw')e.transport.response.choices[0].message.content=JSON.stringify({...JSON.parse(e.transport.response.choices[0].message.content),reply:'另一个回复。'});
      }return e;
    }})});
    const s=report.samples.find(s=>s.caseId==='ROUTE_INTEREST_OPENER');assert.equal(s.complete,false);assert.equal(s.calls[0].stateVerification.ok,false);
    assert.equal(s.calls.length,1);assert.equal(new Set(urls).size,urls.length);
  }
});

test('v3 cannot consume v4 health and failed persistence/origin stops before model steps',async()=>{
  let calls=0;const old=await runRetentionV3Evaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:async()=>{calls++;return Response.json(health());}});
  assert.equal(calls,1);assert.equal(old.clientStepAttempts,0);
  await assert.rejects(runRetentionV4Evaluation({runId:RUN,persist:()=>{throw Error('disk_failed');},fetchImpl:()=>{calls++;}}),/disk_failed/);
  await assert.rejects(runRetentionV4Evaluation({runId:RUN,origin:'https://blank.sakura.observer',persist:()=>{},fetchImpl:()=>{calls++;}}));assert.equal(calls,1);
});

test('v4 persists each attempt before its POST and importing the CLI has no writes or network',async()=>{
  let latest,steps=0;const base=fakePreview();
  await runRetentionV4Evaluation({runId:RUN,now:()=>START,persist:x=>{latest=x;},fetchImpl:(url,init)=>{
    if(!url.endsWith('/health')){steps++;assert.equal(latest.clientStepAttempts,steps);}return base(url,init);
  }});assert.equal(steps,11);
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no_write');};globalThis.fetch=()=>{calls++;throw Error('no_network');};syncBuiltinESMExports();
  try{assert.equal(typeof(await import(`./clarity-retention-v4-live.mjs?test=${Date.now()}`)).runRetentionV4Evaluation,'function');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
