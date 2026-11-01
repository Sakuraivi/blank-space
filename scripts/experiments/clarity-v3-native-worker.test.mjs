import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {encryptKey} from '../../server/secrets.mjs';
import {handleApi} from '../../server/api.mjs';
import {getOrganizerRoute} from '../../ai/providers.mjs';
import {buildClarityModelRequest} from '../../ai/clarity-v3.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {NATIVE_LABEL,NATIVE_ORIGIN,NATIVE_TTL_MS,NATIVE_SOURCE,NATIVE_SLOT_IDS,prepareNativeFixture} from './clarity-v3-native-fixtures.mjs';
import {createNativeV3Worker} from './clarity-v3-native-worker.mjs';

const RUN='native_synthetic_run',START=1_790_000_000_000,SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY='synthetic-native-worker-key-never-real',SOURCE_SQL="SELECT * FROM organizer_config WHERE id = 'main'";
async function environment(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n'));
  const encrypted=await encryptKey(KEY,SECRET);db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(NATIVE_SOURCE.providerId,NATIVE_SOURCE.modelId,
    encrypted.encrypted_key,encrypted.iv,NATIVE_SOURCE.defaultRevision,START);
  const writes=[];
  return {db,writes,env:{LIUBAI_SECRET_KEY:SECRET,LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',
    DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},
      async run(){writes.push(sql);return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}}};
}
const request=(slotId,options={})=>new Request(`${NATIVE_ORIGIN}/evaluate/${slotId}`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},...options});
const call=async(worker,env,slotId)=>{const response=await worker.fetch(request(slotId),env);return {status:response.status,evidence:await response.json()};};
function raw(requestBody){
  const data=JSON.parse(requestBody.messages[1].content),review=data.context.stage==='review',sentence=data.grounding.sentences[0];
  return {modeId:'concern',goal:'先聊这件事',reply:'你说出的这些细节都可以先留在这里。',question:null,claims:review?
    [{type:'event',text:sentence.text,evidenceIds:[sentence.sourceId],derivation:'stated',supersedes:[]}]:[],finish:review,title:'照看花箱的安排'};
}
function provider({sent=[],fenced=false,status=200,produce=raw,onDispatch}={}){return async(endpoint,options)=>{
  assert.equal(endpoint,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body);sent.push(body);await onDispatch?.(body);
  if(status!==200)return Response.json({error:{code:'Arrearage',message:`${KEY} ERROR_MUST_NOT_LEAK`}},{status,headers:{'X-Key':KEY}});
  const content=JSON.stringify(produce(body));return Response.json({id:`chatcmpl-native-${sent.length}`,model:body.model,
    choices:[{finish_reason:'stop',unexpected:'CHOICE_MUST_NOT_LEAK',message:{content:fenced?'```json\n'+content+'\n```':content,reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
    usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'},authorization:KEY},{headers:{'X-Key':KEY}});
};}
function noSecrets(value){for(const secret of [KEY,SECRET,'REASONING_MUST_NOT_LEAK','USAGE_MUST_NOT_LEAK','CHOICE_MUST_NOT_LEAK','ERROR_MUST_NOT_LEAK'])assert.equal(JSON.stringify(value).includes(secret),false,secret);}
const route=()=>getOrganizerRoute({providerId:NATIVE_SOURCE.providerId,modelId:NATIVE_SOURCE.modelId,pricingMode:'manual',inputRate:null,outputRate:null,revision:NATIVE_SOURCE.defaultRevision});

test('six fixed slots use the unchanged public v3 contract and native API ledger without altering organizer configuration',async t=>{
  const f=await environment(t),before=f.db.prepare(SOURCE_SQL).get(),sent=[];
  const worker=createNativeV3Worker({now:()=>START,fetchImpl:provider({sent}),handleApiImpl:(req,env,options)=>{
    assert.equal(Object.hasOwn(options,'prepareClarityRun'),false);return handleApi(req,env,options);
  }});
  for(const slot of NATIVE_SLOT_IDS.filter(id=>id!=='stop')){
    const {status,evidence:e}=await call(worker,f.env,slot),seed=prepareNativeFixture(slot,RUN);
    assert.equal(status,200);assert.equal(e.label,NATIVE_LABEL);assert.equal(e.kind,'fixed_context_native_v3');assert.deepEqual(e.context,seed.context);
    assert.equal(e.api.result.status,'candidate',JSON.stringify(e.api));assert.equal(e.api.result.flow,'clarity-v3');
    assert.equal(e.api.result.schemaVersion,'liubai-clarity-2');assert.equal(e.hostRequest.policyVersion,'clarity-listening-1');assert.equal(e.hostRequest.schemaVersion,'liubai-clarity-2');
    assert.deepEqual(e.hostRequest.expectedContext,seed.context);assert.equal(e.transport.dispatches,1);assert.equal(e.transport.returnedModel,NATIVE_SOURCE.modelId);
    const expected=prepareProviderRequest(buildClarityModelRequest(seed.context,route().profile),route());
    assert.deepEqual(e.transport.request,JSON.parse(expected.body));assert.equal(e.transport.byteLength,expected.byteLength);
    assert.equal(e.transport.maximumBytes,12000);assert.equal(e.transport.maxOutputTokens,2000);
    assert.equal(e.sourceUnchanged,true);assert.equal(e.activeAfterGeneration,true);assert.equal(Object.hasOwn(e,'progress'),false);noSecrets(e);
  }
  assert.equal(sent.length,6);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE outcome='candidate' AND state='finished'").get().n,6);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started'").get().n,0);
  assert.deepEqual(f.db.prepare(SOURCE_SQL).get(),before);assert.ok(f.writes.every(sql=>!sql.includes('organizer_config')));
});

test('explicit stop remains a local control with no status, database, ledger or provider operation',async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('must-not-be-called');};
  const worker=createNativeV3Worker({now:()=>START,fetchImpl:forbidden,handleApiImpl:forbidden}),env={
    LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',DB:{prepare:forbidden}};
  const {status,evidence:e}=await call(worker,env,'stop');assert.equal(status,200);assert.deepEqual(e.context,prepareNativeFixture('stop',RUN).context);
  assert.deepEqual(e.localControl,prepareNativeFixture('stop',RUN).localControl);assert.equal(e.api,null);assert.equal(e.hostRequest,null);
  assert.equal(e.transport.dispatches,0);assert.equal(e.transport.request,null);assert.equal(e.transport.response,null);assert.equal(calls,0);
});

test('unknown slots, methods, bodies, auth, run mismatch and expired windows dispatch nothing',async t=>{
  const f=await environment(t),sent=[],worker=createNativeV3Worker({now:()=>START,fetchImpl:provider({sent})});
  const cases=[request('unregistered'),request('listen',{method:'GET'}),request('listen',{body:'{"prompt":"BODY_MUST_NOT_LEAK"}'}),
    request('listen',{headers:{Authorization:'Bearer MUST_NOT_LEAK','X-Liubai-Evaluation-Run':RUN}}),request('listen',{headers:{'X-Liubai-Evaluation-Run':'wrong'}}),
    new Request(`${NATIVE_ORIGIN}/evaluate/listen?model=other`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN}}),
    new Request(`${NATIVE_ORIGIN}/evaluate/listen`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN},body:new ReadableStream({start(){}}),duplex:'half'})];
  for(const req of cases){const response=await worker.fetch(req,f.env);assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/BODY_MUST_NOT_LEAK|MUST_NOT_LEAK/u);}
  const health=await worker.fetch(new Request(NATIVE_ORIGIN+'/health'),f.env);assert.deepEqual(await health.json(),{
    label:NATIVE_LABEL,runId:RUN,startedAt:START,expiresAt:START+NATIVE_TTL_MS,source:NATIVE_SOURCE,slots:NATIVE_SLOT_IDS});
  const expired=createNativeV3Worker({now:()=>START+NATIVE_TTL_MS,fetchImpl:provider({sent})});
  assert.equal((await expired.fetch(request('listen'),f.env)).status,410);
  assert.equal((await worker.fetch(request('listen'),{...f.env,LIUBAI_MATERIAL_EVAL_RUN_ID:'!'})).status,410);
  assert.equal((await worker.fetch(request('listen'),{...f.env,LIUBAI_DATA_MIGRATION_STATE:'pending'})).status,503);
  assert.equal(sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('each slot is attempted once; an instance restart still cannot bypass the native request ledger',async t=>{
  const f=await environment(t),sent=[],options={now:()=>START,fetchImpl:provider({sent})},worker=createNativeV3Worker(options);
  assert.equal((await call(worker,f.env,'listen')).evidence.transport.dispatches,1);
  const duplicate=await call(worker,f.env,'listen');assert.equal(duplicate.status,409);assert.equal(duplicate.evidence.reason,'duplicate_preview_slot');
  const restarted=await call(createNativeV3Worker(options),f.env,'listen');assert.equal(restarted.evidence.transport.dispatches,0);
  assert.equal(restarted.evidence.api.result.reason,'duplicate_request');assert.equal(sent.length,1);
});

test('source changes before reservation and during provider execution never become eligible observations',async t=>{
  const f=await environment(t),sent=[],worker=createNativeV3Worker({now:()=>START,fetchImpl:provider({sent}),handleApiImpl:async(req,env,options)=>{
    if(new URL(req.url).pathname==='/api/ai/generate')f.db.prepare("UPDATE organizer_config SET revision=revision+1 WHERE id='main'").run();
    return handleApi(req,env,options);
  }});
  const first=await call(worker,f.env,'listen');assert.equal(first.evidence.transport.dispatches,0);assert.equal(first.evidence.sourceUnchanged,false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);assert.equal(sent.length,0);
  const g=await environment(t),during=createNativeV3Worker({now:()=>START,fetchImpl:provider({sent,onDispatch:()=>{
    g.db.prepare("UPDATE organizer_config SET revision=revision+1 WHERE id='main'").run();
  }})});
  const second=await call(during,g.env,'listen');assert.equal(second.evidence.transport.dispatches,1);assert.equal(second.evidence.transport.httpStatus,200);
  assert.equal(second.evidence.sourceUnchanged,false);assert.equal(g.db.prepare(SOURCE_SQL).get().revision,4);
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,1);noSecrets(second.evidence);
});

test('fenced or permission-invalid native JSON remains an unmodified captured failure',async t=>{
  const f=await environment(t),fenced=createNativeV3Worker({now:()=>START,fetchImpl:provider({fenced:true})});
  const first=(await call(fenced,f.env,'listen')).evidence;assert.equal(first.api.result.status,'fallback');assert.equal(first.api.result.candidate,null);
  assert.match(first.transport.response.choices[0].message.content,/^```json/u);
  const g=await environment(t),invalid=createNativeV3Worker({now:()=>START,fetchImpl:provider({produce:body=>({...raw(body),question:{text:'这件事最让你介意的是什么？',target:'interpretation',evidenceIds:['u1']}})})});
  const second=(await call(invalid,g.env,'listen')).evidence;assert.equal(second.api.result.status,'fallback');assert.equal(second.api.result.reason,'question_not_allowed');
  assert.equal(JSON.parse(second.transport.response.choices[0].message.content).question.text,'这件事最让你介意的是什么？');assert.equal(second.transport.dispatches,1);
});

test('provider failure exports no error body, authentication, headers or reasoning text',async t=>{
  const f=await environment(t),worker=createNativeV3Worker({now:()=>START,fetchImpl:provider({status:400})});
  const e=(await call(worker,f.env,'listen')).evidence;assert.equal(e.transport.httpStatus,400);assert.equal(e.transport.response,null);
  assert.equal(e.api.result.reason,'provider_balance_low');assert.equal(e.transport.dispatches,1);noSecrets(e);
});

test('the unchanged v3 API rejects an explicit pause before reservation and provider dispatch',async t=>{
  const f=await environment(t),sent=[],worker=createNativeV3Worker({now:()=>START,fetchImpl:provider({sent}),handleApiImpl:async(req,env,options)=>{
    if(new URL(req.url).pathname!=='/api/ai/generate')return handleApi(req,env,options);
    const body=await req.json();body.session.statements.push({id:'u3',kind:'expression',text:'请暂停。'});body.revision++;
    return handleApi(new Request(req.url,{method:req.method,headers:req.headers,body:JSON.stringify(body)}),env,options);
  }});
  const e=(await call(worker,f.env,'listen')).evidence;assert.equal(e.api.result.status,'fallback');assert.equal(e.transport.dispatches,0);
  assert.equal(sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('expiry during a successful response is recorded as inactive without applying or saving it',async t=>{
  const f=await environment(t);let current=START;const worker=createNativeV3Worker({now:()=>current,fetchImpl:provider({onDispatch:()=>{current=START+NATIVE_TTL_MS;}})});
  const e=(await call(worker,f.env,'listen')).evidence;assert.equal(e.transport.dispatches,1);assert.equal(e.transport.response.choices.length,1);
  assert.equal(e.activeAfterGeneration,false);assert.equal(Object.hasOwn(e,'progress'),false);assert.equal(Object.hasOwn(e,'saved'),false);
});

test('worker import performs no network or filesystem mutations',async()=>{
  const fs=(await import('node:fs')).default,write=fs.writeFileSync,mkdir=fs.mkdirSync,fetch=globalThis.fetch;let calls=0,writes=0;
  fs.writeFileSync=fs.mkdirSync=()=>{writes++;throw Error('no-import-write');};globalThis.fetch=()=>{calls++;throw Error('no-import-network');};syncBuiltinESMExports();
  try{await import('./clarity-v3-native-worker.mjs?import-check');}
  finally{fs.writeFileSync=write;fs.mkdirSync=mkdir;globalThis.fetch=fetch;syncBuiltinESMExports();}
  assert.equal(calls,0);assert.equal(writes,0);
});
