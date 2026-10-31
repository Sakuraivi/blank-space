// Run only after the final policy freeze and fresh-fixture installation.
// Scripted responses verify the harness, never fresh semantic correctness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {buildClarityContext} from '../../public/clarity-contract.mjs';
import {createProviderAdapter} from '../../ai/provider-transport.mjs';
import {getPersonalRoute,isTrustedRoute} from '../../ai/providers.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {encryptKey} from '../../server/secrets.mjs';
import {FAITHFUL_DIALOGUE_REFLECT_POLICY,FAITHFUL_DIALOGUE_REVIEW_POLICY} from '../../ai/experiments/clarity-faithful-dialogue.mjs';
import {createRetentionV5Worker} from './clarity-retention-v5-worker.mjs';
import {createRetentionV6Worker} from './clarity-retention-v6-worker.mjs';
import {runRetentionV6Evaluation} from './clarity-retention-v6-live.mjs';
import {retentionEvaluationSourceMetadata} from './clarity-retention-v3-live.mjs';
import {V2_ORIGIN,V2_ROUTE,V2_FULL_ID,requestIdFor} from './clarity-material-v2-fixtures.mjs';
import {V5_CASE_IDS,prepareV5Step} from './clarity-retention-v5-fixtures.mjs';
import {V6_CASE_IDS,V6_PROBE_IDS,V6_FRESH_IDS,isV6Fresh,isV6Probe,fixtureForV6,purposeForV6Case,prepareV6Step,checkV6ContinuationSession} from './clarity-retention-v6-fixtures.mjs';

const RUN='v6_synthetic_run',START=1_790_000_000_000,LABEL='liubai-faithful-dialogue-preview-6';
const SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
const env=()=>({LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',LIUBAI_SECRET_KEY:SECRET});
const status=()=>({enabled:true,defaultAvailable:true,defaultEnabled:true,configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,
  defaultProfile:{providerId:V2_ROUTE.providerId,modelId:V2_ROUTE.modelId,defaultRevision:V2_ROUTE.defaultRevision}});
const request=(id=V2_FULL_ID,step=1,token)=>new Request(`${V2_ORIGIN}/evaluate/${id}/${step}`,{method:'POST',
  headers:{'X-Liubai-Evaluation-Run':RUN,...(token?{'Content-Type':'application/json'}:{})},...(token?{body:JSON.stringify({continuationToken:token})}:{})});

function modelOutput(body,{inventFullAt=0}={}){
  const data=JSON.parse(body.messages[1].content);
  if(data.kind==='liubai_retained_material_user_data')return {reply:'这次说出的经历和期待都可以先留下。',title:'合成材料记录',claims:[]};
  assert.equal(data.kind,'liubai_clarity_user_data');
  const ordinal=Number(/_probe_([0-9]+)$/u.exec(data.sessionId)?.[1]??0);
  const knowledge=data.durationSourcePolicy.purpose==='knowledge_opener';
  const finish=data.turnPlan.finish||ordinal===3;
  const modeId=finish?'moment':knowledge?'moment':ordinal===4?'choice':'concern';
  return {modeId,goal:'理清这件小事',title:'合成材料记录',
    reply:!ordinal&&data.statements.length===inventFullAt?'那两小时的投入，可以先说清楚。':'你刚才说出的这部分，可以慢慢说。',
    question:finish?null:{text:modeId==='concern'?data.turnPlan.question:modeId==='choice'?'怎样的安排更方便长期参加？':'你想从哪一方面聊起？',
      target:modeId==='concern'?data.turnPlan.target:modeId==='choice'?'tradeoff':'unknown',evidenceIds:[data.statements.at(-1).id]},
    claims:finish?[{type:'event',text:data.statements.at(-1).text,evidenceIds:[data.statements.at(-1).id],derivation:'stated',supersedes:[]}]:[],finish};
}
function upstream({sent=[],fenced=false,errorStatus=0,...options}={}){
  return async(endpoint,init)=>{
    const body=JSON.parse(init.body);sent.push(body);
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    const raw=JSON.stringify(modelOutput(body,options));
    return Response.json({choices:[{finish_reason:'stop',message:{content:fenced?'```json\n'+raw+'\n```':raw,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'}});
  };
}
function fakeApi({calls=[],badBytes=false,defaultStatus=status()}={}){
  const seen=new Set();
  return async(request,environment,options)=>{
    const url=new URL(request.url);calls.push(url.pathname);if(url.pathname==='/api/ai/status')return Response.json(defaultStatus);
    const payload=await request.json(),context=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
    const prepared=await options.prepareClarityRun(context,route.profile);
    if(seen.has(payload.requestId))return Response.json({status:'fallback',reason:'duplicate_request'},{status:429});seen.add(payload.requestId);
    const adapter=createProviderAdapter({route,apiKey:'synthetic-v6-test-key-never-real',fetchImpl:(endpoint,init)=>{
      const guarded={method:init.method,redirect:init.redirect,body:badBytes?init.body+' ':init.body,signal:init.signal};
      Object.defineProperty(guarded,'headers',{get(){throw Error('headers_must_remain_opaque');}});return options.fetchImpl(endpoint,guarded);
    }});
    const result=await prepared.run({adapter,signal:request.signal,isCurrent:()=>!request.signal.aborted,timeoutMs:1000});
    return Response.json({...result,flow:'clarity-v2',requestId:payload.requestId,revision:payload.revision,route:V2_ROUTE});
  };
}
function evaluate(worker,{snapshots=[],mutate}={}){
  return runRetentionV6Evaluation({runId:RUN,now:()=>START,persist:value=>snapshots.push(value),fetchImpl:async(url,options)=>{
    const response=await worker.fetch(new Request(url,options),env());
    if(!mutate||url.endsWith('/health'))return response;const value=await response.json();mutate(value);return Response.json(value,{status:response.status});
  }});
}

test('v6 retains nine known cases and adds only four auto first-turn inputs using neutral probe 9..12',()=>{
  assert.equal(V6_CASE_IDS.length,13);assert.equal(V6_PROBE_IDS.length,12);assert.equal(V6_FRESH_IDS.length,4);assert.deepEqual(V6_CASE_IDS.slice(0,9),V5_CASE_IDS);
  for(const id of V6_CASE_IDS){
    const p=prepareV6Step(id,RUN,START,1);assert.equal(p.ticket.requestId,requestIdFor(RUN,id,1,6));
    if(!isV6Fresh(id)){assert.deepEqual(p.context,prepareV5Step(id,RUN,START,1,null,6).context);continue;}
    const fixture=fixtureForV6(id);assert.equal(p.context.sessionId,`retention6_${RUN}_probe_${V6_PROBE_IDS.indexOf(id)+1}`);
    assert.equal(p.context.modeId,'auto');assert.equal(p.context.goal,null);assert.equal(p.context.stage,'reflect');assert.equal(p.context.allowNextStep,false);
    assert.deepEqual(p.context.statements,[{id:'u1',kind:'expression',text:fixture.input.trim()}]);assert.deepEqual(p.context.dialogue,[]);assert.deepEqual(p.context.claims,[]);
    assert.equal(purposeForV6Case(id),fixture.purpose);assert.equal(checkV6ContinuationSession(p.session,id,RUN,2),false);
    assert.doesNotMatch(JSON.stringify(p.context),/requirements|expectedMode|forbiddenAdditions/u);
    for(const probeId of V6_PROBE_IDS)assert.equal(JSON.stringify(p.context).includes(probeId),false);
    assert.throws(()=>prepareV6Step(id,RUN,START,2));
  }
});

test('actual v6 client and Worker retain sixteen attempts, fifteen dispatches, one saved review, eleven applied probes and one unsupported probe',async t=>{
  const sent=[],snapshots=[],worker=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent})});
  const report=await evaluate(worker,{snapshots});
  assert.equal(report.complete,true);assert.equal(report.clientStepAttempts,16);assert.equal(report.modelDispatchesObserved,15);assert.equal(sent.length,15);
  assert.equal(report.completedCaseCount,12);assert.equal(report.completedBoundaryProbes,11);assert.equal(report.completedFreshProbes,4);assert.equal(report.memorySavedCaseCount,1);
  assert.equal(report.sourceUnsupportedCaseCount,1);assert.equal(report.runtimeRejectedOutputCount,0);assert.equal(report.plannedMaximumModelCalls,16);
  const bodyBytes=[];
  for(const sample of report.samples)for(const call of sample.calls){
    if(call.evidence.preparationUnsupported){assert.equal(sample.caseId,'QTY_QUALIFIED_CONDITIONAL');assert.equal(call.evidence.transport.dispatches,0);continue;}
    assert.equal(call.evidence.api.result.policyVersion,sample.caseId===V2_FULL_ID&&call.step===4?FAITHFUL_DIALOGUE_REVIEW_POLICY:FAITHFUL_DIALOGUE_REFLECT_POLICY);
    assert.ok(call.verification.hostEnvelopeMatched&&call.verification.exactTransportRequestMatched&&call.verification.nativeRawCompiledUnchanged&&call.verification.actualStateApplied);
    assert.equal(call.evidence.hostRequest.binding.purpose,purposeForV6Case(sample.caseId));
    const raw=JSON.stringify(call.evidence.transport.request);bodyBytes.push({caseId:sample.caseId,step:call.step,bytes:new TextEncoder().encode(raw).byteLength});
    assert.doesNotMatch(raw,/requirements|expectedMode|forbiddenAdditions/u);for(const id of V6_PROBE_IDS)assert.equal(raw.includes(id),false);
    if(isV6Probe(sample.caseId)){assert.equal(call.evidence.progress.probeComplete,true);assert.equal(call.evidence.progress.mayContinue,false);assert.equal(Object.hasOwn(call.evidence.progress,'retentionVisibility'),false);}
  }
  assert.equal(isTrustedRoute(route),true);assert.equal(route.maxRequestBytes,12000);assert.equal(bodyBytes.length,15);assert.ok(bodyBytes.every(value=>value.bytes<=route.maxRequestBytes));
  t.diagnostic(JSON.stringify({routeMaxRequestBytes:route.maxRequestBytes,maxBodyBytes:Math.max(...bodyBytes.map(value=>value.bytes)),full:bodyBytes.filter(value=>value.caseId===V2_FULL_ID)}));
  assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken|liubai-material-v6-continuation|synthetic-v6-test-key-never-real/u);
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');
});

test('real default-service API preparation accepts v6 reflect/review scopes with the signed route and actual in-memory ledger',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const schema=readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n');db.exec(schema);
  const encrypted=await encryptKey('synthetic-v6-test-key-never-real',SECRET);
  db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(V2_ROUTE.providerId,V2_ROUTE.modelId,encrypted.encrypted_key,encrypted.iv,V2_ROUTE.defaultRevision,START);
  const environment={...env(),DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},
    async first(){return db.prepare(sql).get(...args)??null;},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}};
  const sent=[],worker=createRetentionV6Worker({now:()=>START,fetchImpl:upstream({sent})});
  // handleApiImpl is deliberately omitted: this crosses the real API's
  // organizer resolution, preparation, capacity, decryption and ledger gates.
  const report=await runRetentionV6Evaluation({runId:RUN,now:()=>START,persist:()=>{},
    fetchImpl:(url,options)=>worker.fetch(new Request(url,options),environment)});
  assert.equal(report.completedCaseCount,12);assert.equal(report.completedFreshProbes,4);assert.equal(report.sourceUnsupportedCaseCount,1);
  assert.equal(report.clientStepAttempts,16);assert.equal(report.modelDispatchesObserved,15);assert.equal(sent.length,15);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,15);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='finished' AND outcome='candidate'").get().n,15);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started'").get().n,0);
  const full=report.samples.find(sample=>sample.caseId===V2_FULL_ID);assert.deepEqual(full.calls.map(call=>call.context.stage),['reflect','reflect','reflect','review']);
  assert.equal(full.calls.at(-1).stateVerification.allActiveMaterialVisible,true);
  for(const sample of report.samples)for(const call of sample.calls)if(!call.evidence.preparationUnsupported){
    assert.equal(call.evidence.api.result.route.defaultRevision,V2_ROUTE.defaultRevision);
    assert.equal(call.evidence.api.result.route.sourceMode,'default');
  }
});

test('v6 leaves the known qualified source unsupported before generate rather than fitting it to the new samples',async()=>{
  const sent=[],calls=[],worker=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi({calls}),fetchImpl:upstream({sent})});
  const value=await(await worker.fetch(request('QTY_QUALIFIED_CONDITIONAL'),env())).json();assert.equal(value.preparationUnsupported,true);
  assert.deepEqual(calls,['/api/ai/status']);assert.equal(sent.length,0);assert.equal(value.transport.dispatches,0);assert.equal(value.hostRequest,null);
  assert.equal(value.durationChecks.preparation.status,'unsupported');assert.equal(value.durationChecks.raw,null);assert.equal(value.durationChecks.compiled,null);
  assert.equal(value.api.result.reason,'unsupported_duration_source_scope');assert.equal(value.progress.applied,false);assert.equal(value.continuationToken,null);
});

test('invented duration stops the full dialogue on its actual second response without retry or future answers',async()=>{
  const sent=[],worker=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({sent,inventFullAt:2})});
  const report=await evaluate(worker),full=report.samples.find(sample=>sample.caseId===V2_FULL_ID);
  assert.equal(full.calls.length,2);assert.equal(full.complete,false);assert.equal(full.stopReason,'duration_source_mismatch');assert.equal(report.durationRejectedOutputCount,1);
  assert.equal(full.calls[1].context.statements.length,2);assert.equal(full.calls[1].evidence.durationChecks.raw.status,'rejected');
  assert.equal(full.calls[1].evidence.durationChecks.compiled,null);assert.equal(full.calls[1].evidence.progress.mayContinue,false);
  assert.match(full.calls[1].evidence.transport.response.choices[0].message.content,/两小时/u);
  assert.equal(sent.filter(body=>JSON.parse(body.messages[1].content).sessionId?.endsWith(`_${V2_FULL_ID}`)).length,2);
});

test('v5 and v6 continuation keys, labels and request identities are isolated',async t=>{
  const derive=crypto.subtle.deriveKey.bind(crypto.subtle),domains=[];
  t.mock.method(crypto.subtle,'deriveKey',(algorithm,...args)=>{domains.push({salt:new TextDecoder().decode(algorithm.salt),info:new TextDecoder().decode(algorithm.info)});return derive(algorithm,...args);});
  const workers=[createRetentionV5Worker,createRetentionV6Worker].map(factory=>factory({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream(),experimentVersion:5}));
  const labels=await Promise.all(workers.map(async worker=>(await(await worker.fetch(new Request(`${V2_ORIGIN}/health`),env())).json()).label));
  assert.deepEqual(labels,['liubai-duration-source-preview-5',LABEL]);
  const first=await Promise.all(workers.map(async worker=>(await worker.fetch(request(),env())).json()));assert.notEqual(first[0].requestId,first[1].requestId);
  assert.equal((await workers[0].fetch(request(V2_FULL_ID,2,first[1].continuationToken),env())).status,400);
  assert.equal((await workers[1].fetch(request(V2_FULL_ID,2,first[0].continuationToken),env())).status,400);
  assert.ok(domains.some(value=>value.salt==='liubai-faithful-dialogue-v6-preview'&&value.info==='liubai-material-v6-continuation-1'));
  assert.equal((await workers[0].fetch(request(V6_FRESH_IDS[0]),env())).status,404);
});

test('tampered v6 evidence remains rejected in the client without retries or a semantic success claim',async()=>{
  const snapshots=[],worker=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream()});
  const report=await evaluate(worker,{snapshots,mutate:value=>{if(value.caseId===V6_FRESH_IDS[0])value.hostRequest.policyVersion='synthetic-forged-policy';}});
  const sample=report.samples.find(sample=>sample.caseId===V6_FRESH_IDS[0]);assert.equal(sample.complete,false);assert.equal(sample.calls.length,1);
  assert.equal(sample.calls[0].stateVerification.ok,false);assert.equal(report.completedFreshProbes,3);assert.equal(report.clientStepAttempts,16);
  assert.equal(report.contentReleaseGate,'not_met');assert.doesNotMatch(JSON.stringify(snapshots),/continuationToken/u);
});

test('raw fences, provider failures and route/body mismatch remain unmodified failures with no credential leakage',async()=>{
  const fenced=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({fenced:true})});
  const fence=await(await fenced.fetch(request(V6_FRESH_IDS[0]),env())).json();assert.equal(fence.api.result.status,'fallback');
  assert.equal(fence.durationChecks.raw,null);assert.equal(fence.durationChecks.compiled,null);assert.match(fence.transport.response.choices[0].message.content,/^```json/u);
  const sent=[],bytes=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi({badBytes:true}),fetchImpl:upstream({sent})});
  const mismatch=await(await bytes.fetch(request(V6_FRESH_IDS[0]),env())).json();assert.equal(mismatch.transport.dispatches,0);assert.equal(sent.length,0);
  const error=createRetentionV6Worker({now:()=>START,handleApiImpl:fakeApi(),fetchImpl:upstream({errorStatus:403})});
  const failed=await(await error.fetch(request(V6_FRESH_IDS[0]),env())).json();assert.equal(failed.api.result.status,'fallback');assert.equal(failed.transport.response,null);
  assert.doesNotMatch(JSON.stringify([fence,mismatch,failed]),/synthetic-v6-test-key-never-real|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK|PROVIDER_ERROR_MUST_NOT_LEAK/u);
});

test('source digests include the final policy and fresh fixture, while v6 imports perform no fetch or writes',async()=>{
  const metadata=retentionEvaluationSourceMetadata(6),files=metadata.sourceDigests.map(value=>value.file);
  assert.ok(files.includes('ai/experiments/clarity-faithful-dialogue.mjs'));assert.ok(files.includes('ai/fixtures/clarity-dialogue-boundary-samples.mjs'));
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,original=globalThis.fetch;let calls=0,writes=0;
  globalThis.fetch=()=>{calls++;throw Error('must_not_fetch_on_import');};
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('must_not_write_on_import');};syncBuiltinESMExports();
  try{await import('./clarity-retention-v6-live.mjs?synthetic-import-check');await import('./clarity-retention-v6-worker.mjs?synthetic-import-check');}
  finally{globalThis.fetch=original;fs.writeFileSync=write;fs.mkdirSync=mkdir;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
