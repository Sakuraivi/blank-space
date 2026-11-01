import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../public/clarity-v3-state.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION,CLARITY_POLICY_VERSION} from '../public/clarity-v3-contract.mjs';

const claim=(type,text,evidenceIds=['u1'])=>({type,text,evidenceIds,derivation:['insight','tradeoff','unknown'].includes(type)?'inferred':'stated',supersedes:[]});
const response=(claims,finish)=>({modeId:'concern',goal:'理清眼前的安排',title:'这次的安排',reply:'临时安排占掉了留给自己的时间。',question:null,claims,finish});
const envelope=(ticket,candidate,extra={})=>({flow:CLARITY_FLOW,schemaVersion:CLARITY_SCHEMA_VERSION,policyVersion:CLARITY_POLICY_VERSION,
  requestId:ticket.requestId,revision:ticket.revision,status:'candidate',candidate,...extra});
const send=(s,claims,{review=true}={})=>{const ticket=state.beginClarityRequest(s,{review});return state.applyClarityReply(s,ticket,envelope(ticket,response(claims,review)));};
const store=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
const seeded=()=>{const s=state.createClaritySession();state.addExpression(s,'我愿意一起照顾花箱，也想把学日语的时间留住。');state.addExpression(s,'又怕拒绝以后见面尴尬。请帮我理清。');return s;};

test('a legacy event-only result is retained as a candidate but never presented or confirmed as an understanding',()=>{
  const s=seeded();state.addExpression(s,'请AI整理成一份。',{kind:'request'});
  assert.equal(send(s,[claim('event','我愿意一起照顾花箱，也想把学日语的时间留住。')]).ok,true);
  assert.equal(s.review.blocks.length,1);assert.equal(s.review.blocks[0].id,'source');assert.equal(s.review.blocks[0].group,'main');
  assert.equal(s.review.blocks[0].text,'我愿意一起照顾花箱，也想把学日语的时间留住。\n\n又怕拒绝以后见面尴尬。');
  assert.deepEqual(s.review.blocks[0].claimIds,[]);assert.equal(s.claims[0].status,'candidate');
  assert.equal(state.reviewPresentation(s).kind,'source');assert.match(state.reviewPresentation(s).note,/还没有写出理解/);
  const memory=store();assert.equal(memory.values.size,0);assert.equal(state.saveClarityRecord(s,memory).ok,true);
  assert.equal(s.claims[0].status,'candidate','an undisplayed event was not blanket-confirmed');
});

test('two insights retain both texts and order while Host source stays separate from every visible model claim',()=>{
  const s=seeded(),first='我想留住学日语的时间。',second='我想留住学日语的时间，也怕拒绝以后见面尴尬。';
  assert.equal(send(s,[claim('insight',first),claim('insight',second,['u1','u2']),claim('need','临时安排前，先问我能不能接。')]).ok,true);
  assert.deepEqual(s.review.blocks.map(b=>[b.id,b.group]),[['insight','main'],['self','main'],['source','details']]);
  assert.equal(s.review.blocks[0].text,first+'\n\n'+second);assert.equal(s.review.blocks[0].claimIds.length,2);
  assert.equal(s.review.blocks[1].label,'此刻的感受与在意');assert.deepEqual(s.review.blocks[2].claimIds,[]);
  const presented=s.review.blocks.filter(b=>b.group==='main').flatMap(b=>b.claimIds);
  assert.deepEqual(presented,s.claims.map(c=>c.id));assert.equal(state.reviewPresentation(s).kind,'candidate');
});

test('a local review keeps all current non-event candidates instead of selecting only the last matching type',()=>{
  const s=seeded();
  assert.equal(send(s,[claim('insight','我想保住学习时间。'),claim('tradeoff','也怕拒绝后尴尬。'),claim('feeling','我有些生气。')],{review:false}).ok,true);
  assert.equal(send(s,[claim('need','希望先问。'),claim('option','没空时一起找办法。'),claim('unknown','还没有和邻居谈过。')],{review:false}).ok,true);
  const calls=s.callCount;assert.equal(state.openClarityReview(s).ok,true);assert.equal(s.callCount,calls);
  const main=s.review.blocks.filter(b=>b.group==='main');assert.deepEqual(main.map(b=>b.id),['insight','self','unknown']);
  assert.equal(main.flatMap(b=>b.claimIds).length,6);assert.ok(main.every(b=>b.text));
  assert.equal(s.review.blocks.at(-1).id,'source');assert.equal(s.review.blocks.at(-1).group,'details');
});
test('a moment or listening-only record is complete on its own without an absent-understanding warning',()=>{
  const moment=state.createClaritySession();state.addExpression(moment,'今天散步时风很舒服。');
  assert.equal(send(moment,[claim('feeling','我觉得轻松。')]).ok,true);
  assert.equal(state.reviewPresentation(moment).kind,'record');assert.equal(state.reviewPresentation(moment).note,'');
  const listening=state.createClaritySession();state.addExpression(listening,'今天有点烦。只想说说。不用分析。');
  assert.equal(state.openClarityReview(listening).ok,true);assert.equal(state.reviewPresentation(listening).kind,'source');
  assert.equal(state.reviewPresentation(listening).note,'');assert.equal(listening.callCount,0);
});

test('full life words enter storage only at confirmation; default export includes main text and opt-in includes source',()=>{
  const s=seeded(),memory=store();assert.equal(send(s,[claim('insight','想保护学习时间，也怕拒绝后尴尬。',['u1','u2'])]).ok,true);
  assert.equal(memory.values.size,0);const result=state.saveClarityRecord(s,memory);assert.equal(result.ok,true);
  const restored=state.readRecordEntries(memory)[0].record;assert.deepEqual(restored,result.record);
  assert.ok(restored.review.blocks.find(b=>b.id==='source').text.includes('又怕拒绝以后见面尴尬。'));
  assert.doesNotMatch(state.recordText(restored),/我愿意一起照顾花箱/);
  assert.match(state.recordText(restored,{details:true}),/我愿意一起照顾花箱/);
  assert.doesNotMatch(JSON.stringify(restored),/请帮我理清|policyVersion|reviewEditSourceIds|statementId|sourceBinding/);
});

test('history, acknowledged and manually edited blocks use a neutral record label instead of inferring semantics from an id',()=>{
  const s=seeded();assert.equal(send(s,[claim('need','我想保住学日语的时间。')]).ok,true);
  assert.equal(state.reviewPresentation(s).kind,'unresolved');
  assert.equal(state.reviewPresentation(s).label,'目前的整理');assert.equal(state.reviewPresentation(s).note,'','claim type is not a semantic judgment that no understanding exists');
  const historical={review:{title:'旧记录',blocks:[{id:'insight',type:'text',group:'main',label:'想留下的感受',text:'今天很轻松。'}]}};
  assert.equal(state.reviewPresentation(historical).kind,'record');assert.equal(state.reviewPresentation(historical).note,'');
  const current=seeded();send(current,[claim('insight','想休息，也怕拒绝后尴尬。')]);state.editClarityBlock(current,'insight','这是我亲手改的表达。');
  assert.equal(state.reviewPresentation(current).kind,'record');
  state.acknowledgeClarityReview(current);assert.equal(state.reviewPresentation(current).kind,'record');
});

test('protected source changes are stale and a removed source does not silently return',()=>{
  const s=seeded();send(s,[claim('insight','保护学习时间，也怕拒绝后尴尬。')]);state.saveClarityRecord(s,store());
  const before=structuredClone(s.review.blocks.find(b=>b.id==='source'));
  state.addExpression(s,'后来谈了一次，但还没确定新的安排。');assert.equal(send(s,[claim('unknown','新的安排还没确定。',['u3'])]).ok,true);
  assert.deepEqual(s.review.blocks.find(b=>b.id==='source'),before);assert.equal(s.stale,true);
  assert.equal(state.saveClarityRecord(s,store()).reason,'review_stale');state.acknowledgeClarityReview(s);
  state.removeClarityBlock(s,'source');assert.equal(send(s,[claim('need','想保住学习时间。')]).ok,true);
  assert.equal(s.review.blocks.some(b=>b.id==='source'),false);assert.match(state.exportWorkingText(s),/后来谈了一次/);
});

test('an oversized protected composition is rejected whole rather than hiding a model group in details',()=>{
  const s=seeded();state.openClarityReview(s);state.saveClarityRecord(s,store()); // Protected raw-only main.
  state.addExpression(s,'现在也愿意一起理清。');
  const ticket=state.beginClarityRequest(s,{review:true}),before=structuredClone({claims:s.claims,review:s.review,messages:s.messages});
  const result=state.applyClarityReply(s,ticket,envelope(ticket,response([
    claim('insight','我想保住学习时间。'),claim('feeling','我有些生气。'),claim('unknown','还没谈新的安排。'),
  ],true)));
  assert.equal(result.reason,'review_capacity_exceeded');assert.deepEqual(s.claims,before.claims);assert.deepEqual(s.review,before.review);assert.deepEqual(s.messages,before.messages);
  assert.equal(s.pending,null);assert.equal(s.failure,'review_capacity_exceeded');
});

test('Host-wrapped manual correction is not mislabeled as original words, while a real identical prefix is kept',()=>{
  const s=seeded();state.addExpression(s,'我把整理改为：这句话是我自己写下的。');send(s,[claim('insight','我想保住学习时间。')]);
  state.editClarityBlock(s,'insight','这是本人修改的候选理解。');const added=s.statements.at(-1);
  assert.equal(added.text,'我把整理改为：这是本人修改的候选理解。');assert.ok(s.reviewEditSourceIds.includes(added.id));
  const composed=state.composeClarityReview(s),source=composed.blocks.find(b=>b.id==='source');
  assert.match(source.text,/我把整理改为：这句话是我自己写下的。/);assert.doesNotMatch(source.text,/我把整理改为：这是本人修改的候选理解。/);
  assert.equal(state.wireSession(s).statements.at(-1).text,added.text);assert.equal(Object.hasOwn(state.wireSession(s),'reviewEditSourceIds'),false);
});

test('the request ticket pins policy as well as flow, schema and source snapshot',()=>{
  const s=seeded(),ticket=state.beginClarityRequest(s),forged={...ticket,policyVersion:'clarity-listening-1'};
  assert.equal(ticket.policyVersion,CLARITY_POLICY_VERSION);assert.equal(state.isCurrentClarity(s,forged),false);
  assert.equal(state.applyClarityReply(s,forged,envelope(ticket,response([],false))).reason,'inactive');
  assert.ok(s.pending);assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response([],false),{policyVersion:'clarity-listening-1'})).reason,'invalid_response');
  assert.equal(s.claims.length,0);assert.equal(s.review,null);
});
test('a direct user revision of a Host-wrapped edit becomes retained original material again',()=>{
  const s=seeded();send(s,[claim('insight','我想保留学习时间。')]);
  state.editClarityBlock(s,'insight','这是本人对整理的修改。');const id=s.statements.at(-1).id;
  assert.ok(s.reviewEditSourceIds.includes(id));
  state.reviseExpression(s,id,'我后来主动和她谈过一次，还没定下新安排。');
  assert.equal(s.reviewEditSourceIds.includes(id),false);
  assert.match(state.composeClarityReview(s).blocks.find(b=>b.id==='source').text,/我后来主动和她谈过一次，还没定下新安排。/);
  assert.equal(s.stale,true);
});

test('a reflected understanding is available immediately while the actual reply stays unchanged',()=>{
  const s=seeded(),ticket=state.beginClarityRequest(s),text='我想留住学日语的时间，但也怕拒绝后见面尴尬。';
  const candidate={...response([claim('insight',text,['u1','u2'])],false),reply:'你怕拒绝，所以还没有和她提。'};
  assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,candidate)).ok,true);
  const current=state.currentClarityUnderstanding(s);assert.equal(current.length,1);assert.equal(current[0].text,text);
  assert.equal(state.currentClarityReply(s).text,candidate.reply,'the display hook does not hide or rewrite an unsupported causal reply');
  assert.deepEqual(s.messages.at(-1).claimIds,[current[0].id]);assert.equal(s.review,null);assert.equal(s.complete,false);
});

test('current understanding uses only the latest accepted batch, preserving multiple texts and order',()=>{
  const s=seeded();send(s,[claim('insight','旧的一点理解。')],{review:false});
  const texts=['我想保留学习时间。','我想保留学习时间，也怕拒绝后尴尬。','是否答应临时安排，让这两个顾虑碰到一起。'];
  send(s,[claim('insight',texts[0]),claim('insight',texts[1],['u1','u2']),claim('tradeoff',texts[2],['u1','u2'])],{review:false});
  const current=state.currentClarityUnderstanding(s);assert.deepEqual(current.map(c=>c.text),texts);assert.equal(current.length,3);
  current[0].text='外部改动';assert.deepEqual(state.currentClarityUnderstanding(s).map(c=>c.text),texts,'getter returns independent copies');
});

test('waiting, failure, a new expression or a source revision cannot present an old understanding as a new response',()=>{
  const s=seeded();send(s,[claim('insight','想守住学习时间，也怕拒绝后尴尬。')],{review:false});assert.equal(state.currentClarityUnderstanding(s).length,1);
  const retry=state.beginClarityRequest(s);assert.deepEqual(state.currentClarityUnderstanding(s),[]);
  state.failClarityRequest(s,retry,'timeout');assert.deepEqual(state.currentClarityUnderstanding(s),[]);
  send(s,[claim('insight','这是这次实际收到的候选理解。')],{review:false});assert.equal(state.currentClarityUnderstanding(s).length,1);
  state.addExpression(s,'后来又发生了一件事。');assert.deepEqual(state.currentClarityUnderstanding(s),[]);
  send(s,[claim('insight','这是补充材料后的候选理解。',['u3'])],{review:false});assert.equal(state.currentClarityUnderstanding(s).length,1);
  state.reviseExpression(s,'u1','我现在想把周末更多留给自己。');assert.deepEqual(state.currentClarityUnderstanding(s),[]);
});

test('pause and a late candidate do not add an understanding or replace what history actually showed',()=>{
  const s=seeded(),original='想保住时间，也担心拒绝后尴尬。';send(s,[claim('insight',original)],{review:false});
  const historical=s.messages.at(-1),beforeMessages=structuredClone(s.messages),ticket=state.beginClarityRequest(s);
  state.pauseClaritySession(s);assert.deepEqual(state.currentClarityUnderstanding(s),[]);
  assert.equal(state.applyClarityReply(s,ticket,envelope(ticket,response([claim('insight','晚到的新说法。')],false))).reason,'inactive');
  assert.deepEqual(s.messages,beforeMessages);assert.deepEqual(state.historicalClarityUnderstanding(historical).map(c=>c.text),[original]);
});

test('messages without an understanding keep no extra content and action replies never invent one',()=>{
  const s=seeded();send(s,[claim('event','原话事件。'),claim('need','我想保住学习时间。')],{review:false});
  assert.deepEqual(state.currentClarityUnderstanding(s),[]);assert.deepEqual(state.historicalClarityUnderstanding(s.messages.at(-1)),[]);
  const action=state.beginClarityRequest(s,{action:true});
  assert.equal(state.applyClarityReply(s,action,envelope(action,response([claim('action','可以先写下想说的话。')],true))).ok,true);
  assert.deepEqual(state.currentClarityUnderstanding(s),[]);assert.deepEqual(state.historicalClarityUnderstanding(s.messages.at(-1)),[]);
  assert.deepEqual(state.historicalClarityUnderstanding({role:'assistant',text:'旧版本的一句承接。'}),[]);
});

test('historical understanding is an immutable transient snapshot, not a rewritten working claim or saved transcript',()=>{
  const s=seeded(),original='我想留住学习时间，也担心拒绝后的相处。';send(s,[claim('insight',original)],{review:false});
  const message=s.messages.at(-1),before=structuredClone(message);assert.equal(state.openClarityReview(s).ok,true);
  state.editClarityBlock(s,'insight','这是本人后来修改的意思。');
  assert.notEqual(s.claims.find(c=>c.id===message.claimIds[0]).text,original);
  assert.deepEqual(message,before);assert.deepEqual(state.historicalClarityUnderstanding(message).map(c=>c.text),[original]);
  assert.deepEqual(state.currentClarityUnderstanding(s),[]);assert.equal(Object.hasOwn(state.wireSession(s),'messages'),false);
  state.acknowledgeClarityReview(s);const saved=state.saveClarityRecord(s,store());assert.equal(saved.ok,true);
  assert.equal(Object.hasOwn(saved.record,'messages'),false);assert.doesNotMatch(JSON.stringify(saved.record),/"understanding"|"sourceBinding"/);
});

test('a manual edit that cannot become fresh model context is not displayed as a new model understanding',()=>{
  const s=seeded();while(s.statements.length<12)state.addExpression(s,'还有一点实际补充。');
  const original='我想留住学习时间，也担心拒绝后的相处。';send(s,[claim('insight',original)],{review:false});
  const message=s.messages.at(-1);state.openClarityReview(s);state.editClarityBlock(s,'insight','长'.repeat(4000));
  assert.equal(s.aiContextInvalid,true);assert.deepEqual(state.currentClarityUnderstanding(s),[]);
  assert.deepEqual(state.historicalClarityUnderstanding(message).map(c=>c.text),[original]);
});
