// Run after policy freeze and final fixture installation. Null-focus stubs
// establish engineering behavior, never the semantic success of a relation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encryptKey} from '../../server/secrets.mjs';
import {getPersonalRoute,isTrustedRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {applyClarityReply,editClarityBlock,saveClarityRecord,readRecordEntries,RECORD_STORE} from '../../public/clarity-state.mjs';
import {prepareRelationPlanRun,RELATION_PLAN_SCHEMA} from '../../ai/experiments/clarity-relation-plan.mjs';
import {RELATION_LABEL,RELATION_ORIGIN,RELATION_ROUTE,loadRelationPlanFixtures,prepareRelationFixture} from './clarity-relation-plan-fixtures.mjs';
import {createRelationPlanWorker} from './clarity-relation-plan-worker.mjs';
import {runRelationPlanEvaluation,relationPlanSourceMetadata} from './clarity-relation-plan-live.mjs';
const RUN='relation_synthetic_run',START=1_790_000_000_000,SECRET='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY='synthetic-relation-test-key-never-real',route=getPersonalRoute(RELATION_ROUTE.providerId,RELATION_ROUTE.modelId);
const req=id=>new Request(`${RELATION_ORIGIN}/evaluate/${id}`,{method:'POST',headers:{'X-Liubai-Evaluation-Run':RUN}});
const raw=()=>({reply:'先把这次已经说出的部分留下。',title:'合成整理',focus:null,claims:[]});
async function environment(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(readdirSync(new URL('../../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()
    .map(name=>readFileSync(new URL(`../../drizzle/${name}`,import.meta.url),'utf8')).join('\n'));
  const encrypted=await encryptKey(KEY,SECRET);db.prepare(`INSERT INTO organizer_config
    (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
    VALUES ('main',?,?,'manual',NULL,NULL,NULL,NULL,?,?,1,?,?)`).run(RELATION_ROUTE.providerId,RELATION_ROUTE.modelId,encrypted.encrypted_key,encrypted.iv,RELATION_ROUTE.defaultRevision,START);
  return {db,env:{LIUBAI_SECRET_KEY:SECRET,LIUBAI_MATERIAL_EVAL_RUN_ID:RUN,LIUBAI_MATERIAL_EVAL_STARTED_AT:String(START),LIUBAI_DATA_MIGRATION_STATE:'verified',
    DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},
      async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}}}};
}
function provider({sent=[],mutate}={}){return async(endpoint,options)=>{
  assert.equal(endpoint,route.endpoint);const body=JSON.parse(options.body);sent.push(body);const output=raw();if(mutate)mutate(output,JSON.parse(body.messages[1].content));
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output),reasoning_content:'REASONING_MUST_NOT_LEAK'}}],
    usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,extra:'USAGE_MUST_NOT_LEAK'}});
};}
const evaluate=(worker,env,options={})=>runRelationPlanEvaluation({runId:RUN,now:()=>START,persist:()=>{},fetchImpl:(url,init)=>worker.fetch(new Request(url,init),env),...options});
function assertNoPlan(value){if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  assert.equal(['focus','anchorId','anchorIds','focusTrace','selectionTrace','snapshotId'].includes(key),false);assertNoPlan(item);}}

test('eight controlled review contexts rebuild real tickets exactly and keep criteria/case labels out of model requests',async()=>{
  const samples=await loadRelationPlanFixtures();assert.equal(samples.length,8);assert.equal(samples.filter(sample=>sample.group==='known').length,4);
  for(const sample of samples){const seeded=prepareRelationFixture(sample,RUN,START);assert.deepEqual(seeded.context,sample.context);
    assert.match(seeded.ticket.requestId,/^relation1_/u);assert.equal(seeded.session.pending.requestId,seeded.ticket.requestId);
    const prepared=await prepareRelationPlanRun(seeded.context,route.profile),data=JSON.parse(prepared.requestData.input.content);
    assert.equal(prepared.requestData.schemaVersion,RELATION_PLAN_SCHEMA);assert.doesNotMatch(JSON.stringify(data),/expectedRelation|requirements|forbiddenAdditions|"origin"|"sessionId"/u);
    for(const value of samples)assert.equal(JSON.stringify(data).includes(value.id),false);assert.ok(prepareProviderRequest(prepared.requestData,route).byteLength<=12000);
  }
});

test('actual handleApi bills eight candidate outcomes and client applies, preserves all literal text, saves and deep-reads records',async t=>{
  const f=await environment(t),sent=[],snapshots=[],worker=createRelationPlanWorker({now:()=>START,fetchImpl:provider({sent})});
  const report=await evaluate(worker,f.env,{persist:value=>snapshots.push(value),fetchImpl:(url,init)=>{
    if(!url.endsWith('/health'))assert.equal(snapshots.at(-1).clientStepAttempts,sent.length+1);return worker.fetch(new Request(url,init),f.env);
  }});
  assert.equal(report.clientStepAttempts,8);assert.equal(report.modelDispatchesObserved,8);assert.equal(report.completedCaseCount,8);assert.equal(report.memorySavedCaseCount,8);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='finished' AND outcome='candidate'").get().n,8);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pilot_requests WHERE state='started'").get().n,0);
  for(const sample of report.samples){const call=sample.calls[0];assert.ok(call.verification.nativeRawCompiledMatched&&call.verification.actualStateApplied);
    assert.equal(call.evidence.label,RELATION_LABEL);assert.equal(call.evidence.hostRequest.schemaVersion,RELATION_PLAN_SCHEMA);assert.equal(call.evidence.api.result.schemaVersion,'liubai-clarity-1');
    assert.deepEqual(Object.keys(call.evidence.api.result.candidate).sort(),['modeId','goal','reply','question','claims','finish','title'].sort());
    assert.equal(call.stateVerification.allActiveMaterialVisible,true);assertNoPlan(call.evidence.api.result.candidate);assertNoPlan(call.stateVerification.savedRecord);
  }
  assert.equal(report.semanticReview,'pending_manual_review');assert.equal(report.contentReleaseGate,'not_met');assert.equal(isTrustedRoute(route),true);assert.equal(route.maxRequestBytes,12000);
  assert.doesNotMatch(JSON.stringify(snapshots),new RegExp(`${KEY}|AAECAwQF|REASONING_MUST_NOT_LEAK|USAGE_MUST_NOT_LEAK`,'u'));
  t.diagnostic(JSON.stringify({calls:sent.length,maxBodyBytes:Math.max(...sent.map(body=>new TextEncoder().encode(JSON.stringify(body)).byteLength)),routeMaxRequestBytes:route.maxRequestBytes}));
});

test('literal synthetic focus survives compilation and saving; duplicate, missing and unknown-anchor plans reject through the actual API',async t=>{
  const context={sessionId:'local_relation_context',revision:1,stage:'review',allowNextStep:false,modeId:'concern',goal:'理清这次安排',
    statements:[{id:'u1',kind:'expression',text:'我想保留学画的时间，又怕拒绝后见面尴尬。'}],dialogue:[],claims:[]};
  const sample={id:'LOCAL_RELATION',context},seeded=prepareRelationFixture(sample,RUN,START),prepared=await prepareRelationPlanRun(seeded.context,route.profile);
  const data=JSON.parse(prepared.requestData.input.content),anchor=data.materials[0].id,left='想保留学画的时间',right='怕拒绝后见面尴尬';
  const value={...raw(),focus:{left:{anchorId:anchor,quote:left},right:{anchorId:anchor,quote:right}},claims:[{type:'insight',text:`我${left}，也${right}。`,anchorIds:[anchor]}]};
  assert.equal(prepared.checkFocus(value).ok,true);const checked=prepared.validateSelection(value,seeded.context);assert.equal(checked.ok,true);
  assert.equal(applyClarityReply(seeded.session,seeded.ticket,{flow:'clarity-v2',status:'candidate',requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,candidate:checked.candidate}).ok,true);
  const values=new Map(),saved=saveClarityRecord(seeded.session,{getItem:key=>values.get(key)??null,setItem:(key,item)=>values.set(key,item)});assert.equal(saved.ok,true);
  const reopened=readRecordEntries({getItem:key=>new Map(JSON.parse(JSON.stringify([...values]))).get(key)??null})[0].record;assert.deepEqual(reopened,saved.record);assertNoPlan(reopened);
  assert.equal(JSON.parse(values.get(RECORD_STORE))[0].review.blocks.some(block=>block.text?.includes(left)&&block.text?.includes(right)),true);
  const target=(await loadRelationPlanFixtures())[0];
  for(const kind of ['duplicate','missing','unknown']){
    const f=await environment(t),sent=[],worker=createRelationPlanWorker({now:()=>START,fetchImpl:provider({sent,mutate:(output,input)=>{
      const unit=input.materials[0],quote=Array.from(unit.text).slice(0,8).join('');
      output.focus={left:{anchorId:unit.id,quote},right:{anchorId:kind==='unknown'?'m999':unit.id,quote}};
      if(kind==='missing')delete output.focus.right;
      output.claims=[{type:'insight',text:quote,anchorIds:[unit.id]}];
    }})});
    const result=await(await worker.fetch(req(target.id),f.env)).json();assert.equal(result.api.result.status,'fallback',kind);assert.equal(result.api.result.candidate,null);
    assert.equal(result.progress.applied,false);assert.equal(result.progress.maySave,false);assert.equal(result.focusCheck.ok,false);assert.equal(sent.length,1);
  }
});

test('shared bounded capture is imported and a hanging stream fails closed promptly without another model call',async t=>{
  assert.match(readFileSync(new URL('./clarity-relation-plan-worker.mjs',import.meta.url),'utf8'),/import \{captureSemanticAuditResponse\} from '\.\/clarity-semantic-audit-worker\.mjs'/u);
  const f=await environment(t),sample=(await loadRelationPlanFixtures())[0];let calls=0;
  const worker=createRelationPlanWorker({now:()=>START,captureTimeoutMs:5,fetchImpl:async()=>{calls++;return new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}));}});
  const start=performance.now(),value=await(await worker.fetch(req(sample.id),f.env)).json();assert.ok(performance.now()-start<1000);
  assert.equal(value.transport.response,null);assert.equal(value.api.result.status,'fallback');assert.equal(value.progress.applied,false);assert.equal(calls,1);
});

test('manual edits invalidate old tickets and protected source claims or failed persistence cannot be bypassed',async t=>{
  const sample=(await loadRelationPlanFixtures())[0],seeded=prepareRelationFixture(sample,RUN,START),prepared=await prepareRelationPlanRun(seeded.context,route.profile),checked=prepared.validateSelection(raw(),seeded.context);
  assert.equal(checked.ok,true);seeded.session.review={title:'旧记录',blocks:[{id:'context',type:'text',group:'main',label:'我写下的',text:'原来的内容。',claimIds:[],edited:false}]};
  editClarityBlock(seeded.session,'context','这是我手动修改的正文。');
  assert.equal(applyClarityReply(seeded.session,seeded.ticket,{flow:'clarity-v2',status:'candidate',requestId:seeded.ticket.requestId,revision:seeded.ticket.revision,candidate:checked.candidate}).reason,'inactive');
  assert.equal(seeded.session.review.blocks[0].text,'这是我手动修改的正文。');
  const protectedContext=structuredClone(sample.context);protectedContext.claims.push({id:'user_keep',type:'insight',text:'我自己写下的理解。',evidenceIds:[protectedContext.statements[0].id],derivation:'stated',status:'edited'});
  await assert.rejects(prepareRelationPlanRun(protectedContext,route.profile));
  const f=await environment(t),sent=[],worker=createRelationPlanWorker({now:()=>START,fetchImpl:provider({sent})});
  await assert.rejects(evaluate(worker,f.env,{persist:value=>{if(value.clientStepAttempts===1)throw Error('synthetic-persist-failure');}}),/synthetic-persist-failure/u);
  assert.equal(sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('client rejects candidate drift before saving and source digest covers the private plan and bounded capture implementation',async t=>{
  const f=await environment(t),sample=(await loadRelationPlanFixtures())[0],worker=createRelationPlanWorker({now:()=>START,fetchImpl:provider()});
  const report=await evaluate(worker,f.env,{fetchImpl:async(url,init)=>{const response=await worker.fetch(new Request(url,init),f.env);if(url.endsWith('/health'))return response;
    const value=await response.json();if(value.caseId===sample.id)value.api.result.candidate.title='synthetic-forged-title';return Response.json(value,{status:response.status});}});
  assert.equal(report.completedCaseCount,7);assert.equal(report.samples[0].calls[0].failure,'relation_evidence_candidate_or_state_rejected');assert.equal(report.clientStepAttempts,8);
  assert.equal(report.samples[0].calls[0].verification.actualStateApplied,false);
  const files=relationPlanSourceMetadata().sourceDigests.map(value=>value.file);assert.ok(files.includes('ai/experiments/clarity-relation-plan.mjs'));
  assert.ok(files.includes('ai/fixtures/clarity-relation-plan-fresh.mjs'));assert.ok(files.includes('scripts/experiments/clarity-semantic-audit-worker.mjs'));
});
