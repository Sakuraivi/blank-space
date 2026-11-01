import test from 'node:test';
import assert from 'node:assert/strict';
import {createClarityV3Preview,fixtureCandidate} from './clarity-v3-preview.mjs';
import {createClaritySession,addExpression,beginClarityRequest,applyClarityReply,wireSession,pauseClaritySession,openClarityReview,saveClarityRecord,readRecordEntries} from '../public/clarity-v3-state.mjs';
import {validateClarityCandidate} from '../public/clarity-v3-contract.mjs';

async function start(t,options={}){
  const preview=createClarityV3Preview(options),address=await preview.listen(0),origin=`http://127.0.0.1:${address.port}`;
  t.after(()=>preview.close());return {preview,origin};
}
async function status(origin){return fetch(origin+'/api/ai/status').then(r=>r.json());}
async function send(origin,s,current,{review=false}={}){
  const ticket=beginClarityRequest(s,{review}),profile=current.defaultProfile;
  const response=await fetch(origin+'/api/ai/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({
    flow:'clarity-v3',sourceMode:'default',providerId:profile.providerId,modelId:profile.modelId,defaultRevision:profile.defaultRevision,
    configVersion:current.configVersion,consentVersion:current.consentVersion,requestId:ticket.requestId,revision:ticket.revision,
    stage:ticket.context.stage,allowNextStep:false,session:wireSession(s)})});
  return {ticket,response,result:await response.json()};
}
test('preview is loopback-only and visibly labels its synthetic response mode',async t=>{
  const {origin,preview}=await start(t,{fixture:true});
  assert.equal(preview.server.address().address,'127.0.0.1');
  const html=await fetch(origin+'/').then(r=>r.text());assert.match(html,/模拟回复 \/ 未调用真实AI/);assert.match(html,/clarity-v3-app\.mjs/);assert.match(html,/class="clarity-v3"/);
  for(const path of ['/clarity-v3-app.mjs','/clarity-v3.css','/clarity-v3-intent.mjs','/clarity-v3-state.mjs'])assert.equal((await fetch(origin+path)).status,200);
  const counts=await fetch(origin+'/__fixture-count').then(r=>r.json());assert.deepEqual(counts,{synthetic:true,modelCalls:0,realModelCalls:0});
  assert.equal((await fetch(origin+'/api/organizer/status')).status,404);
});
test('actual API and ledger transport keep fixture listening non-final and preserve ordinary continuation',async t=>{
  const {origin}=await start(t,{fixture:true}),current=await status(origin),s=createClaritySession();
  for(const text of ['今天写了一下午代码。我只想说说，不用分析。','后来出去散了会步。','我还想再说一件小事。','现在坐在窗边。']){
    addExpression(s,text,{kind:'expression'});const {ticket,result}=await send(origin,s,current);
    assert.equal(result.status,'candidate',JSON.stringify(result));assert.equal(result.schemaVersion,'liubai-clarity-2');
    assert.equal(result.candidate.question,null);assert.equal(result.candidate.finish,false);
    assert.equal(applyClarityReply(s,ticket,result).ok,true);assert.equal(s.stage,'exploring');
  }
  assert.equal(s.statements.length,4);assert.equal(s.dialogue.length,0);assert.ok(s.statements.every(x=>x.kind==='expression'));
  const count=await fetch(origin+'/__fixture-count').then(r=>r.json());assert.equal(count.modelCalls,4);assert.equal(count.realModelCalls,0);
});
test('one explicit review uses only actual material, applies and saves through formatVersion2',async t=>{
  const {origin}=await start(t,{fixture:true}),current=await status(origin),s=createClaritySession();
  addExpression(s,'今天在河边慢慢走了一会儿。');let call=await send(origin,s,current);assert.equal(applyClarityReply(s,call.ticket,call.result).ok,true);
  openClarityReview(s);assert.equal((await fetch(origin+'/__fixture-count').then(r=>r.json())).modelCalls,1,'local preview is zero-call');
  call=await send(origin,s,current,{review:true});assert.equal(call.result.status,'candidate',JSON.stringify(call.result));
  assert.equal(call.result.candidate.finish,true);assert.equal(call.result.candidate.question,null);
  assert.equal(applyClarityReply(s,call.ticket,call.result).ok,true);
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const saved=saveClarityRecord(s,storage);assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.record.formatVersion,2);
  assert.deepEqual(readRecordEntries(storage)[0].record,saved.record);assert.ok(saved.record.review.blocks.some(b=>b.text.includes('今天在河边慢慢走了一会儿。')));
  assert.equal((await fetch(origin+'/__fixture-count').then(r=>r.json())).modelCalls,2,'save is zero-call');
});
test('fixture derives optional questions from Host permissions and refuses silent review truncation',()=>{
  const c={sessionId:'fixture_policy',revision:1,stage:'reflect',allowNextStep:false,modeId:'auto',goal:null,
    statements:[{id:'u1',kind:'expression',text:'今天我反复想着周末的安排。帮我理清。'}],dialogue:[],claims:[]};
  const value=fixtureCandidate(c);assert.ok(value.question);assert.equal(validateClarityCandidate(value,c).ok,true);
  const listen=fixtureCandidate({...c,statements:[{...c.statements[0],text:'今天我反复想着周末的安排。不要追问。'}]});assert.equal(listen.question,null);
  const curious={...c,statements:[{...c.statements[0],text:'你知道下村阳子吗？'}]};
  assert.equal(validateClarityCandidate(fixtureCandidate(curious),curious).ok,true,'a quoted user question does not turn the reply into a new question');
  const tooLong={...c,stage:'review',statements:[{...c.statements[0],text:'原'.repeat(241)+'。'}]};assert.throws(()=>fixtureCandidate(tooLong),/fixture_material_capacity/);
  assert.equal(tooLong.statements[0].text.length,242);
});
test('personal-key preview has no shared source and does not expose fixture counters',async t=>{
  const {origin}=await start(t),current=await status(origin);assert.equal(current.defaultAvailable,false);assert.equal(current.personalKeySupported,true);
  const response=await fetch(origin+'/api/ai/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({sourceMode:'default'})});
  assert.equal(response.status,503);assert.equal((await response.json()).reason,'default_unavailable');assert.equal((await fetch(origin+'/__fixture-count')).status,404);
});
test('delayed fixture cancellation preserves the actual work state without a second dispatch or late apply',async t=>{
  const {origin}=await start(t,{fixture:true,delayMs:350}),current=await status(origin),s=createClaritySession();addExpression(s,'这句话还想留在这里。');
  const ticket=beginClarityRequest(s),profile=current.defaultProfile,controller=new AbortController();
  const pending=fetch(origin+'/api/ai/generate',{method:'POST',signal:controller.signal,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({
    flow:'clarity-v3',sourceMode:'default',providerId:profile.providerId,modelId:profile.modelId,defaultRevision:profile.defaultRevision,configVersion:current.configVersion,consentVersion:current.consentVersion,
    requestId:ticket.requestId,revision:ticket.revision,stage:'reflect',allowNextStep:false,session:wireSession(s)})});
  const rejected=assert.rejects(pending,/abort/iu);
  for(let i=0;i<100;i++){if((await fetch(origin+'/__fixture-count').then(r=>r.json())).modelCalls===1)break;await new Promise(r=>setTimeout(r,10));}
  controller.abort();pauseClaritySession(s);await rejected;await new Promise(r=>setTimeout(r,400));
  assert.equal(s.paused,true);assert.equal(s.pending,null);assert.equal(s.failure,null);assert.equal(s.statements[0].text,'这句话还想留在这里。');
  assert.equal(s.messages.filter(m=>m.role==='assistant').length,0);
  assert.deepEqual(await fetch(origin+'/__fixture-count').then(r=>r.json()),{synthetic:true,modelCalls:1,realModelCalls:0});
});

test('fixture organizer has no shared call or budget ceiling, keeps revision binding and remains available beyond eighteen requests',async t=>{
  const {origin}=await start(t,{fixture:true}),current=await status(origin),s=createClaritySession();
  assert.equal(current.defaultAvailable,true);assert.equal(current.defaultEnabled,true);
  assert.equal(current.defaultProfile.defaultRevision,1);assert.equal(current.remainingCalls,null);assert.equal(current.remainingBudgetCny,null);
  addExpression(s,'今天想按自己的节奏慢慢说。先不用问，也不用分析。');
  for(let i=0;i<20;i++){
    const call=await send(origin,s,current);assert.equal(call.result.status,'candidate',`synthetic request ${i+1}: ${JSON.stringify(call.result)}`);
    assert.equal(call.result.route.defaultRevision,current.defaultProfile.defaultRevision);assert.equal(applyClarityReply(s,call.ticket,call.result).ok,true);
  }
  const after=await status(origin);assert.equal(after.defaultEnabled,true);assert.equal(after.remainingCalls,null);assert.equal(after.remainingBudgetCny,null);
  assert.deepEqual(await fetch(origin+'/__fixture-count').then(r=>r.json()),{synthetic:true,modelCalls:20,realModelCalls:0});
  const stale={...current,defaultProfile:{...current.defaultProfile,defaultRevision:current.defaultProfile.defaultRevision+1}};
  const rejected=await send(origin,s,stale);assert.equal(rejected.response.status,409);assert.equal(rejected.result.reason,'consent_changed');
  assert.deepEqual(await fetch(origin+'/__fixture-count').then(r=>r.json()),{synthetic:true,modelCalls:20,realModelCalls:0});
});
