import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareRetainedConcernRun,RETAINED_CONCERN_POLICY} from './clarity-retained-concern.mjs';
import {buildRetentionLedger} from './clarity-retention-ledger.mjs';
import {parseExplicitEmotionCorrection,inspectSourceEmotion} from '../clarity-grounding.mjs';
import {getPersonalRoute,publicProviders} from '../providers.mjs';
import {prepareProviderRequest} from '../provider-transport.mjs';
import {CLARITY_SCHEMA_VERSION,buildClarityContext} from '../../public/clarity-contract.mjs';
import * as state from '../../public/clarity-state.mjs';

const route=getPersonalRoute('bailian','deepseek-v4-pro-0813'),profile=()=>structuredClone(route.profile);
const c=(texts=['我留了一个下午等朋友，还没有确定新的时间。'])=>({sessionId:'retention_synthetic',revision:texts.length,stage:'review',allowNextStep:false,
  modeId:'concern',goal:'理清这次安排',statements:texts.map((text,i)=>({id:`u${i+1}`,text,kind:'expression'})),dialogue:[],claims:[]});
const raw=(claims=[])=>({reply:'你为这次安排留了时间。',title:'留出的时间',claims});
const note=(type,text,anchorIds=['m1'])=>({type,text,anchorIds});
const fixture=JSON.parse(readFileSync(new URL('../evaluations/2026-11-01-material-set-v2.json',import.meta.url),'utf8'));
const realSample=id=>fixture.live.samples.find(s=>s.caseId===id);
function seed(context){
  const s=state.createClaritySession();s.id=context.sessionId;s.modeId=context.modeId;s.goal=context.goal;
  for(const source of context.statements)state.addExpression(s,source.text,{kind:source.kind});
  s.dialogue=structuredClone(context.dialogue);s.claims=context.claims.map(v=>({...structuredClone(v),archived:false}));
  s.revision=context.revision;s.callCount=context.dialogue.length;return s;
}
function begin(s){const ticket=state.beginClarityRequest(s);ticket.context=buildClarityContext({session:state.wireSession(s),revision:s.revision,stage:'review',allowNextStep:false});s.pending=structuredClone(ticket);return ticket;}
function apply(s,ticket,checked){return state.applyClarityReply(s,ticket,{flow:'clarity-v2',status:'candidate',requestId:ticket.requestId,revision:ticket.revision,candidate:checked.candidate});}

test('pure source helper does not confuse a conservative candidate rejection with source retirement',()=>{
  assert.deepEqual(parseExplicitEmotionCorrection('不是失落，是生气。'),{from:'失落',to:'生气',positiveText:'生气。'});
  assert.equal(inspectSourceEmotion('我很失落。','失落').pureFirstPerson,true);
  for(const text of ['我很失落？','我并不失落。','你很失落。','我很失落，也迟到了半小时。'])assert.equal(inspectSourceEmotion(text,'失落').pureFirstPerson,false);
  assert.equal(inspectSourceEmotion('她说：“我很失落。”','失落').referencesDenied,false);
});

test('the three accepted real v2 cases retain ALL active material in actual apply and saved visible body',async()=>{
  const lengths={V2_FREQUENCY_EXCEPTION:129,V2_CORRECTED_FEELING:100,V2_FULL_DIALOGUE:228};
  for(const [id,length] of Object.entries(lengths)){
    const call=realSample(id).calls.at(-1),context=call.context,s=seed(context),ticket=begin(s);
    assert.deepEqual(ticket.context,context);const prepared=await prepareRetainedConcernRun(context,profile());
    assert.equal(prepared.ledger.retainedLength,length);
    const old=JSON.parse(call.evidence.transport.response.choices[0].message.content);
    const model=raw(old.claims.filter(v=>v.type!=='event').map(({type,text,anchorIds})=>({type,text,anchorIds})));
    model.reply=old.reply;model.title=old.title;
    const checked=prepared.validateSelection(model,context);assert.equal(checked.ok,true);
    assert.deepEqual(checked.candidate.claims[0].supersedes,context.claims.map(v=>v.id));
    assert.equal(apply(s,ticket,checked).ok,true);assert.deepEqual(prepared.checkVisibleMaterial(s),{status:'visible',allVisible:true});
    const values=new Map([['liubai.records.v1','[]']]),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
    assert.equal(state.saveClarityRecord(s,storage).ok,true);
    const reopened=new Map(JSON.parse(JSON.stringify([...values]))),saved=state.readRecordEntries({getItem:k=>reopened.get(k)??null})[0].record;
    assert.equal(saved.review.blocks.find(b=>b.id==='context').text,prepared.ledger.retainedText);assert.equal(reopened.get('liubai.records.v1'),'[]');
    assert.equal(checked.selectionTrace.semanticCoverage,'unverified');
  }
});

test('a model can no longer select an empty event or edit the Host-retained body',async()=>{
  const context=c(),p=await prepareRetainedConcernRun(context,profile()),r=p.validateSelection(raw(),context);
  assert.equal(r.ok,true);assert.equal(r.candidate.claims.length,1);assert.equal(r.candidate.claims[0].text,context.statements[0].text);
  for(const value of [raw([{type:'event',anchorIds:['m1'],supersedes:[]}]),raw([{...note('insight','一句区分。'),supersedes:[]}]),{...raw(),event:'伪造'}])assert.equal(p.validateSelection(value,context).ok,false);
});

test('analysis cannot revive retired anchors even when the feeling returns A to B to A',async()=>{
  const context=c(['我很失落。','不是失落，是生气。','不是生气，是失落。']),p=await prepareRetainedConcernRun(context,profile());
  assert.equal(p.ledger.retainedText,'失落。');
  for(const id of ['m1','m2'])assert.equal(p.validateSelection(raw([note('insight','我现在失落。',[id])]),context).reason,'inactive_or_unknown_material_anchor');
  assert.equal(p.validateSelection(raw([note('insight','我现在失落。',['m3'])]),context).ok,true);
});

test('long, mixed, untracked edited and known protected scopes fail before an adapter can run',async()=>{
  const protectedContext=c();protectedContext.claims=[{id:'old',type:'insight',text:'我写过的。',evidenceIds:['u1'],derivation:'stated',status:'confirmed'}];
  const edited=c();edited.revision++;
  for(const context of [c(['长'.repeat(241)]),c(['我很失落，也迟到了半小时。','不是失落，是生气。']),edited,protectedContext])await assert.rejects(prepareRetainedConcernRun(context,profile()));
});

test('aggregate capacity does not truncate literal material or generated analysis',async()=>{
  const context=c(['原'.repeat(220)+'。']),p=await prepareRetainedConcernRun(context,profile());
  const r=p.validateSelection(raw([note('insight','甲'.repeat(180)),note('unknown','乙'.repeat(180))]),context);
  assert.equal(r.ok,false);assert.equal(r.reason,'response_too_large');assert.equal(p.ledger.retainedLength,221);
});

test('actual hidden stale+locked state keeps user text; candidate retention is not a visible-coverage claim',async()=>{
  const context=c();context.claims=[{id:'old_insight',type:'insight',text:'我亲手改过的区分。',evidenceIds:['u1'],derivation:'stated',status:'stale'}];
  const s=seed(context);s.claims[0].locked=true;s.review={title:'旧记录',blocks:[{id:'insight',type:'text',group:'main',label:'这次分清了',text:'我亲手改过的区分。',claimIds:['old_insight'],edited:false}]};
  const ticket=begin(s),p=await prepareRetainedConcernRun(ticket.context,profile()),checked=p.validateSelection(raw(),ticket.context);
  assert.equal(checked.ok,true);assert.equal(apply(s,ticket,checked).ok,true);
  assert.equal(s.review.blocks.find(b=>b.id==='insight').text,'我亲手改过的区分。');assert.equal(s.stale,true);
  assert.deepEqual(p.checkVisibleMaterial(s),{status:'needs_review',allVisible:false});
  assert.equal(state.saveClarityRecord(s,{getItem:()=>null,setItem:()=>{throw Error('must_not_write');}}).reason,'review_stale');
});

test('explicitly removed source block is not automatically restored',async()=>{
  const context=c(),s=seed(context),previous=await buildRetentionLedger(context);
  s.review={title:'待整理',blocks:[{id:'context',type:'text',group:'main',label:'你说过的',text:context.statements[0].text,claimIds:[],edited:false}]};
  state.removeClarityBlock(s,'context');const ticket=begin(s),p=await prepareRetainedConcernRun(ticket.context,profile(),{previousLedger:previous});
  assert.equal(apply(s,ticket,p.validateSelection(raw([note('unknown','新的时间还没确定。')]),ticket.context)).ok,true);
  assert.equal(s.review.blocks.some(b=>b.id==='context'),false);assert.deepEqual(p.checkVisibleMaterial(s),{status:'user_removed',allVisible:false});
});

test('an edit after dispatch invalidates the actual ticket and keeps manual text',async()=>{
  const context=c(),s=seed(context);s.review={title:'待整理',blocks:[{id:'context',type:'text',group:'main',label:'你说过的',text:context.statements[0].text,claimIds:[],edited:false}]};
  const ticket=begin(s),p=await prepareRetainedConcernRun(ticket.context,profile()),checked=p.validateSelection(raw(),ticket.context);
  state.editClarityBlock(s,'context','这是我亲手写的新记录。');
  assert.equal(apply(s,ticket,checked).reason,'inactive');assert.equal(s.review.blocks[0].text,'这是我亲手写的新记录。');assert.equal(p.checkVisibleMaterial(s).status,'stale');
});

test('the bound runtime captures context/profile and returns public metadata without ledger fields',async()=>{
  const context=c(),pr=profile(),old=structuredClone(context),preparing=prepareRetainedConcernRun(context,pr);
  context.statements[0].text='变更后的材料。';context.revision++;pr.modelId='changed';
  const p=await preparing;let calls=0;
  const result=await p.run({adapter:{profile:profile(),async generate(request){calls++;assert.equal(request,p.requestData);return {status:'completed',output:raw()};}},
    isCurrent:s=>s.revision===old.revision,context:{forged:true},contract:{forged:true}});
  assert.equal(calls,1);assert.equal(result.status,'candidate');assert.equal(result.policyVersion,RETAINED_CONCERN_POLICY);assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.equal(result.candidate.claims[0].text,old.statements[0].text);assert.doesNotMatch(JSON.stringify(result),/ledger|retiredBy|anchorIds|sourceDigest|snapshotId/);
  assert.equal(p.validateSelection(raw(),context).reason,'stale_material_index');
});

test('cancelled and late runtime results are discarded without retries',async()=>{
  const p=await prepareRetainedConcernRun(c(),profile()),controller=new AbortController();controller.abort();let calls=0;
  const adapter={profile:profile(),generate(){calls++;return {status:'completed',output:raw()};}};
  assert.equal((await p.run({adapter,signal:controller.signal,isCurrent:()=>true})).status,'discarded');assert.equal(calls,0);
  let active=true;assert.equal((await p.run({adapter:{profile:profile(),async generate(){calls++;active=false;return {status:'completed',output:raw()};}},isCurrent:()=>active})).status,'discarded');assert.equal(calls,1);
});

test('old model prose is not source evidence and trusted provider capacities remain unchanged',async()=>{
  const context=c();context.claims=[{id:'old',type:'insight',text:'旧模型擅自说的心理原因。',evidenceIds:['u1'],derivation:'inferred',status:'candidate'}];
  for(const provider of publicProviders()){
    const r=getPersonalRoute(provider.id,provider.defaultModelId),p=await prepareRetainedConcernRun(context,r.profile);
    assert.doesNotMatch(p.requestData.input.content,/旧模型擅自说的心理原因/);assert.doesNotMatch(p.ledger.retainedText,/旧模型/);
    assert.ok(new TextEncoder().encode(prepareProviderRequest(p.requestData,r).body).length<=r.maxRequestBytes);
  }
});

test('retaining source text cannot certify an unsupported psychological interpretation',async()=>{
  const context=c(),p=await prepareRetainedConcernRun(context,profile());
  const r=p.validateSelection(raw([note('insight','我的真实需要是被重视。')]),context);
  assert.equal(r.ok,true);assert.equal(r.selectionTrace.semanticCoverage,'unverified');
});
