import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {encryptKey} from '../../server/secrets.mjs';
import {handleApi} from '../../server/api.mjs';
import {MAX_RESPONSE_BYTES} from '../../ai/provider-transport.mjs';
import {isTrustedRoute as trustedRoute} from '../../ai/providers.mjs';
import {MODEL_COMPARISON_LABEL,MODEL_COMPARISON_ORIGIN,MODEL_COMPARISON_TTL_MS,MODEL_COMPARISON_SOURCE,MODEL_COMPARISON_ARMS,
  loadModelComparisonFixtures,modelComparisonOrder,prepareModelComparisonFixture,prepareModelComparison} from './clarity-model-comparison-fixtures.mjs';
import {createModelComparisonWorker,captureModelComparisonResponse} from './clarity-model-comparison-worker.mjs';

const RUN='model_synthetic_run',START=1_790_000_000_000,SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY='synthetic-model-comparison-key-never-real',SOURCE_SQL="SELECT * FROM organizer_config WHERE id = 'main'";
async function environment(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n'));
  const encrypted=await encryptKey(KEY,SECRET);db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(MODEL_COMPARISON_SOURCE.providerId,MODEL_COMPARISON_SOURCE.modelId,
    encrypted.encrypted_key,encrypted.iv,MODEL_COMPARISON_SOURCE.defaultRevision,START);
  const writes=[];
  return {db,writes,env:{LIUBAI_SECRET_KEY:SECRET,LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',
    DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},
      async run(){writes.push(sql);return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}}};
}
const request=(caseId,arm,options={})=>new Request(`${MODEL_COMPARISON_ORIGIN}/evaluate/${caseId}/${arm}`,
  {method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},...options});
const raw=()=>({reply:'先把已经说出的这部分留下。',title:'独立整理',claims:[]});
const withoutModel=body=>{const clone=structuredClone(body);delete clone.model;return clone;};
function provider({sent=[],fenced=false,status=200,metadata=false,onDispatch}={}){return async(endpoint,options)=>{
  assert.equal(endpoint,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body);sent.push(body);await onDispatch?.(body);
  if(status!==200)return Response.json({error:{code:'Arrearage',message:`${KEY} ERROR_MUST_NOT_LEAK`}},{status,headers:{'X-Key':KEY}});
  const content=JSON.stringify(raw());return Response.json({id:metadata?KEY:`chatcmpl-synthetic-${sent.length}`,model:metadata?KEY:body.model,
    choices:[{finish_reason:'stop',unexpected:'CHOICE_MUST_NOT_LEAK',message:{content:fenced?'```json\n'+content+'\n```':content,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
    usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_tokens_details:{cached_tokens:0,extra:'USAGE_MUST_NOT_LEAK'},
      completion_tokens_details:{reasoning_tokens:0,extra:'USAGE_MUST_NOT_LEAK'},extra:'USAGE_MUST_NOT_LEAK'},authorization:KEY},{headers:{'X-Key':KEY}});
};}
const evaluate=async(worker,env,caseId,arm)=>{const response=await worker.fetch(request(caseId,arm),env);return {status:response.status,evidence:await response.json()};};
function noSecrets(value){const text=JSON.stringify(value);for(const secret of [KEY,SECRET,'REASONING_MUST_NOT_LEAK','USAGE_MUST_NOT_LEAK','CHOICE_MUST_NOT_LEAK','ERROR_MUST_NOT_LEAK'])assert.equal(text.includes(secret),false,secret);}

test('all three trusted arms preserve fixed E/context/validator and differ only in actual transport model',async()=>{
  const samples=await loadModelComparisonFixtures();assert.equal(samples.length,8);let maximum=0;
  for(const [index,sample]of samples.entries()){
    const seeds=MODEL_COMPARISON_ARMS.map(arm=>prepareModelComparisonFixture(sample,RUN,START,arm.id));
    assert.deepEqual(seeds[0].context,seeds[1].context);assert.deepEqual(seeds[0].context,seeds[2].context);assert.equal(new Set(seeds.map(seed=>seed.ticket.requestId)).size,3);
    const comparison=await prepareModelComparison(seeds[0].context),bodies=MODEL_COMPARISON_ARMS.map(arm=>JSON.parse(comparison.arms[arm.id].transport.body));
    assert.deepEqual(withoutModel(bodies[0]),withoutModel(bodies[1]));assert.deepEqual(withoutModel(bodies[0]),withoutModel(bodies[2]));
    assert.deepEqual(modelComparisonOrder(index),MODEL_COMPARISON_ARMS.map(arm=>arm.id).slice(index%3).concat(MODEL_COMPARISON_ARMS.map(arm=>arm.id).slice(0,index%3)));
    for(const [armIndex,arm]of MODEL_COMPARISON_ARMS.entries()){
      const selected=comparison.arms[arm.id];assert.equal(trustedRoute(selected.route),true);assert.equal(selected.route.maxRequestBytes,12000);
      assert.equal(bodies[armIndex].max_completion_tokens,2000);assert.equal(bodies[armIndex].enable_thinking,false);
      maximum=Math.max(maximum,selected.transport.byteLength);assert.deepEqual(selected.prepared.validateSelection(raw(),seeds[armIndex].context).candidate,
        comparison.arms.reference.prepared.validateSelection(raw(),seeds[0].context).candidate);
    }
    assert.equal(comparison.control.onlyModelDifference,true);assert.equal(comparison.control.outputFormat,'json_text');
  }
  assert.ok(maximum<=12000);
});

test('actual API writes twenty-four candidate ledger rows without changing real organizer configuration',async t=>{
  const f=await environment(t),before=f.db.prepare(SOURCE_SQL).get(),sent=[],worker=createModelComparisonWorker({now:()=>START,fetchImpl:provider({sent})}),samples=await loadModelComparisonFixtures();
  const all=[];
  for(const [index,sample]of samples.entries())for(const arm of modelComparisonOrder(index)){
    const call=await evaluate(worker,f.env,sample.id,arm),e=call.evidence;all.push(e);
    assert.equal(call.status,200);assert.equal(e.kind,'fixed_examples_model_arm');assert.equal(e.label,MODEL_COMPARISON_LABEL);assert.equal(e.arm,arm);
    assert.deepEqual(e.context,sample.context);assert.deepEqual(e.source,MODEL_COMPARISON_SOURCE);assert.equal(e.control.onlyModelDifference,true);
    assert.equal(e.transport.dispatches,1);assert.equal(e.transport.requestedModel,e.route.modelId);assert.equal(e.transport.returnedModel,e.route.modelId);
    assert.equal(e.transport.response.model,e.route.modelId);assert.match(e.transport.response.id,/^chatcmpl-/u);
    assert.equal(e.api.httpStatus,200);assert.equal(e.api.result.status,'candidate',JSON.stringify(e));assert.deepEqual(e.api.result.route,e.route);
    assert.equal(e.api.result.schemaVersion,'liubai-clarity-1');assert.equal(e.hostRequest.schemaVersion,'liubai-material-retention-3');
    assert.equal(e.progress.applied,true);assert.equal(e.progress.maySave,true);assert.deepEqual(e.progress.retentionVisibility,{status:'visible',allVisible:true});noSecrets(e);
  }
  assert.equal(sent.length,24);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='finished' AND outcome='candidate'").get().n,24);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started'").get().n,0);
  for(const arm of MODEL_COMPARISON_ARMS)assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests WHERE model_id = ?').get(arm.modelId).n,8);
  assert.deepEqual(f.db.prepare(SOURCE_SQL).get(),before);assert.ok(f.writes.every(sql=>!sql.includes('organizer_config')));
  assert.ok(f.db.prepare("SELECT price_version FROM pilot_requests LIMIT 1").get().price_version.startsWith('organizer-unpriced-r3'));
  for(let i=0;i<all.length;i+=3){assert.deepEqual(withoutModel(all[i].transport.request),withoutModel(all[i+1].transport.request));assert.deepEqual(withoutModel(all[i].transport.request),withoutModel(all[i+2].transport.request));}
});

test('unknown arm, input body, query, auth, wrong run, expired window and unknown case dispatch nothing',async t=>{
  const f=await environment(t),sent=[],worker=createModelComparisonWorker({now:()=>START,fetchImpl:provider({sent})}),sample=(await loadModelComparisonFixtures())[0];
  const cases=[request(sample.id,'other'),request('missing_case','max'),request(sample.id,'max',{body:'{"prompt":"BODY_MUST_NOT_LEAK"}'}),
    request(sample.id,'max',{headers:{Authorization:'Bearer MUST_NOT_LEAK','X-Liubai-Evaluation-Run':RUN}}),
    request(sample.id,'max',{headers:{'X-Liubai-Evaluation-Run':'other_run'}}),
    new Request(`${MODEL_COMPARISON_ORIGIN}/evaluate/${sample.id}/max?model=custom`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN}})];
  for(const req of cases){const response=await worker.fetch(req,f.env);assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/BODY_MUST_NOT_LEAK|MUST_NOT_LEAK/u);}
  const health=await worker.fetch(new Request(MODEL_COMPARISON_ORIGIN+'/health'),f.env);assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{label:MODEL_COMPARISON_LABEL,runId:RUN,startedAt:START,expiresAt:START+MODEL_COMPARISON_TTL_MS});
  const expired=createModelComparisonWorker({now:()=>START+MODEL_COMPARISON_TTL_MS,fetchImpl:provider({sent})});
  assert.equal((await expired.fetch(request(sample.id,'max'),f.env)).status,410);
  assert.equal((await worker.fetch(request(sample.id,'max'),{...f.env,LIUBAI_DATA_MIGRATION_STATE:'pending'})).status,503);
  assert.equal(sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('source change before reservation is not hidden by the model view and cannot dispatch or write a ledger row',async t=>{
  const f=await environment(t),sent=[],worker=createModelComparisonWorker({now:()=>START,fetchImpl:provider({sent}),handleApiImpl:async(req,env,options)=>{
    if(new URL(req.url).pathname==='/api/ai/generate')f.db.prepare("UPDATE organizer_config SET revision = revision + 1 WHERE id='main'").run();
    return handleApi(req,env,options);
  }}),sample=(await loadModelComparisonFixtures())[0];
  const {evidence:e}=await evaluate(worker,f.env,sample.id,'max');assert.equal(e.transport.dispatches,0);assert.equal(e.progress.applied,false);
  assert.equal(e.progress.stopReason,'source_changed');assert.equal(e.api.result.status,'fallback');assert.equal(sent.length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);assert.equal(f.db.prepare(SOURCE_SQL).get().revision,4);
});

test('source change during provider execution cannot apply the native output or restore the old config',async t=>{
  const f=await environment(t),sent=[],worker=createModelComparisonWorker({now:()=>START,fetchImpl:provider({sent,onDispatch:()=>{
    f.db.prepare("UPDATE organizer_config SET model_id='qwen3.8-flash', revision=revision+1 WHERE id='main'").run();
  }})}),sample=(await loadModelComparisonFixtures())[0];
  const {evidence:e}=await evaluate(worker,f.env,sample.id,'max');assert.equal(e.transport.dispatches,1);assert.equal(e.transport.httpStatus,200);
  assert.equal(e.progress.applied,false);assert.equal(e.progress.maySave,false);assert.equal(e.progress.stopReason,'source_changed');
  assert.equal(f.db.prepare(SOURCE_SQL).get().revision,4);assert.equal(f.db.prepare(SOURCE_SQL).get().model_id,'qwen3.8-flash');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);assert.equal(sent.length,1);noSecrets(e);
});

test('native fences and provider rejection remain failures, duplicate identity prevents a second model request',async t=>{
  const f=await environment(t),sent=[],sample=(await loadModelComparisonFixtures())[0],worker=createModelComparisonWorker({now:()=>START,fetchImpl:provider({sent,fenced:true})});
  const {evidence:first}=await evaluate(worker,f.env,sample.id,'flash');assert.equal(first.api.result.status,'fallback');assert.equal(first.progress.applied,false);
  assert.match(first.transport.response.choices[0].message.content,/^```json/u);assert.equal(first.transport.response.model,'qwen3.8-flash');
  const {evidence:duplicate}=await evaluate(worker,f.env,sample.id,'flash');assert.equal(duplicate.transport.dispatches,0);assert.equal(duplicate.api.httpStatus,429);
  assert.equal(duplicate.api.result.reason,'duplicate_request');assert.equal(sent.length,1);
  const g=await environment(t),rejected=createModelComparisonWorker({now:()=>START,fetchImpl:provider({status:400})});
  const {evidence:error}=await evaluate(rejected,g.env,sample.id,'max');assert.equal(error.transport.dispatches,1);assert.equal(error.transport.httpStatus,400);
  assert.equal(error.transport.response,null);assert.equal(error.transport.returnedModel,null);assert.equal(error.progress.applied,false);
  assert.equal(error.api.result.reason,'provider_balance_low');noSecrets(error);
});

test('shared unsafe usage still finishes as error and stops later default inference without clearing the ledger',async t=>{
  const f=await environment(t),sample=(await loadModelComparisonFixtures())[0];let dispatches=0;
  const worker=createModelComparisonWorker({now:()=>START,fetchImpl:async(_url,options)=>{
    dispatches++;const body=JSON.parse(options.body);return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw())}}],
      usage:{prompt_tokens:100,completion_tokens:2001,total_tokens:2101}});
  }});
  const {evidence:first}=await evaluate(worker,f.env,sample.id,'max');assert.equal(first.transport.dispatches,1);assert.equal(first.progress.applied,false);
  assert.equal(first.api.result.reason,'usage_out_of_bounds');assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE outcome='error'").get().n,1);
  const stopped=await evaluate(worker,f.env,sample.id,'reference');assert.equal(stopped.status,409);assert.equal(stopped.evidence.reason,'default_route_mismatch');
  assert.equal(dispatches,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);
});

test('capture preserves actual content, numeric usage and bounded safe metadata without error/header/reasoning leakage',async()=>{
  const content=JSON.stringify(raw()),response=Response.json({id:'chatcmpl-safe-id',model:'qwen3.8-flash-1030',choices:[{finish_reason:'stop',message:{content,reasoning_content:KEY}}],
    usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3,completion_tokens_details:{reasoning_tokens:0,secret:KEY},extra:KEY},api_key:KEY},{headers:{Authorization:KEY}});
  const captured=await captureModelComparisonResponse(response);assert.equal(captured.id,'chatcmpl-safe-id');assert.equal(captured.model,'qwen3.8-flash-1030');
  assert.equal(captured.choices[0].message.content,content);assert.deepEqual(captured.usage,{prompt_tokens:1,completion_tokens:2,total_tokens:3,completion_tokens_details:{reasoning_tokens:0}});noSecrets(captured);
  const alias=await captureModelComparisonResponse(Response.json({id:'chatcmpl-max-alias',model:'qwen3.8-max-2026-09-02',choices:[],usage:{}}));
  assert.equal(alias.model,'qwen3.8-max-2026-09-02');noSecrets(alias);
  const unknown=await captureModelComparisonResponse(Response.json({id:KEY,model:KEY,choices:[],usage:{}}));assert.equal(unknown.id,null);assert.equal(unknown.model,null);noSecrets(unknown);
  assert.equal(await captureModelComparisonResponse(Response.json({error:{message:KEY}},{status:403})),null);
  const stopped=new AbortController();stopped.abort();assert.equal(await captureModelComparisonResponse(Response.json({}),{signal:stopped.signal}),null);
  assert.equal(await captureModelComparisonResponse(new Response('x'.repeat(MAX_RESPONSE_BYTES+1))),null);
  assert.equal(await captureModelComparisonResponse(new Response(new Uint8Array([0xff]))),null);
  const emptyStream=new ReadableStream({start(controller){for(let i=0;i<9;i++)controller.enqueue(new Uint8Array(0));controller.close();}});
  assert.equal(await captureModelComparisonResponse(new Response(emptyStream)),null);
  const stalled=new ReadableStream({start(){}});assert.equal(await captureModelComparisonResponse(new Response(stalled),{timeoutMs:5}),null);
});

test('worker import has no network or filesystem mutations',async()=>{
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no-import-write');};globalThis.fetch=()=>{calls++;throw Error('no-import-network');};syncBuiltinESMExports();
  try{await import('./clarity-model-comparison-worker.mjs?import-check');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
