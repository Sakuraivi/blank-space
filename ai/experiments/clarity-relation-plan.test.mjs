import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getPersonalRoute} from '../providers.mjs';
import {prepareProviderRequest} from '../provider-transport.mjs';
import {prepareRelationPlanRun,RELATION_PLAN_POLICY,RELATION_PLAN_SCHEMA} from './clarity-relation-plan.mjs';
const route=getPersonalRoute('bailian','deepseek-v4-pro-0813'),profile=()=>structuredClone(route.profile);
const ctx=(texts=['我想留出周末休息。','我又怕拒绝聚会后和朋友尴尬。'])=>({sessionId:'relation_synthetic',revision:texts.length,stage:'review',allowNextStep:false,
  modeId:'concern',goal:'理清周末安排',statements:texts.map((text,i)=>({id:`u${i+1}`,kind:'expression',text})),dialogue:[],claims:[]});
const raw=(extra={})=>({reply:'休息时间和拒绝后的相处，都是你说出的顾虑。',title:'周末安排',
  focus:{left:{anchorId:'m1',quote:'我想留出周末休息'},right:{anchorId:'m2',quote:'我又怕拒绝聚会后和朋友尴尬'}},
  claims:[{type:'insight',text:'我想留出周末休息，我又怕拒绝聚会后和朋友尴尬；想说清安排时，这两件事可以同时考虑。',anchorIds:['m1','m2']}],...extra});
const adapter=output=>({profile:profile(),generate:async()=>({status:'completed',output})});

test('one private plan compiles both selected sides into the original public candidate without plan metadata',async()=>{
  const c=ctx(),p=await prepareRelationPlanRun(c,profile()),before=raw();
  assert.equal(p.requestData.schemaVersion,RELATION_PLAN_SCHEMA);assert.equal(p.requestData.policyVersion,RELATION_PLAN_POLICY);
  assert.equal(prepareProviderRequest(p.requestData,route).byteLength<=12000,true);
  const result=await p.run({adapter:adapter(before),isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'candidate');assert.equal(result.schemaVersion,'liubai-clarity-1');assert.equal(result.candidate.finish,true);
  assert.deepEqual(Object.keys(result.candidate).sort(),['modeId','goal','reply','question','claims','finish','title'].sort());
  assert.equal(result.candidate.claims[0].text,p.ledger.retainedText);assert.equal(result.candidate.question,null);
  assert.deepEqual(before,raw());assert.equal(p.checkFocus(before).semanticTruth,'unverified');
  assert.doesNotMatch(JSON.stringify(result),/relationTrace|anchorId|sourceStart|focus/);
});

test('FULL same-sentence sides are allowed and preserve distinct UTF16 source spans',async()=>{
  const old=JSON.parse(readFileSync(new URL('../evaluations/2026-11-01-faithful-dialogue-v6.json',import.meta.url),'utf8'));
  const c=old.live.samples.find(s=>s.caseId==='V2_FULL_DIALOGUE').calls[3].context,p=await prepareRelationPlanRun(c,profile());
  const unit=p.ledger.units.find(u=>u.text.includes('又怕拒绝以后见面尴尬'));
  const value=raw({focus:{left:{anchorId:unit.anchorId,quote:'我想把学日语的时间留住'},right:{anchorId:unit.anchorId,quote:'又怕拒绝以后见面尴尬'}},
    claims:[{type:'insight',text:'我想把学日语的时间留住，又怕拒绝以后见面尴尬；临时换班先问能不能接，是我希望说清的安排。',anchorIds:[unit.anchorId]}]});
  const checked=p.validateSelection(value,c);assert.equal(checked.ok,true);
  const {left,right}=checked.relationTrace.focus;
  assert.equal(left.anchorId,right.anchorId);assert.ok(left.matches[0].sourceEnd<=right.matches[0].sourceStart);
  assert.equal(c.statements.find(s=>s.id===left.sourceId).text.slice(left.matches[0].sourceStart,left.matches[0].sourceEnd),left.quote);
});

test('focus must survive in one raw and compiled insight and cover both source anchors',async()=>{
  const c=ctx(),p=await prepareRelationPlanRun(c,profile());
  const values=[raw({claims:[]}),raw({claims:[{type:'insight',text:'我想留出周末休息。',anchorIds:['m1','m2']}]}),
    raw({claims:[{type:'insight',text:raw().claims[0].text,anchorIds:['m1']}]}),
    {...raw(),extra:true},raw({focus:{left:{anchorId:'foreign',quote:'我想留出周末休息'},right:raw().focus.right}})];
  for(const value of values){const before=structuredClone(value);assert.equal(p.validateSelection(value,c).ok,false);assert.deepEqual(value,before);}
  const bad=await p.run({adapter:adapter(values[1]),isCurrent:()=>true,timeoutMs:1000});
  assert.equal(bad.status,'fallback');assert.equal(bad.reason,'relation_sides_missing_from_insight');assert.equal(bad.candidate,null);
});

test('null stays allowed without inventing a second concern and does not certify completeness',async()=>{
  const c=ctx(['我想请店员发提醒前核对柜号。']),p=await prepareRelationPlanRun(c,profile());
  const value={reply:'你想说清的是发提醒前核对柜号。',title:'提醒前核对柜号',focus:null,claims:[]};
  assert.equal(p.validateSelection(value,c).ok,true);assert.equal(p.checkFocus(value).status,'none');
  const dilemma=await prepareRelationPlanRun(ctx(),profile());
  assert.equal(dilemma.validateSelection({...raw(),focus:null,claims:[]},ctx()).ok,true);
  assert.equal(dilemma.checkFocus({...raw(),focus:null}).semanticTruth,'unverified');
});

test('duplicate, overlapping and ambiguous source ranges cannot count as two literal sides',async()=>{
  const c=ctx(['我想休息，也担心太累。']),p=await prepareRelationPlanRun(c,profile());
  const overlapping=raw({focus:{left:{anchorId:'m1',quote:'我想休息'},right:{anchorId:'m1',quote:'想休息'}},claims:[]});
  assert.equal(p.checkFocus(overlapping).reason,'overlapping_relation_sources');
  const q=await prepareRelationPlanRun(ctx(['想休息，想休息，也担心太累。']),profile());
  const ambiguous=raw({focus:{left:{anchorId:'m1',quote:'想休息'},right:{anchorId:'m1',quote:'担心太累'}},claims:[]});
  const result=q.checkFocus(ambiguous);assert.equal(result.reason,'ambiguous_relation_source');assert.equal(result.focus.left.matches.length,2);
});

test('active positive correction material is used, while a retired anchor never reappears',async()=>{
  const c=ctx(['我很失落。','我不是失落，是生气。','我怕再谈会尴尬。']);c.statements[1].kind='correction';
  const p=await prepareRelationPlanRun(c,profile()),retired=p.ledger.units.find(u=>u.status==='retired');
  assert.ok(retired);
  const bad=raw({focus:{left:{anchorId:retired.anchorId,quote:retired.text},right:{anchorId:'m3',quote:'我怕再谈会尴尬'}},claims:[]});
  assert.equal(p.checkFocus(bad).reason,'unknown_or_unquoted_relation_source');
  const data=JSON.parse(p.requestData.input.content);assert.equal(data.materials.some(m=>m.id===retired.anchorId),false);
});

test('literal coverage can still carry cropped negation or useless juxtaposition; semantic truth remains unverified',async()=>{
  const c=ctx(['我不是想取消聚会。','我担心太累。']),p=await prepareRelationPlanRun(c,profile());
  const value={reply:'先看这次安排。',title:'聚会安排',focus:{left:{anchorId:'m1',quote:'想取消聚会'},right:{anchorId:'m2',quote:'担心太累'}},
    claims:[{type:'insight',text:'我想取消聚会，也担心太累。',anchorIds:['m1','m2']}]};
  const checked=p.validateSelection(value,c);assert.equal(checked.ok,true);assert.equal(checked.relationTrace.semanticTruth,'unverified');
  const juxtaposed=raw({claims:[{type:'insight',text:'我想留出周末休息。我又怕拒绝聚会后和朋友尴尬。',anchorIds:['m1','m2']}]});
  assert.equal((await prepareRelationPlanRun(ctx(),profile())).validateSelection(juxtaposed,ctx()).ok,true);
  // Deliberate legal-but-semantic-failure controls, not successful content.
});

test('duration, capacity, current context and protected input boundaries are inherited without weakening',async()=>{
  const c=ctx(),p=await prepareRelationPlanRun(c,profile());
  assert.equal(p.validateSelection(raw({reply:'你投入了两小时。'}),c).reason,'duration_source_mismatch');
  const oversized=raw({focus:null,claims:[{type:'insight',text:'长'.repeat(241),anchorIds:['m1']}]});assert.equal(p.validateSelection(oversized,c).ok,false);
  const changed=structuredClone(c);changed.statements[0].text+='changed';assert.equal(p.validateSelection(raw(),changed).reason,'stale_relation_plan_context');
  const protectedContext=ctx();protectedContext.claims=[{id:'c1',type:'thought',text:'这是我手改的内容。',evidenceIds:['u1'],derivation:'stated',status:'edited'}];
  await assert.rejects(prepareRelationPlanRun(protectedContext,profile()),/protected_material_scope/);
  await assert.rejects(prepareRelationPlanRun({...c,stage:'reflect'},profile()),/unsupported_relation_plan_scope/);
  await assert.rejects(prepareRelationPlanRun(ctx(['今天只想留原话，不用分析。']),profile()),/unsupported_retention_scope/);
});

test('pre-await snapshots, profiles, cancellation and late responses never retry or mix versions',async()=>{
  const c=ctx(),pr=profile(),pending=prepareRelationPlanRun(c,pr);c.goal='changed';pr.modelId='changed';
  const p=await pending;assert.equal(JSON.parse(p.requestData.input.content).working.goal,ctx().goal);assert.equal(p.binding.modelId,route.modelId);
  await assert.rejects(p.run({adapter:{profile:pr,generate:()=>{throw Error('must not dispatch');}},isCurrent:()=>true,timeoutMs:1000}),/relation_plan_binding_changed/);
  let calls=0;const abort=new AbortController();abort.abort();
  assert.equal((await p.run({adapter:{profile:profile(),generate:async()=>{calls++;}},signal:abort.signal,isCurrent:()=>true,timeoutMs:1000})).status,'discarded');assert.equal(calls,0);
  let current=true;const result=await p.run({adapter:{profile:profile(),generate:async()=>{calls++;current=false;return{status:'completed',output:raw()};}},isCurrent:()=>current,timeoutMs:1000});
  assert.equal(result.status,'discarded');assert.equal(calls,1);
});

test('actual question-answer links and limited duration source guidance survive the private input rewrite',async()=>{
  const c=ctx(['我想留出周末休息。','后者。']);const question='目前想先说休息时间还是担心拒绝后的相处？';
  c.dialogue=[{question,answerId:'u2'}];
  const p=await prepareRelationPlanRun(c,profile()),data=JSON.parse(p.requestData.input.content);
  assert.equal(data.materials.find(m=>m.sourceId==='u2').questionLinks[0].question,question);
  assert.equal(data.durationSourcePolicy.purpose,'personal_reflection');
  assert.equal(p.binding.schemaVersion,RELATION_PLAN_SCHEMA);assert.equal(p.binding.publicSchemaVersion,'liubai-clarity-1');
});
