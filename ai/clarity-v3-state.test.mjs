import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../public/clarity-v3-state.mjs';
import * as old from '../public/clarity-state.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION,checkClarityContext} from '../public/clarity-v3-contract.mjs';
const claim=(type,text,evidenceIds=['u1'],supersedes=[])=>({type,text,evidenceIds,supersedes,derivation:'stated'});
const response=(overrides={})=>({modeId:'concern',goal:'聊聊这件事',title:'这次的表达',reply:'你可以按自己的节奏继续说。',question:null,claims:[],finish:false,...overrides});
const envelope=(ticket,candidate,overrides={})=>({flow:CLARITY_FLOW,schemaVersion:CLARITY_SCHEMA_VERSION,requestId:ticket.requestId,revision:ticket.revision,status:'candidate',candidate,...overrides});
function accept(s,candidate=response(),options={}){const ticket=state.beginClarityRequest(s,options);assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,candidate)).ok,true);return ticket;}
function storage(initial=[]){const values=new Map(initial);return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
function reviewed(){const s=state.createClaritySession();state.addExpression(s,'我想休息，也怕拒绝后见面尴尬。');
  accept(s,response({finish:true,claims:[claim('event','我想休息，也怕拒绝后见面尴尬。'),claim('insight','我想休息，也担心拒绝后的相处。')]}),{review:true});return s;}

test('L01/L02 no-question reflection keeps a writable conversation and ordinary additions stay expressions',()=>{
  const s=state.createClaritySession();state.addExpression(s,'今天周末，我一个人坐了一会儿。');
  const first=accept(s);assert.equal(first.kind,'reflect');assert.equal(first.context.stage,'reflect');
  assert.equal(s.stage,'exploring');assert.equal(s.question,null);assert.equal(s.review,null);assert.equal(s.complete,false);
  state.addExpression(s,'后来又出去走了一会儿。');accept(s);
  assert.deepEqual(s.statements.map(x=>x.kind),['expression','expression']);assert.equal(s.dialogue.length,0);assert.equal(s.review,null);
});

test('L08 actual question-answer links survive more than three answers without routing expectations to review',()=>{
  const s=state.createClaritySession();state.addExpression(s,'我想把最近的安排说一说。');
  for(let i=0;i<4;i++){
    accept(s,response({question:{text:`还有哪个具体细节想说？（${i}）`,target:i===3?'need':'event',evidenceIds:[s.statements.at(-1).id]}}));
    state.addExpression(s,i===3?'我希望临时安排前先问我能不能接。':`后来补充了第${i+1}个细节。`);
  }
  assert.equal(s.dialogue.length,4);assert.deepEqual(s.dialogue.map(d=>d.answerId),['u2','u3','u4','u5']);
  const ticket=state.beginClarityRequest(s);assert.equal(ticket.kind,'reflect');assert.equal(ticket.context.stage,'reflect');
  assert.equal(ticket.context.dialogue.length,4);assert.equal(checkClarityContext(ticket.context),ticket.context);
});

test('L09 explicit review is captured for retry, saves with zero calls and excludes control text',()=>{
  const s=state.createClaritySession();state.addExpression(s,'今天和朋友散步，很轻松。');state.addExpression(s,'请AI整理成一份。');
  let ticket=state.beginClarityRequest(s);assert.equal(ticket.kind,'review');assert.equal(s.lastRequestKind,'review');
  state.failClarityRequest(s,ticket,'timeout');ticket=state.beginClarityRequest(s,{review:s.lastRequestKind==='review'});
  assert.equal(ticket.kind,'review');assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response({finish:true,claims:[claim('event','今天和朋友散步，很轻松。')]}))).ok,true);
  const before=s.callCount,store=storage(),saved=state.saveClarityRecord(s,store);assert.equal(saved.ok,true);assert.equal(s.callCount,before);
  assert.equal(saved.record.formatVersion,2);assert.equal(state.RECORD_STORE,old.RECORD_STORE);
  assert.deepEqual(state.readRecordEntries(store)[0].record,saved.record);assert.doesNotMatch(state.recordText(saved.record),/请AI整理/);
  assert.equal(s.reviewReady,true);assert.equal(s.complete,true);
});

test('L06/L07 pause invalidates active tickets without a failure or deleting source; resume never dispatches',()=>{
  const s=state.createClaritySession();for(let i=0;i<12;i++)state.addExpression(s,`我想保留第${i}条完整表达。`);
  const before=structuredClone(s.statements),ticket=state.beginClarityRequest(s),calls=s.callCount;
  const control=state.conversationControl(s,'先到这里，不保存。');assert.equal(control.endRequested,true);assert.equal(control.discardRequested,true);
  assert.deepEqual(s.statements,before);assert.equal(state.conversationControl(s,'暂停一下。').pauseRequested,true);
  assert.deepEqual(state.pauseClaritySession(s),{ok:true});assert.equal(s.pending,null);assert.equal(s.paused,true);assert.equal(s.failure,null);
  assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response())).reason,'inactive');assert.equal(state.failClarityRequest(s,ticket,'network_error').reason,'inactive');
  assert.equal(s.failure,null);assert.deepEqual(s.statements,before);assert.equal(s.callCount,calls);
  assert.throws(()=>state.beginClarityRequest(s),/conversation_paused/);state.resumeClaritySession(s);assert.equal(s.callCount,calls);
  assert.equal(state.beginClarityRequest(s).kind,'reflect');
});

test('local discard permission never ends or deletes a working conversation and real stop controls cannot dispatch',()=>{
  const s=state.createClaritySession();state.addExpression(s,'今天有些烦，还想慢慢说。');
  const copy=structuredClone(s),control=state.conversationControl(s,'不保存。');
  assert.equal(control.discardRequested,true);assert.equal(control.endRequested,false);assert.equal(control.intentAction.kind,'respond');assert.deepEqual(s,copy);
  state.addExpression(s,'不保存。');accept(s);state.addExpression(s,'先到这里。');const calls=s.callCount;
  assert.throws(()=>state.beginClarityRequest(s),/local_control_required/);assert.equal(s.callCount,calls);
  const download=state.exportWorkingText(s);assert.ok(download.includes('今天有些烦，还想慢慢说。'));assert.ok(download.includes('不保存。'));assert.ok(download.includes('先到这里。'));
  const blank=state.createClaritySession();assert.throws(()=>state.beginClarityRequest(blank,{review:true}),/no_materials/);
  state.addExpression(blank,'请AI整理成一份。');assert.throws(()=>state.beginClarityRequest(blank),/no_materials/);assert.equal(blank.callCount,0);
});

test('L05 local verbatim and local previews retain all actual source without leaking control paragraphs',()=>{
  const s=state.createClaritySession(),result=state.keepClarityVerbatim(s,'今天有个小开心。只记这一句。');
  assert.deepEqual(result,{handled:true,ok:true});assert.equal(s.callCount,0);const kept=state.saveClarityRecord(s,storage());
  assert.equal(kept.ok,true);assert.equal(kept.record.modeId,'moment');assert.equal(kept.record.review.blocks[0].text,'今天有个小开心。');
  const local=state.createClaritySession();state.addExpression(local,'今天看了一会儿树。你先听着就好，别问我。');state.addExpression(local,'这会儿风吹得很舒服。');
  assert.equal(state.openClarityReview(local).ok,true);assert.equal(local.callCount,0);
  assert.equal(local.review.blocks[0].text,'今天看了一会儿树。\n\n这会儿风吹得很舒服。');
  assert.equal(state.saveClarityRecord(local,storage()).ok,true);assert.doesNotMatch(state.recordText(state.saveClarityRecord(local,storage()).record),/听着就好|别问我/);
});

test('L04 a natural feeling correction survives fresh review and format2 save without reviving the prior candidate',()=>{
  const s=state.createClaritySession();state.addExpression(s,'朋友取消了，我很失落。');
  accept(s,response({claims:[claim('feeling','我很失落。')]}));const previous=s.claims[0].id;
  state.addExpression(s,'不是失落，是生气。她已经主动约了新时间。');assert.equal(s.statements.at(-1).kind,'expression');
  accept(s,response({finish:true,claims:[claim('event','不是失落，是生气。她已经主动约了新时间。',['u2'],[previous])]}),{review:true});
  assert.equal(s.claims.find(c=>c.id===previous).archived,true);
  const store=storage(),saved=state.saveClarityRecord(s,store);assert.equal(saved.ok,true);
  const reopened=state.readRecordEntries(store)[0].record;assert.deepEqual(reopened,saved.record);
  assert.doesNotMatch(state.recordText(reopened),/我很失落/);assert.match(state.recordText(reopened),/是生气/);assert.match(state.recordText(reopened),/主动约了新时间/);
});

test('edited and confirmed text, explicit removals and stale acknowledgements remain authoritative',()=>{
  const s=reviewed();state.editClarityBlock(s,'insight','我现在更想把周末留给自己。');const edited=s.claims.find(c=>c.status==='edited');
  const candidate=response({finish:true,claims:[claim('event','我想休息，也怕拒绝后见面尴尬。'),claim('insight','模型想替换本人手改。',['u1'],[edited.id])]});
  accept(s,candidate,{review:true});assert.equal(s.review.blocks.find(b=>b.id==='insight').text,'我现在更想把周末留给自己。');
  assert.equal(state.saveClarityRecord(s,storage()).reason,'review_stale');state.acknowledgeClarityReview(s);
  assert.equal(state.saveClarityRecord(s,storage()).ok,true);assert.equal(s.claims.find(c=>c.id===edited.id).locked,true);
  const before=structuredClone(s.review);state.addExpression(s,'我想继续补充一点。');
  accept(s,response({finish:true,claims:[claim('event','模型要替换确认后的原话。',['u3'],[before.blocks[0].claimIds[0]])]}),{review:true});
  assert.deepEqual(s.review.blocks.find(b=>b.id===before.blocks[0].id),before.blocks[0]);assert.equal(s.stale,true);
  const removed=reviewed();for(const b of [...removed.review.blocks])state.removeClarityBlock(removed,b.id);
  assert.equal(removed.reviewReady,false);assert.equal(state.saveClarityRecord(removed,storage()).reason,'empty_review');
  state.restoreClarityBlock(removed);assert.equal(removed.reviewReady,true);
  accept(removed,response({finish:true,claims:[claim('event','我想休息，也怕拒绝后见面尴尬。'),claim('insight','我想休息，也担心拒绝后的相处。')]}),{review:true});
  assert.equal(removed.review.blocks.some(b=>b.id==='context'),false);
});

test('L08 source, active claim and storage capacity failures preserve full text and never claim a save',()=>{
  const s=state.createClaritySession();for(let i=0;i<12;i++)state.addExpression(s,`${i}：`+'长'.repeat(3990));
  const snapshot=structuredClone(s);assert.throws(()=>state.addExpression(s,'第十三条未提交草稿。'),/invalid_expression/);assert.deepEqual(s,snapshot);
  assert.equal(state.openClarityReview(s).ok,true);const before=s.callCount;
  assert.equal(state.saveClarityRecord(s,storage()).reason,'review_capacity_exceeded');assert.equal(s.callCount,before);assert.notEqual(s.stage,'kept');
  s.personalApiKey='not-exported-secret';const exported=state.exportWorkingText(s);for(const source of s.statements)assert.ok(exported.includes(source.text));
  assert.ok(exported.endsWith(s.statements.map(x=>x.text).join('\n\n')));assert.ok(!exported.includes('not-exported-secret'));
  const crowded=state.createClaritySession();state.addExpression(crowded,'这是保留的表达。');
  for(let i=0;i<15;i++)crowded.claims.push({...claim('event',`已有条目${i}。`),id:`c_${i}`,status:'candidate',archived:false});
  const original=structuredClone(crowded.claims),ticket=state.beginClarityRequest(crowded);
  const result=state.applyClarityReply(crowded,ticket,envelope(ticket,response({claims:[claim('event','新的一条。')]})));
  assert.equal(result.reason,'active_claims_limit');assert.deepEqual(crowded.claims,original);assert.equal(crowded.pending,null);assert.equal(crowded.review,null);
});

test('L07 binding, revisions, failures and action proposals cannot silently mutate review text',()=>{
  for(const overrides of [{flow:'clarity-v2'},{schemaVersion:'liubai-clarity-1'},{requestId:'other'},{revision:1000}]){
    const s=state.createClaritySession();state.addExpression(s,'今天还想说一点事。');const ticket=state.beginClarityRequest(s);
    assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response(),overrides)).reason,'invalid_response');assert.equal(s.claims.length,0);assert.equal(s.review,null);
  }
  const s=reviewed(),prior=structuredClone(s.review),priorClaims=structuredClone(s.claims),priorGoal=s.goal;
  const action=state.beginClarityRequest(s,{action:true});assert.equal(action.kind,'action');assert.equal(s.lastRequestKind,'action');
  assert.equal(state.applyClarityReply(s,action,envelope(action,response({finish:true,claims:[claim('action','如果愿意，可以先写下想说的一句。')]}))).ok,true);
  assert.deepEqual(s.review,prior);assert.deepEqual(s.claims,priorClaims);assert.equal(s.goal,priorGoal);assert.equal(s.actionProposal.type,'action');
  state.addExpression(s,'我还想说说别的。');const late=state.beginClarityRequest(s);state.reviseExpression(s,'u1','其实更需要休息。');
  assert.equal(state.applyClarityReply(s,late,envelope(late,response())).reason,'inactive');assert.equal(s.statements[0].text,'其实更需要休息。');assert.deepEqual(s.review,prior);
});

test('existing format2/legacy records stay exact and failed storage never overwrites them',()=>{
  const legacy=old.createClaritySession();old.addExpression(legacy,'已有的记录。');old.openClarityReview(legacy);
  const oldStore=storage(),oldSaved=old.saveClarityRecord(legacy,oldStore).record;
  const store=storage([[state.RECORD_STORE,JSON.stringify([oldSaved])],['liubai.records.v1','[]']]);
  const current=reviewed(),saved=state.saveClarityRecord(current,store);assert.equal(saved.ok,true);
  assert.deepEqual(JSON.parse(store.getItem(state.RECORD_STORE))[1],oldSaved);assert.equal(store.getItem('liubai.records.v1'),'[]');
  assert.deepEqual(old.readClarityRecord(saved.record),saved.record);assert.ok(!Object.hasOwn(saved.record,'statements'));assert.ok(!Object.hasOwn(saved.record,'claims'));
  assert.doesNotMatch(JSON.stringify(saved.record),/reviewReady|lastRequestKind|paused|schemaVersion/);
  const broken=storage([[state.RECORD_STORE,'{broken']]);const attempt=reviewed();
  assert.equal(state.saveClarityRecord(attempt,broken).reason,'storage_failed');assert.equal(broken.getItem(state.RECORD_STORE),'{broken');assert.notEqual(attempt.stage,'kept');
});

test('a later explicit request source follows local no-save without losing review kind on retry or lifting a question ban',()=>{
  const s=state.createClaritySession();state.addExpression(s,'这周末想自己待一会儿。别问我。');state.addExpression(s,'不保存。');
  const calls=s.callCount;assert.equal(state.conversationControl(s,'不保存。').discardRequested,true);assert.equal(s.callCount,calls);
  assert.throws(()=>state.beginClarityRequest(s,{review:true}),/generation_not_allowed/);
  state.addExpression(s,'请AI整理成一份',{kind:'request'});
  let ticket=state.beginClarityRequest(s,{review:true});assert.equal(ticket.kind,'review');assert.equal(ticket.context.stage,'review');
  assert.equal(state.conversationControl(s,'还想说一句。').allowQuestion,false);
  state.failClarityRequest(s,ticket,'timeout');const length=s.statements.length;
  ticket=state.beginClarityRequest(s,{review:s.lastRequestKind==='review'});assert.equal(s.statements.length,length);assert.equal(ticket.kind,'review');
  assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response({finish:true,claims:[claim('event','这周末想自己待一会儿。')]}))).ok,true);
  assert.equal(s.review.blocks[0].text,'这周末想自己待一会儿。');assert.equal(s.callCount,calls+2);
});

test('saved confirmed blocks survive a replacement or omitted group even when a model never declares supersedes',()=>{
  for(const omitContext of [false,true]){
    const s=reviewed();assert.equal(state.saveClarityRecord(s,storage()).ok,true);const before=structuredClone(s.review);
    if(omitContext){state.reviseExpression(s,'u1','我现在更想把休息的需要讲清楚。');assert.ok(s.claims.every(c=>c.status==='stale'&&c.locked));}
    state.addExpression(s,'我还想补充接下来怎么安排。');
    const claims=omitContext?[claim('unknown','还没有确定下一步。',['u2'])]:[claim('event','模型改写了先前已经确认的正文。',['u2'])];
    accept(s,response({finish:true,title:'模型换了一个标题',claims}),{review:true});
    for(const block of before.blocks)assert.deepEqual(s.review.blocks.find(b=>b.id===block.id),block);
    assert.equal(s.review.title,before.title);assert.equal(s.stale,true);assert.equal(state.saveClarityRecord(s,storage()).reason,'review_stale');
    state.acknowledgeClarityReview(s);assert.equal(state.saveClarityRecord(s,storage()).ok,true);
  }
});

test('saved local raw review with no claim IDs is protected; deleting a saved block does not resurrect it',()=>{
  const s=state.createClaritySession();state.addExpression(s,'这是我亲自留下的完整原话。');state.openClarityReview(s);
  assert.deepEqual(s.review.blocks[0].claimIds,[]);assert.equal(state.saveClarityRecord(s,storage()).ok,true);const before=structuredClone(s.review.blocks[0]);
  state.addExpression(s,'后来又补充一点。');accept(s,response({finish:true,claims:[claim('event','模型给出的另一段。',['u2'])]}),{review:true});
  assert.deepEqual(s.review.blocks.find(b=>b.id===before.id),before);assert.equal(s.stale,true);assert.equal(state.saveClarityRecord(s,storage()).reason,'review_stale');
  state.acknowledgeClarityReview(s);assert.equal(state.saveClarityRecord(s,storage()).ok,true);
  state.removeClarityBlock(s,'context');
  accept(s,response({finish:true,claims:[claim('event','模型想把已删段落放回来。',['u2']),claim('unknown','还没确定。',['u2'])]}),{review:true});
  assert.equal(s.review.blocks.some(b=>b.id==='context'),false);
});

test('opening a persisted format2 record with no claim metadata keeps its confirmed visible text authoritative',()=>{
  const original=reviewed(),saved=state.saveClarityRecord(original,storage()).record;
  const reopened={...state.createClaritySession(),...state.readClarityRecord(JSON.parse(JSON.stringify(saved))),stage:'kept',complete:true};
  assert.equal(reopened.claims.length,0);assert.equal(reopened.review.blocks[0].claimIds,undefined);
  // The actual UI can leave kept before appending its first new expression.
  reopened.stage='exploring';state.addExpression(reopened,'现在想再说一点新的情况。');
  accept(reopened,response({finish:true,claims:[claim('unknown','新的情况还有疑问。')]}),{review:true});
  for(const block of saved.review.blocks)assert.deepEqual(reopened.review.blocks.find(b=>b.id===block.id),block);
  assert.equal(reopened.stale,true);assert.equal(state.saveClarityRecord(reopened,storage()).reason,'review_stale');
  state.acknowledgeClarityReview(reopened);const next=state.saveClarityRecord(reopened,storage());assert.equal(next.ok,true);
  assert.doesNotMatch(JSON.stringify(next.record),/reviewConfirmed|confirmedBlockIds|confirmationTracked/);
});

test('current reply belongs to the latest full source snapshot, not an earlier cancelled or revised turn',()=>{
  const s=state.createClaritySession();state.addExpression(s,'今天自己出去走了一会儿。');accept(s,response({reply:'你刚刚说，今天自己出去走了一会儿。'}));
  const first=state.currentClarityReply(s);assert.ok(first);assert.ok(first.sourceBinding);
  state.pauseClaritySession(s);assert.equal(state.currentClarityReply(s),first);state.resumeClaritySession(s);
  state.addExpression(s,'后来又去朋友家坐了一会儿。');assert.equal(state.currentClarityReply(s),null);
  const cancelled=state.beginClarityRequest(s);state.pauseClaritySession(s);state.resumeClaritySession(s);
  assert.equal(state.currentClarityReply(s),null);assert.equal(state.applyClarityReply(s,cancelled,envelope(cancelled,response())).reason,'inactive');
  accept(s,response({reply:'后来你还去了朋友家。'}));assert.equal(state.currentClarityReply(s).text,'后来你还去了朋友家。');
  state.reviseExpression(s,'u1','今天先去了公园。');assert.equal(state.currentClarityReply(s),null);
  accept(s,response({reply:'这次你补充的是先去了公园。'}));assert.equal(s.stale,true);
  assert.equal(state.currentClarityReply(s).text,'这次你补充的是先去了公园。');
  assert.equal(s.messages.filter(m=>m.role==='assistant').length,3,'history remains intact');
  assert.equal(Object.hasOwn(state.wireSession(s),'messages'),false);
  state.openClarityReview(s);state.acknowledgeClarityReview(s);const saved=state.saveClarityRecord(s,storage());assert.equal(saved.ok,true);
  assert.doesNotMatch(JSON.stringify(saved.record),/sourceBinding/);
});
