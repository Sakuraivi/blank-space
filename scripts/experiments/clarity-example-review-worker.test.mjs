// Controlled transport/state tests, never scores for few-shot quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {encryptKey} from '../../server/secrets.mjs';
import {getPersonalRoute,isTrustedRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {EXAMPLE_REVIEW_BLOCK,EXAMPLE_REVIEW_POLICY} from '../../ai/experiments/clarity-example-review.mjs';
import {EXAMPLE_LABEL,EXAMPLE_ORIGIN,EXAMPLE_ROUTE,loadExampleReviewFixtures,exampleArmOrder,prepareExampleFixture,prepareExamplePair} from './clarity-example-review-fixtures.mjs';
import {createExampleReviewWorker} from './clarity-example-review-worker.mjs';
import {runExampleReviewEvaluation,exampleReviewSourceMetadata} from './clarity-example-review-live.mjs';
const RUN='example_synthetic_run',START=1_790_000_000_000,SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY='synthetic-example-test-key-never-real',route=getPersonalRoute(EXAMPLE_ROUTE.providerId,EXAMPLE_ROUTE.modelId);
const request=(id,arm,options={})=>new Request(`${EXAMPLE_ORIGIN}/evaluate/${id}/${arm}`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},...options});
async function environment(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n'));
  const encrypted=await encryptKey(KEY,SECRET);db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(EXAMPLE_ROUTE.providerId,EXAMPLE_ROUTE.modelId,encrypted.encrypted_key,encrypted.iv,EXAMPLE_ROUTE.defaultRevision,START);
  return {db,env:{LIUBAI_SECRET_KEY:SECRET,LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',
    DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},
      async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}}};
}
const raw=()=>({reply:'先把已经说出的这部分留下。',title:'独立整理',claims:[]});
function provider({sent=[],failFirst=false,fenced=false}={}){return async(endpoint,options)=>{
  assert.equal(endpoint,route.endpoint);const body=JSON.parse(options.body);sent.push(body);const output=raw();if(failFirst&&sent.length===1)output.unsupported='synthetic-invalid-first-arm';
  const text=JSON.stringify(output);return Response.json({choices:[{finish_reason:'stop',message:{content:fenced?'```json\n'+text+'\n```':text,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
    usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'}});
};}
const evaluate=(worker,env,options={})=>runExampleReviewEvaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:(url,init)=>worker.fetch(new Request(url,init),env),...options});
function removeSystem(body){const value=structuredClone(body);delete value.messages[0].content;return value;}
function noPrivate(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  assert.equal(['focus','anchorId','anchorIds','exampleBlock','pairControl','instruction','selectionTrace','snapshotId'].includes(key),false);noPrivate(item);}}

test('all eight pairs have independent states/tickets, balanced order and exactly one fixed instruction difference with unchanged validators',async()=>{
  const samples=await loadExampleReviewFixtures();assert.equal(samples.length,8);let baselineFirst=0,examplesFirst=0;
  for(const [index,sample] of samples.entries()){
    const order=exampleArmOrder(index);if(order[0]==='baseline')baselineFirst++;else examplesFirst++;
    const b=prepareExampleFixture(sample,RUN,START,'baseline'),e=prepareExampleFixture(sample,RUN,START,'examples');
    assert.notEqual(b.session,e.session);assert.notEqual(b.session.statements,e.session.statements);assert.notEqual(b.session.claims,e.session.claims);assert.notEqual(b.session.pending,e.session.pending);
    assert.notEqual(b.ticket.requestId,e.ticket.requestId);assert.match(b.ticket.requestId,/^example1_/u);assert.deepEqual(b.context,e.context);assert.deepEqual(b.context,sample.context);
    b.session.review={title:'baseline-only',blocks:[]};assert.equal(e.session.review,null);assert.equal(e.session.pending.requestId,e.ticket.requestId);
    const pair=await prepareExamplePair(b.context,route.profile),bb=JSON.parse(prepareProviderRequest(pair.baseline.requestData,route).body),eb=JSON.parse(prepareProviderRequest(pair.examples.requestData,route).body);
    assert.equal(eb.messages[0].content,bb.messages[0].content+EXAMPLE_REVIEW_BLOCK);assert.deepEqual(removeSystem(bb),removeSystem(eb));
    assert.deepEqual(pair.baseline.requestData.input,pair.examples.requestData.input);assert.deepEqual(pair.baseline.requestData.output,pair.examples.requestData.output);
    const bc=pair.baseline.validateSelection(raw(),b.context),ec=pair.examples.validateSelection(raw(),e.context);assert.equal(bc.ok,true);assert.equal(ec.ok,true);assert.deepEqual(bc.candidate,ec.candidate);
    const invalid={...raw(),unexpected:true};assert.deepEqual(pair.baseline.validateSelection(invalid,b.context),pair.examples.validateSelection(invalid,e.context));
    assert.equal(bb.max_completion_tokens,2000);assert.equal(eb.max_completion_tokens,2000);
  }
  assert.equal(baselineFirst,4);assert.equal(examplesFirst,4);
});

test('actual API registers sixteen candidate ledger rows in the declared order and saves independent raw-matched records',async t=>{
  const f=await environment(t),sent=[],snapshots=[],urls=[],worker=createExampleReviewWorker({now:()=>START,fetchImpl:provider({sent})});
  const report=await evaluate(worker,f.env,{persist:value=>snapshots.push(value),fetchImpl:(url,init)=>{
    if(!url.endsWith('/health')){assert.equal(snapshots.at(-1).clientStepAttempts,urls.length+1);urls.push(url);}return worker.fetch(new Request(url,init),f.env);
  }});
  assert.equal(snapshots[0].registeredAttempts.length,16);assert.equal(report.clientStepAttempts,16);assert.equal(report.modelDispatchesObserved,16);assert.equal(sent.length,16);
  assert.equal(report.completedPairCount,8);assert.equal(report.completedArmCount,16);assert.equal(report.memorySavedArmCount,16);
  assert.deepEqual(urls,report.registeredAttempts.map(value=>`${EXAMPLE_ORIGIN}/evaluate/${value.caseId}/${value.arm}`));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='finished' AND outcome='candidate'").get().n,16);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started'").get().n,0);
  for(const pair of report.pairs){
    const b=pair.arms.baseline.calls[0],e=pair.arms.examples.calls[0];assert.deepEqual(b.context,e.context);
    assert.deepEqual(removeSystem(b.evidence.transport.request),removeSystem(e.evidence.transport.request));
    assert.equal(e.evidence.transport.request.messages[0].content,b.evidence.transport.request.messages[0].content+EXAMPLE_REVIEW_BLOCK);
    for(const arm of [b,e]){assert.ok(arm.verification.nativeRawCompiledMatched&&arm.verification.actualStateApplied);assert.equal(arm.stateVerification.allActiveMaterialVisible,true);
      assert.equal(arm.evidence.hostRequest.schemaVersion,'liubai-material-retention-3');assert.equal(arm.evidence.api.result.schemaVersion,'liubai-clarity-1');
      noPrivate(arm.evidence.api.result.candidate);noPrivate(arm.stateVerification.savedRecord);}
    assert.equal(e.evidence.api.result.policyVersion,EXAMPLE_REVIEW_POLICY);
  }
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');assert.equal(isTrustedRoute(route),true);assert.equal(route.maxRequestBytes,12000);
  assert.doesNotMatch(JSON.stringify(snapshots),new RegExp(`${KEY}|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK`,'u'));
  t.diagnostic(JSON.stringify({calls:sent.length,baselineFirst:4,examplesFirst:4,maxBodyBytes:Math.max(...sent.map(body=>new TextEncoder().encode(JSON.stringify(body)).byteLength)),routeMaxRequestBytes:route.maxRequestBytes}));
});

test('a failed first arm still executes the other pre-registered arm once with its original source and no retry',async t=>{
  const f=await environment(t),sent=[],worker=createExampleReviewWorker({now:()=>START,fetchImpl:provider({sent,failFirst:true})}),report=await evaluate(worker,f.env);
  assert.equal(report.clientStepAttempts,16);assert.equal(report.modelDispatchesObserved,16);assert.equal(sent.length,16);assert.equal(report.retries,0);
  const first=report.pairs[0];assert.deepEqual(first.order,['baseline','examples']);assert.equal(first.arms.baseline.complete,false);assert.equal(first.arms.examples.complete,true);
  assert.equal(first.arms.baseline.calls.length,1);assert.equal(first.arms.examples.calls.length,1);assert.equal(first.arms.baseline.calls[0].verification.runtimeRejectionMatched,true);
  assert.deepEqual(first.arms.baseline.calls[0].context,first.arms.examples.calls[0].context);assert.equal(sent[0].messages[1].content,sent[1].messages[1].content);
  assert.equal(sent[1].messages[1].content.includes('synthetic-invalid-first-arm'),false);assert.equal(report.memorySavedArmCount,15);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE outcome='fallback'").get().n,1);
});

test('failed persistence prevents POST and candidate drift rejects just that arm before saving',async t=>{
  const f=await environment(t),sent=[],blocked=createExampleReviewWorker({now:()=>START,fetchImpl:provider({sent})});
  await assert.rejects(evaluate(blocked,f.env,{persist:value=>{if(value.clientStepAttempts===1)throw Error('synthetic-persist-failure');}}),/synthetic-persist-failure/u);
  assert.equal(sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
  const g=await environment(t),worker=createExampleReviewWorker({now:()=>START,fetchImpl:provider()}),first=(await loadExampleReviewFixtures())[0].id;
  const report=await evaluate(worker,g.env,{fetchImpl:async(url,init)=>{const response=await worker.fetch(new Request(url,init),g.env);if(url.endsWith('/health'))return response;
    const value=await response.json();if(value.caseId===first&&value.arm==='baseline')value.api.result.candidate.title='synthetic-forged-title';return Response.json(value,{status:response.status});}});
  assert.equal(report.completedArmCount,15);assert.equal(report.pairs[0].arms.baseline.calls[0].verification.actualStateApplied,false);assert.equal(report.pairs[0].arms.examples.complete,true);
});

test('only fixed URL arms are accepted, environment prompts cannot change the body and native fences stay failures',async t=>{
  const f=await environment(t),sent=[],worker=createExampleReviewWorker({now:()=>START,fetchImpl:provider({sent})}),sample=(await loadExampleReviewFixtures())[0];
  for(const req of [request(sample.id,'custom'),request(sample.id,'examples',{body:JSON.stringify({prompt:'BODY_MUST_NOT_LEAK',variant:'custom'})})]){
    const response=await worker.fetch(req,f.env);assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/BODY_MUST_NOT_LEAK/u);
  }
  assert.equal(sent.length,0);const value=await(await worker.fetch(request(sample.id,'examples'),{...f.env,LIUBAI_EXAMPLE_PROMPT:'ENV_MUST_NOT_LEAK',LIUBAI_EXAMPLE_VARIANT:'baseline'})).json();
  assert.equal(value.arm,'examples');assert.equal(value.api.result.policyVersion,EXAMPLE_REVIEW_POLICY);assert.doesNotMatch(JSON.stringify(value.transport.request),/ENV_MUST_NOT_LEAK/u);
  const duplicate=await(await worker.fetch(request(sample.id,'examples'),f.env)).json();assert.equal(duplicate.api.httpStatus,429);assert.equal(duplicate.transport.dispatches,0);assert.equal(sent.length,1);
  const g=await environment(t),fenced=createExampleReviewWorker({now:()=>START,fetchImpl:provider({fenced:true})});
  const failed=await(await fenced.fetch(request(sample.id,'baseline'),g.env)).json();assert.equal(failed.api.result.status,'fallback');assert.equal(failed.progress.applied,false);
  assert.match(failed.transport.response.choices[0].message.content,/^```json/u);
});

test('frozen source metadata covers examples and inherited guards, and importing the CLI has no network or writes',async()=>{
  const files=exampleReviewSourceMetadata().sourceDigests.map(value=>value.file);
  for(const path of ['ai/experiments/clarity-review-examples.mjs','ai/experiments/clarity-example-review.mjs','ai/experiments/clarity-faithful-dialogue.mjs',
    'ai/experiments/clarity-materials.mjs','ai/experiments/clarity-duration-source.mjs','scripts/experiments/clarity-semantic-audit-worker.mjs'])assert.ok(files.includes(path));
  const worker=readFileSync(new URL('./clarity-example-review-worker.mjs',import.meta.url),'utf8');assert.match(worker,/captureSemanticAuditResponse/u);assert.doesNotMatch(worker,/checkFocus|prepareRelationPlanRun|focusCheck/u);
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no-import-write');};globalThis.fetch=()=>{calls++;throw Error('no-import-network');};syncBuiltinESMExports();
  try{await import('./clarity-example-review-live.mjs?import-check');await import('./clarity-example-review-worker.mjs?import-check');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
