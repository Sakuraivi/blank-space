import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {createProviderAdapter} from '../../ai/provider-transport.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {V2_ORIGIN,V2_ROUTE,V2_FULL_ID} from './clarity-material-v2-fixtures.mjs';
import {V5_CASE_IDS,V5_PROBE_IDS} from './clarity-retention-v5-fixtures.mjs';
import {createRetentionV5Worker} from './clarity-retention-v5-worker.mjs';
import {RETENTION_V5_LABEL} from './clarity-retention-v3-live.mjs';
import {runRetentionV5Evaluation} from './clarity-retention-v5-live.mjs';

const RUN='v5_client_tests',START=1_790_000_000_000;
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
// Public, synthetic test material. Neither a deployed signing key nor an API key.
const SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const API_KEY='synthetic-client-test-key-never-real';
const environment=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),
  LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:SECRET});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});

// These canned outputs test the real contracts and request budget, not semantics.
function outputFor(body,{inventFullAt=0,personalMoment=false,knowledgeAmount=false}={}){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_retained_material_user_data')return {reply:'这次说出的经历和期待可以先留下。',title:'合成记录',claims:[]};
  assert.equal(data.kind,'liubai_clarity_user_data');
  const probe=/_probe_([1-8])$/u.exec(data.sessionId),id=probe?V5_PROBE_IDS[Number(probe[1])-1]:null;
  const modes={ROUTE_CONCRETE_CONCERN:'concern',ROUTE_INTEREST_OPENER:'moment',ROUTE_HAPPY_MOMENT:'moment',ROUTE_CHOICE_TRADEOFF:'choice'};
  const modeId=personalMoment&&id==='QTY_NO_AMOUNT'?'moment':modes[id]??'concern';
  const finish=id==='ROUTE_HAPPY_MOMENT';
  let reply='你刚才说出的细节，可以慢慢说。';
  if(!id&&data.statements.length===inventFullAt||personalMoment&&id==='QTY_NO_AMOUNT')reply='那两小时的投入，可以先说清楚。';
  if(knowledgeAmount&&id==='ROUTE_INTEREST_OPENER')reply='可以从两小时的观鸟体验聊起。';
  return {modeId,goal:'理清这件事',reply,title:'合成记录',finish,
    question:finish?null:{text:modeId==='concern'?data.turnPlan.question:modeId==='choice'?'怎样的安排更方便长期参加？':'你想从哪个方面聊起？',
      target:modeId==='concern'?data.turnPlan.target:modeId==='choice'?'tradeoff':'unknown',evidenceIds:[data.statements.at(-1).id]},
    claims:finish?[{type:'event',text:data.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]:[]};
}

function fakeApi({calls=[]}={}){
  const seen=new Set();
  return async(request,env,options)=>{
    const url=new URL(request.url);calls.push(url.pathname);
    if(url.pathname==='/api/ai/status')return Response.json(status());
    assert.equal(url.pathname,'/api/ai/generate');assert.equal(request.headers.get('origin'),url.origin);
    const payload=await request.json();
    assert.equal(seen.has(payload.requestId),false);seen.add(payload.requestId);
    const context=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
    const prepared=await options.prepareClarityRun(context,route.profile);
    const adapter=createProviderAdapter({route,apiKey:API_KEY,fetchImpl:(endpoint,init)=>{
      const guarded={method:init.method,redirect:init.redirect,body:init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('opaque_test_headers_must_not_be_read');}});
      return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...result,flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}

function fakePreview({sent=[],requests=[],apiCalls=[],tokens=[],alter=e=>e,onPost=()=>{},...modelOptions}={}){
  const worker=createRetentionV5Worker({now:()=>START,handleApiImpl:fakeApi({calls:apiCalls}),fetchImpl:async(endpoint,init)=>{
    assert.equal(endpoint,route.endpoint);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');
    const bytes=new TextEncoder().encode(init.body).byteLength;
    assert.equal(route.maxRequestBytes,12000);assert.ok(bytes<=route.maxRequestBytes,'real transport request budget must not be bypassed');
    const body=JSON.parse(init.body);sent.push(body);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(outputFor(body,modelOptions))}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}});
  }});
  return async(url,init)=>{
    assert.equal(new URL(url).origin,V2_ORIGIN);requests.push(url);
    if(!url.endsWith('/health')){
      onPost(url,init);
      if(init.body){const parsed=JSON.parse(init.body);assert.deepEqual(Object.keys(parsed),['continuationToken']);tokens.push(parsed.continuationToken);}
    }
    const response=await worker.fetch(new Request(url,init),environment());
    if(response.status!==200||url.endsWith('/health'))return response;
    return Response.json(alter(await response.json()));
  };
}
const run=options=>runRetentionV5Evaluation({runId:RUN,now:()=>START,persist:()=>{},...options});
const sample=(report,id)=>report.samples.find(s=>s.caseId===id);

test('v5 client verifies 12 attempts, 11 adapter dispatches, one save and seven first-turn probes',async()=>{
  const sent=[],requests=[],snapshots=[],report=await run({experimentVersion:3,persist:x=>snapshots.push(x),fetchImpl:fakePreview({sent,requests})});
  assert.equal(report.label,RETENTION_V5_LABEL);assert.equal(report.clientStepAttempts,12);assert.equal(report.modelDispatchesObserved,11);
  assert.equal(report.nativeResponseCount,11);assert.equal(report.samples.length,9);assert.equal(report.completedCaseCount,8);
  assert.equal(report.memorySavedCaseCount,1);assert.equal(report.completedBoundaryProbes,7);assert.equal(report.sourceUnsupportedCaseCount,1);
  assert.equal(report.runtimeRejectedOutputCount,0);assert.equal(report.complete,true);assert.equal(sent.length,11);assert.equal(requests.length,13);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');assert.equal(report.productionIntegrated,false);
  for(const s of report.samples){
    assert.equal(s.semanticReview,'pending_manual_review');
    for(const c of s.calls){assert.match(c.requestId,/^retention5_/u);if(c.stateVerification.ok)assert.equal(c.verification.nativeRawCompiledUnchanged,true);}
    if(V5_PROBE_IDS.includes(s.caseId))assert.equal(s.calls.some(c=>Object.hasOwn(c.stateVerification,'savedRecord')),false);
  }
  const full=sample(report,V2_FULL_ID);assert.equal(full.calls.length,4);assert.equal(full.calls[3].stateVerification.savedRecord.confirmed,true);
  assert.equal(full.calls[3].stateVerification.allActiveMaterialVisible,true);
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|Bearer |synthetic-client-test-key-never-real/u);
});

test('unsupported-source evidence is verified with zero model dispatch and never counted complete, probe or save',async()=>{
  const sent=[],apiCalls=[],report=await run({fetchImpl:fakePreview({sent,apiCalls})});
  const s=sample(report,'QTY_QUALIFIED_CONDITIONAL'),c=s.calls[0],e=c.evidence;
  assert.equal(s.complete,false);assert.equal(s.stopReason,'unsupported_duration_source_scope');assert.equal(s.calls.length,1);
  assert.equal(c.verification.sourceUnsupportedVerified,true);assert.equal(c.stateVerification.sourceUnsupported,true);assert.equal(c.stateVerification.modelDispatched,false);
  assert.deepEqual(e.transport,{dispatches:0,request:null,response:null,httpStatus:null,elapsedMs:null});assert.equal(e.hostRequest,null);
  assert.equal(e.durationChecks.preparation.status,'unsupported');assert.equal(e.durationChecks.raw,null);assert.equal(e.durationChecks.compiled,null);
  assert.equal(e.progress.applied,false);assert.equal(e.progress.probeComplete,false);assert.equal(e.progress.mayContinue,false);
  assert.equal(Object.hasOwn(c.stateVerification,'savedRecord'),false);
  assert.equal(report.modelDispatchesObserved,sent.length);assert.equal(apiCalls.filter(p=>p==='/api/ai/generate').length,11);
  assert.equal(apiCalls.filter(p=>p==='/api/ai/status').length,12);
});

test('raw invented two hours must match the actual fallback and stops before any later full answers',async()=>{
  const sent=[],requests=[],report=await run({fetchImpl:fakePreview({sent,requests,inventFullAt:2})});
  const s=sample(report,V2_FULL_ID),c=s.calls[1];
  assert.equal(s.complete,false);assert.equal(s.calls.length,2);assert.equal(s.stopReason,'duration_source_mismatch');
  assert.equal(c.context.statements.length,2);assert.equal(c.context.dialogue.length,1);assert.equal(c.evidence.api.result.candidate,null);
  assert.equal(c.evidence.api.result.status,'fallback');assert.equal(c.evidence.api.result.reason,'duration_source_mismatch');
  assert.equal(c.evidence.durationChecks.raw.reason,'new_duration_surface_form');assert.equal(c.evidence.durationChecks.compiled,null);
  assert.equal(c.verification.runtimeRejectionMatched,true);assert.equal(c.verification.actualStateApplied,false);
  assert.equal(c.stateVerification.expectedRuntimeRejectionMatched,true);assert.equal(c.evidence.progress.applied,false);
  assert.equal(c.evidence.progress.mayContinue,false);assert.match(c.evidence.transport.response.choices[0].message.content,/两小时/u);
  assert.equal(requests.some(u=>u.endsWith(`/${V2_FULL_ID}/3`)||u.endsWith(`/${V2_FULL_ID}/4`)),false);
  assert.equal(report.clientStepAttempts,10);assert.equal(report.modelDispatchesObserved,9);assert.equal(report.memorySavedCaseCount,0);
  assert.equal(report.durationRejectedOutputCount,1);assert.equal(report.runtimeRejectedOutputCount,1);assert.equal(report.contentReleaseGate,'not_met');
});

test('binding, envelope, request bytes, source, raw and duration-check tampering cannot become verified client evidence',async t=>{
  const mutations={
    envelope:e=>{e.requestId='forged_request';},
    binding:e=>{e.hostRequest.binding.purpose='knowledge_opener';},
    requestBytes:e=>{e.transport.request.messages[1].content+=' ';},
    sourceContext:e=>{e.context.statements[0].text+='另外一件事。';},
    raw:e=>{const raw=JSON.parse(e.transport.response.choices[0].message.content);raw.reply='另一个回复。';e.transport.response.choices[0].message.content=JSON.stringify(raw);},
    candidate:e=>{e.api.result.candidate.reply='另一个回复。';},
    preparation:e=>{e.durationChecks.preparation.semanticTruth='verified';},
    rawCheck:e=>{e.durationChecks.raw.attribution='verified';},
    compiledCheck:e=>{e.durationChecks.compiled.semanticTruth='verified';},
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>{
    const requests=[],report=await run({fetchImpl:fakePreview({requests,alter:e=>{if(e.caseId===V2_FULL_ID&&e.step===1)mutate(e);return e;}})});
    const s=sample(report,V2_FULL_ID),c=s.calls[0];
    assert.equal(s.complete,false);assert.equal(s.calls.length,1);assert.equal(c.stateVerification.ok,false);
    assert.equal(c.stateVerification.failure,'evidence_candidate_or_state_rejected');assert.equal(c.verification.actualStateApplied,false);
    assert.equal(report.memorySavedCaseCount,0);assert.equal(requests.some(u=>u.endsWith(`/${V2_FULL_ID}/2`)),false);
    assert.equal(new Set(requests).size,requests.length);assert.equal(report.contentReleaseGate,'not_met');
  });
});

test('mismatched API fallback cannot be accepted merely because raw duration rejection was genuine',async()=>{
  const report=await run({fetchImpl:fakePreview({inventFullAt:2,alter:e=>{
    if(e.caseId===V2_FULL_ID&&e.step===2)e.api.result.reason='invalid_question';return e;
  }})});
  const c=sample(report,V2_FULL_ID).calls[1];assert.equal(c.stateVerification.ok,false);
  assert.equal(c.stateVerification.failure,'evidence_candidate_or_state_rejected');assert.equal(c.verification.runtimeRejectionMatched,undefined);
  assert.equal(report.runtimeRejectedOutputCount,0);assert.equal(report.memorySavedCaseCount,0);
});

test('a genuine raw guard rejection cannot authenticate a forged API fallback envelope',async t=>{
  const mutations={
    requestId:e=>{e.api.result.requestId='forged_fallback_request';},
    route:e=>{e.api.result.route={...e.api.result.route,modelId:'forged-fallback-model'};},
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>{
    const requests=[],report=await run({fetchImpl:fakePreview({requests,inventFullAt:2,alter:e=>{
      if(e.caseId===V2_FULL_ID&&e.step===2)mutate(e);return e;
    }})});
    const s=sample(report,V2_FULL_ID),c=s.calls[1];
    assert.equal(s.complete,false);assert.equal(s.calls.length,2);assert.equal(c.evidence.durationChecks.raw.status,'rejected');
    assert.equal(c.evidence.api.result.status,'fallback');assert.equal(c.evidence.api.result.reason,'duration_source_mismatch');
    assert.equal(c.stateVerification.ok,false);assert.equal(c.stateVerification.failure,'evidence_candidate_or_state_rejected');
    assert.notEqual(c.stateVerification.expectedRuntimeRejectionMatched,true);assert.notEqual(c.verification.runtimeRejectionMatched,true);
    assert.equal(c.verification.actualStateApplied,false);assert.equal(report.runtimeRejectedOutputCount,0);assert.equal(report.durationRejectedOutputCount,0);
    assert.equal(report.memorySavedCaseCount,0);assert.equal(requests.some(u=>u.endsWith(`/${V2_FULL_ID}/3`)),false);
    assert.equal(report.contentReleaseGate,'not_met');
  });
});

test('only Host knowledge scope is not applicable; model moment never exempts personal output',async()=>{
  const report=await run({fetchImpl:fakePreview({personalMoment:true,knowledgeAmount:true})});
  const personal=sample(report,'QTY_NO_AMOUNT').calls[0],knowledge=sample(report,'ROUTE_INTEREST_OPENER').calls[0];
  assert.equal(personal.evidence.hostRequest.binding.purpose,'personal_reflection');
  assert.match(personal.evidence.transport.response.choices[0].message.content,/"modeId":"moment"/u);
  assert.equal(personal.evidence.api.result.status,'fallback');assert.equal(personal.evidence.api.result.reason,'duration_source_mismatch');
  assert.equal(personal.stateVerification.expectedRuntimeRejectionMatched,true);assert.equal(personal.evidence.progress.probeComplete,false);
  assert.equal(knowledge.evidence.hostRequest.binding.purpose,'knowledge_opener');assert.equal(knowledge.stateVerification.ok,true);
  for(const check of Object.values(knowledge.durationCheck))assert.equal(check.status,'not_applicable');
  assert.equal(knowledge.durationCheck.preparation.coverage,'not_applicable_host_knowledge_scope');
  assert.match(knowledge.evidence.api.result.candidate.reply,/两小时/u);assert.equal(knowledge.stateVerification.boundaryProbe,true);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});

test('each attempt is durably reported before POST, continuation tokens remain ephemeral and persistence failure prevents POST',async()=>{
  let latest,posts=0;const tokens=[],snapshots=[];
  const report=await run({persist:x=>{latest=x;snapshots.push(x);},fetchImpl:fakePreview({tokens,onPost:()=>{
    posts++;assert.equal(latest.clientStepAttempts,posts);const call=latest.samples.at(-1).calls.at(-1);
    assert.equal(call.evidence,null);assert.equal(call.httpStatus,null);
  }})});
  assert.equal(posts,12);assert.equal(tokens.length,3);assert.ok(tokens.every(t=>typeof t==='string'&&t.includes('.')));
  const serialized=JSON.stringify(snapshots);assert.doesNotMatch(serialized,/continuationToken/u);
  for(const token of tokens)assert.equal(serialized.includes(token),false);
  assert.equal(serialized.includes(SECRET),false);assert.equal(serialized.includes(API_KEY),false);
  assert.equal(report.clientStepAttempts,posts);
  let refusedPosts=0;
  await assert.rejects(run({persist:x=>{if(x.clientStepAttempts===1)throw Error('attempt_ledger_unavailable');},
    fetchImpl:fakePreview({onPost:()=>{refusedPosts++;}})}),/attempt_ledger_unavailable/u);
  assert.equal(refusedPosts,0);
});

test('contradictory unsupported evidence is rejected and cannot inflate verified unsupported totals',async t=>{
  const mutations={
    dispatch:e=>{e.transport.dispatches=1;},
    upstreamStatus:e=>{e.transport.httpStatus=200;},
    upstreamElapsed:e=>{e.transport.elapsedMs=1;},
    completedProbe:e=>{e.progress.probeComplete=true;},
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>{
    const report=await run({fetchImpl:fakePreview({alter:e=>{
      if(e.caseId==='QTY_QUALIFIED_CONDITIONAL')mutate(e);return e;
    }})});
    const s=sample(report,'QTY_QUALIFIED_CONDITIONAL'),c=s.calls[0];assert.equal(s.complete,false);
    assert.equal(c.stateVerification.failure,'evidence_candidate_or_state_rejected');assert.equal(c.verification.sourceUnsupportedVerified,undefined);
    assert.equal(Object.hasOwn(c.stateVerification,'savedRecord'),false);
    assert.equal(report.sourceUnsupportedCaseCount,0,'only verified refusals may count toward the CLI engineering result');
    assert.ok(report.completedCaseCount+report.sourceUnsupportedCaseCount<V5_CASE_IDS.length);
  });
});

test('importing the v5 CLI performs no filesystem writes or network requests',async()=>{
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;
  let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no_test_write');};
  globalThis.fetch=()=>{calls++;throw Error('no_test_network');};syncBuiltinESMExports();
  try{assert.equal(typeof(await import(`./clarity-retention-v5-live.mjs?side-effects=${Date.now()}`)).runRetentionV5Evaluation,'function');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
