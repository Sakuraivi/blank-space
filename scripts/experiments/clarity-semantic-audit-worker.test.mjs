// Run after the audit policy freeze and final fresh-fixture installation.
// Stub provider responses verify private transport, not semantic detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {buildClarityContext,validateClarityCandidate} from '../../public/clarity-contract.mjs';
import {PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {encryptKey} from '../../server/secrets.mjs';
import {getPersonalRoute,isTrustedRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {prepareSemanticAuditRun,SEMANTIC_AUDIT_POLICY,SEMANTIC_AUDIT_SCHEMA} from '../../ai/experiments/clarity-semantic-audit.mjs';
import {AUDIT_LABEL,AUDIT_ORIGIN,AUDIT_TTL_MS,AUDIT_ROUTE,loadSemanticAuditFixtures,auditRequestId,auditApiPayload} from './clarity-semantic-audit-fixtures.mjs';
import {createSemanticAuditWorker,captureSemanticAuditResponse} from './clarity-semantic-audit-worker.mjs';
import {runSemanticAuditEvaluation,semanticAuditSourceMetadata} from './clarity-semantic-audit-live.mjs';

const RUN='audit1_synthetic_run',START=1_790_000_000_000;
const SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY='synthetic-audit-test-key-never-real';
const route=getPersonalRoute(AUDIT_ROUTE.providerId,AUDIT_ROUTE.modelId);
const req=(id,options={})=>new Request(`${AUDIT_ORIGIN}/evaluate/${id}`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},...options});

test('response capture stops for pre-aborted, aborted-during-read and independent read deadline',async()=>{
  const pending=()=>new Response(new ReadableStream({start(){}}));
  const pre=new AbortController();pre.abort();let response=pending();
  assert.equal(await captureSemanticAuditResponse(response,{signal:pre.signal,timeoutMs:20}),null);response.body.cancel().catch(()=>{});
  const during=new AbortController();response=pending();const timer=setTimeout(()=>during.abort(),5);
  assert.equal(await captureSemanticAuditResponse(response,{signal:during.signal,timeoutMs:50}),null);clearTimeout(timer);response.body.cancel().catch(()=>{});
  response=pending();assert.equal(await captureSemanticAuditResponse(response,{timeoutMs:5}),null);response.body.cancel().catch(()=>{});
});

test('empty-chunk streams and oversized bodies cannot evade capture bounds or become empty findings',async()=>{
  const empty=new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(0));}}));
  assert.equal(await captureSemanticAuditResponse(empty,{timeoutMs:50}),null);empty.body.cancel().catch(()=>{});
  const huge=new Response(new Uint8Array(128*1024+1));
  assert.equal(await captureSemanticAuditResponse(huge,{timeoutMs:50}),null);huge.body.cancel().catch(()=>{});
});

async function environment(t,{revision=3}={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n'));
  const encrypted=await encryptKey(KEY,SECRET);
  db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(AUDIT_ROUTE.providerId,AUDIT_ROUTE.modelId,encrypted.encrypted_key,encrypted.iv,revision,START);
  return {db,env:{LIUBAI_SECRET_KEY:SECRET,LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',
    DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},
      async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}}};
}

test('capture deadline closes the real API ledger as fallback without passing a hanging original body downstream',async t=>{
  const {db,env}=await environment(t);let calls=0;
  const worker=createSemanticAuditWorker({now:()=>START,captureTimeoutMs:5,fetchImpl:async()=>{
    calls++;return new Response(new ReadableStream({start(){}}));
  }});
  const sample=(await loadSemanticAuditFixtures())[0];
  const result=await(await worker.fetch(req(sample.id),env)).json();
  assert.equal(calls,1);assert.equal(result.transport.response,null);assert.equal(result.api.result.status,'fallback');
  assert.equal(result.api.result.audit,null);assert.equal(result.progress.completed,false);
  const row=db.prepare('SELECT state,outcome FROM pilot_requests').get();
  assert.equal(row.state,'finished');assert.equal(row.outcome,'fallback');
});
function provider({sent=[],withFinding=false,invalid=false,fenced=false,errorStatus=0}={}){
  return async(endpoint,options)=>{
    assert.equal(endpoint,route.endpoint);const body=JSON.parse(options.body);sent.push(body);
    if(errorStatus)return Response.json({error:{message:'PROVIDER_ERROR_MUST_NOT_LEAK'}},{status:errorStatus});
    const data=JSON.parse(body.messages[1].content);let output={findings:[]};
    if(withFinding){
      const kind=data.task==='knowledge'?'unanswered_explicit_request':data.allowedKinds[0],field=data.fields.find(value=>value.role===(kind==='leading_question'?'question':'reply'));
      output={findings:[{kind,fieldId:field.id,candidateQuote:Array.from(field.text).slice(0,12).join(''),
        sources:[{sourceId:data.sources[0].id,quote:Array.from(data.sources[0].text).slice(0,12).join('')}],reason:'合成审校定位，仅用于验证私有协议。'}]};
    }
    if(invalid)output.approved=true;const raw=JSON.stringify(output);
    return Response.json({choices:[{finish_reason:'stop',message:{content:fenced?'```json\n'+raw+'\n```':raw,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'}});
  };
}
const run=(worker,env,options={})=>runSemanticAuditEvaluation({runId:RUN,now:()=>START,persist:()=>{},
  fetchImpl:(url,init)=>worker.fetch(new Request(url,init),env),...options});

test('fourteen fixed audit inputs preserve API identity and exclude fixture/session labels from model input',async()=>{
  const samples=await loadSemanticAuditFixtures();assert.equal(samples.length,14);assert.equal(samples.filter(sample=>sample.group==='known').length,8);
  for(const sample of samples){
    const payload=auditApiPayload(sample,RUN,{configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION});
    assert.equal(payload.requestId,auditRequestId(RUN,sample.id));assert.match(payload.requestId,/^audit1_/u);assert.equal(payload.session.id,sample.input.context.sessionId);
    assert.deepEqual(buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep}),sample.input.context);
    const prepared=await prepareSemanticAuditRun(sample.input,route.profile),request=prepareProviderRequest(prepared.requestData,route),data=JSON.parse(prepared.requestData.input.content);
    assert.equal(request.byteLength<=12000,true);assert.equal(Object.hasOwn(data,'sessionId'),false);
    assert.doesNotMatch(JSON.stringify(data),/expectedFindings|reviewReasons|"origin"|"sessionId"/u);
    for(const target of samples)assert.equal(JSON.stringify(data).includes(target.id),false);
  }
});

test('actual default API completes fourteen private audit ledger entries with no public candidate or user-state application',async t=>{
  const f=await environment(t),sent=[],snapshots=[],samples=await loadSemanticAuditFixtures(),before=JSON.stringify(samples);
  // No handleApiImpl injection: real default-key resolution, prepare, signed
  // route, encrypted-key handling, reservation and finish are all exercised.
  const worker=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({sent})});
  const report=await run(worker,f.env,{persist:value=>snapshots.push(value),fetchImpl:(url,init)=>{
    if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,sent.length+1);
    return worker.fetch(new Request(url,init),f.env);
  }});
  assert.equal(report.clientStepAttempts,14);assert.equal(report.modelDispatchesObserved,14);assert.equal(report.completedCaseCount,14);assert.equal(sent.length,14);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,14);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='finished' AND outcome='completed'").get().n,14);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started' OR outcome='candidate'").get().n,0);
  for(const sample of report.samples){
    assert.equal(sample.completed,true);const evidence=sample.calls[0].evidence,result=evidence.api.result;
    assert.equal(result.status,'completed');assert.equal(Object.hasOwn(result,'candidate'),false);assert.equal(evidence.progress.stateApplied,false);
    assert.deepEqual(result.audit.findings,[]);assert.equal(result.audit.semanticTruth,'unverified');assert.equal(result.audit.noFindingsMeaning,'not_detected_not_certified');
    assert.equal(validateClarityCandidate(result.audit,sample.input.context).ok,false);assert.equal(sample.semanticReview,'pending_manual_review');
    assert.deepEqual(evidence.transport.response.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
  }
  assert.equal(JSON.stringify(await loadSemanticAuditFixtures()),before);assert.equal(report.stateMutation,false);assert.equal(report.semanticReview,'pending_manual_review');
  assert.doesNotMatch(JSON.stringify(snapshots),new RegExp(`${KEY}|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK`,'u'));
  assert.equal(isTrustedRoute(route),true);assert.equal(route.maxRequestBytes,12000);
  t.diagnostic(JSON.stringify({modelCalls:sent.length,maxBodyBytes:Math.max(...sent.map(body=>new TextEncoder().encode(JSON.stringify(body)).byteLength)),routeMaxRequestBytes:route.maxRequestBytes}));
});

test('a nonempty finding is a quoted private observation, not a replacement clarity response',async t=>{
  const f=await environment(t),sample=(await loadSemanticAuditFixtures())[0],worker=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({withFinding:true})});
  const result=await(await worker.fetch(req(sample.id),f.env)).json();assert.equal(result.api.result.status,'completed');assert.equal(result.api.result.audit.findings.length,1);
  assert.equal(result.api.result.audit.authority,'observation_only');assert.equal(Object.hasOwn(result.api.result,'candidate'),false);assert.equal(result.progress.stateApplied,false);
  assert.equal(result.api.result.policyVersion,SEMANTIC_AUDIT_POLICY);assert.equal(result.api.result.schemaVersion,SEMANTIC_AUDIT_SCHEMA);
});

test('idempotency rejects repeated audit IDs, and native invalid/fenced output is never repaired or retried',async t=>{
  const sample=(await loadSemanticAuditFixtures())[0],f=await environment(t),sent=[],worker=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({sent,invalid:true})});
  const first=await(await worker.fetch(req(sample.id),f.env)).json();assert.equal(first.api.result.status,'fallback');assert.equal(first.api.result.audit,null);assert.equal(first.progress.completed,false);
  assert.match(first.transport.response.choices[0].message.content,/"approved":true/u);assert.equal(Object.hasOwn(first.api.result,'candidate'),false);
  const duplicate=await(await worker.fetch(req(sample.id),f.env)).json();assert.equal(duplicate.api.httpStatus,429);assert.equal(duplicate.api.result.reason,'duplicate_request');
  assert.equal(duplicate.transport.dispatches,0);assert.equal(sent.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);
  const g=await environment(t),fenced=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({fenced:true})});
  const failed=await(await fenced.fetch(req(sample.id),g.env)).json();assert.equal(failed.api.result.status,'fallback');assert.equal(failed.progress.completed,false);
  assert.match(failed.transport.response.choices[0].message.content,/^```json/u);assert.equal(failed.api.result.audit,null);
});

test('arbitrary inputs, route drift and expired windows stop before model calls; provider failures never leak their bodies',async t=>{
  const sample=(await loadSemanticAuditFixtures())[0],f=await environment(t,{revision:4}),sent=[],worker=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({sent})});
  assert.equal((await worker.fetch(req(sample.id),f.env)).status,409);assert.equal(sent.length,0);
  for(const bad of [req(sample.id,{body:JSON.stringify({input:sample.input,key:'BODY_MUST_NOT_LEAK'})}),
    req(sample.id,{headers:{'X-Liubai-Evaluation-Run':RUN,Authorization:'HEADER_MUST_NOT_LEAK'}}),req('unknown_case'),new Request(`${AUDIT_ORIGIN}/api/ai/generate`,{method:'POST'})]){
    const response=await worker.fetch(bad,f.env);assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/BODY_MUST_NOT_LEAK|HEADER_MUST_NOT_LEAK/u);
  }
  assert.equal((await worker.fetch(req(sample.id),{...f.env,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START-AUDIT_TTL_MS)})).status,410);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
  const g=await environment(t),error=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({errorStatus:403})});
  const failed=await(await error.fetch(req(sample.id),g.env)).json();assert.equal(failed.transport.response,null);assert.equal(failed.api.result.audit,null);
  assert.doesNotMatch(JSON.stringify(failed),/PROVIDER_ERROR_MUST_NOT_LEAK/u);
});

test('client checks raw/compiled evidence and private envelope independently, and persists before every POST',async t=>{
  const f=await environment(t),worker=createSemanticAuditWorker({now:()=>START,fetchImpl:provider()}),first=(await loadSemanticAuditFixtures())[0].id;
  const report=await run(worker,f.env,{fetchImpl:async(url,init)=>{
    const response=await worker.fetch(new Request(url,init),f.env);if(url.endsWith('/health'))return response;
    const value=await response.json();if(value.caseId===first)value.api.result.audit.snapshotId='synthetic-forged-snapshot';return Response.json(value,{status:response.status});
  }});
  assert.equal(report.completedCaseCount,13);assert.equal(report.samples[0].calls.length,1);assert.equal(report.samples[0].calls[0].failure,'audit_evidence_or_output_rejected');
  assert.equal(report.clientStepAttempts,14);assert.equal(report.semanticTruth,'unverified');
  const g=await environment(t),sent=[],blocked=createSemanticAuditWorker({now:()=>START,fetchImpl:provider({sent})});
  await assert.rejects(run(blocked,g.env,{persist:value=>{if(value.clientStepAttempts===1)throw Error('synthetic-persist-failure');}}),/synthetic-persist-failure/u);
  assert.equal(sent.length,0);assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('audit-only scripts have no state imports, source digests include final inputs, and importing the CLI has no side effects',async()=>{
  const metadata=semanticAuditSourceMetadata(),files=metadata.sourceDigests.map(value=>value.file);
  assert.ok(files.includes('ai/experiments/clarity-semantic-audit.mjs'));assert.ok(files.includes('ai/fixtures/clarity-semantic-audit-fresh.mjs'));
  for(const name of ['worker','live'])assert.doesNotMatch(readFileSync(new URL(`./clarity-semantic-audit-${name}.mjs`,import.meta.url),'utf8'),/clarity-state\.mjs|applyClarityReply|saveClarityRecord/u);
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no-import-write');};globalThis.fetch=()=>{calls++;throw Error('no-import-fetch');};syncBuiltinESMExports();
  try{await import('./clarity-semantic-audit-live.mjs?import-check');await import('./clarity-semantic-audit-worker.mjs?import-check');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
