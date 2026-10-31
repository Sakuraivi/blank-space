import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getPersonalRoute} from '../providers.mjs';
import {createProviderAdapter,prepareProviderRequest} from '../provider-transport.mjs';
import {faithfulDialogueInstructions,prepareFaithfulDialogueReflectRun,prepareFaithfulDialogueReviewRun,
  FAITHFUL_DIALOGUE_REFLECT_POLICY,FAITHFUL_DIALOGUE_REVIEW_POLICY} from './clarity-faithful-dialogue.mjs';
import {prepareSourceCheckedReflectRun} from './clarity-source-checked.mjs';
import {prepareV5Step} from '../../scripts/experiments/clarity-retention-v5-fixtures.mjs';
const route=getPersonalRoute('bailian','deepseek-v4-pro-0813'),profile=()=>structuredClone(route.profile);
const ctx=(text='我愿意一起做饭，但昨天临时多做了半小时，原本留给看书的时间被占了。')=>({sessionId:'dialogue_synthetic',revision:1,stage:'reflect',allowNextStep:false,
  modeId:'concern',goal:'梳理这次表达',statements:[{id:'u1',kind:'expression',text}],dialogue:[],claims:[]});
const raw=(extra={})=>({modeId:'concern',goal:'梳理这次表达',title:'临时安排的影响',reply:'原本留给看书的时间被占了。',
  question:{text:'最近一次具体发生了什么？',target:'event',evidenceIds:['u1']},claims:[],finish:false,...extra});
const adapter=value=>({profile:profile(),generate:async()=>({status:'completed',output:value})});

test('new response section replaces competing v5 instructions without changing input, schema or previous policy',async()=>{
  const c=ctx(),base=await prepareSourceCheckedReflectRun(c,profile()),before=structuredClone(base.requestData),p=await prepareFaithfulDialogueReflectRun(c,profile());
  assert.deepEqual(p.requestData.input,base.requestData.input);assert.deepEqual(p.requestData.output,base.requestData.output);
  assert.deepEqual(base.requestData,before);assert.equal(base.requestData.policyVersion,'clarity-source-checked-reflect-2');
  assert.equal(p.requestData.policyVersion,FAITHFUL_DIALOGUE_REFLECT_POLICY);
  assert.equal(p.requestData.instruction.text.split('【如何接话】').length,2);
  assert.doesNotMatch(p.requestData.instruction.text,/接住具体投入、细节或影响，再说一个|【具体承接与开放追问】/u);
  assert.match(p.requestData.instruction.text,/准确并列两份顾虑也有价值/u);
  assert.match(p.requestData.instruction.text,/【本次应用检查的有限范围】/u);
  assert.equal((await p.run({adapter:adapter(raw()),isCurrent:()=>true,timeoutMs:1000})).schemaVersion,'liubai-clarity-1');
});

test('only version-bound unique sections may be replaced',async()=>{
  const p=await prepareSourceCheckedReflectRun(ctx(),profile()),text=p.requestData.instruction.text;
  const opts={review:false,finishing:false,purpose:'personal_reflection',basePolicyVersion:'clarity-source-checked-reflect-2'};
  for(const bad of [text.replace('【如何接话】','changed'),text+'【材料边界】',text.replace('【具体承接与开放追问】','changed')]){
    assert.throws(()=>faithfulDialogueInstructions(bad,opts),/faithful_dialogue_template_changed/);
  }
  assert.throws(()=>faithfulDialogueInstructions(text,{...opts,basePolicyVersion:'unfrozen'}),/unsupported_faithful_dialogue_base/);
});

test('raw and compiled duration/source validators remain authoritative, no semantic keyword certificate is added',async()=>{
  const c=ctx(),p=await prepareFaithfulDialogueReflectRun(c,profile());
  assert.equal((await p.run({adapter:adapter(raw({reply:'你多花了两小时。'})),isCurrent:()=>true,timeoutMs:1000})).reason,'duration_source_mismatch');
  assert.equal(p.validateCandidate(raw({claims:[{type:'thought',text:'半小时的投入。',evidenceIds:['foreign'],derivation:'stated',supersedes:[]}]}),c).ok,false);
  const semanticallyBad=raw({reply:'你不介意额外做饭，只介意没能看书。'});
  assert.equal(p.validateCandidate(semanticallyBad,c).ok,true);
  assert.equal(p.durationTrace.semanticTruth,'unverified'); // Deliberate counterexample, not a content pass.
});

test('review retains all literal material, runtime public shape and post-compilation checking',async()=>{
  const c={...ctx(),stage:'review'},p=await prepareFaithfulDialogueReviewRun(c,profile());
  const result=await p.run({adapter:adapter({reply:'临时安排占用了看书的时间。',title:'临时安排',claims:[]}),isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'candidate');assert.equal(result.policyVersion,FAITHFUL_DIALOGUE_REVIEW_POLICY);
  assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion'].sort());
  assert.deepEqual(Object.keys(result.candidate).sort(),['modeId','goal','reply','question','claims','finish','title'].sort());
  assert.equal(result.candidate.claims[0].text,p.ledger.retainedText);assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);
  assert.match(p.requestData.instruction.text,/【忠实承接的收尾】/u);
  const bad=await prepareFaithfulDialogueReviewRun({...c,goal:'两小时的安排'},profile());
  assert.equal(bad.validateSelection({reply:'留住影响。',title:'安排',claims:[]},{...c,goal:'两小时的安排'}).reason,'duration_source_mismatch');
});

test('Host stopping and knowledge purpose keep their separate boundaries',async()=>{
  const c=ctx('今天多做了半小时，只留原话，不用分析。'),p=await prepareFaithfulDialogueReflectRun(c,profile());
  assert.match(p.requestData.instruction.text,/【忠实承接的收尾】/u);assert.doesNotMatch(p.requestData.instruction.text,/【具体承接与开放追问】/u);
  const k=ctx('你知道观鸟吗？');k.modeId='auto';k.goal=null;
  const kp=await prepareFaithfulDialogueReflectRun(k,profile(),{purpose:'knowledge_opener'});
  assert.equal(kp.durationTrace.status,'not_applicable');assert.doesNotMatch(kp.requestData.instruction.text,/【本次应用检查的有限范围】/u);
  assert.match(kp.requestData.instruction.text,/先简短回答明确问的内容/u);
  const personal=await prepareFaithfulDialogueReflectRun(ctx(),profile());
  assert.equal(personal.validateCandidate(raw({modeId:'moment',reply:'看看两小时的事情。'}),ctx()).reason,'duration_source_mismatch');
  await assert.rejects(prepareFaithfulDialogueReflectRun(ctx('大约需要四十分钟。'),profile()),/unsupported_duration_source_scope/);
});

test('snapshot, active profile, cancel and late-result checks never retry or accept caller mutation',async()=>{
  const c=ctx(),pr=profile(),pending=prepareFaithfulDialogueReflectRun(c,pr);c.statements[0].text='changed';pr.modelId='changed';
  const p=await pending;assert.equal(JSON.parse(p.requestData.input.content).statements[0].text,ctx().statements[0].text);
  assert.equal(p.binding.modelId,route.profile.modelId);assert.equal(p.validateCandidate(raw(),c).reason,'stale_faithful_dialogue_context');
  await assert.rejects(p.run({adapter:{profile:pr,generate:async()=>{throw Error('must not dispatch');}},isCurrent:()=>true,timeoutMs:1000}),/faithful_dialogue_binding_changed/);
  let count=0;const controller=new AbortController();controller.abort();
  assert.equal((await p.run({adapter:{profile:profile(),generate:async()=>{count++;}},signal:controller.signal,isCurrent:()=>true,timeoutMs:1000})).status,'discarded');
  assert.equal(count,0);let current=true;
  const late=await p.run({adapter:{profile:profile(),generate:async()=>{count++;current=false;return{status:'completed',output:raw()};}},isCurrent:()=>current,timeoutMs:1000});
  assert.equal(late.status,'discarded');assert.equal(count,1);
});

test('actual transport still uses trusted 12000 byte route and opaque header boundary',async()=>{
  let bytes=0;const {context}=prepareV5Step('V2_FULL_DIALOGUE','v6_policy_test',1_790_000_000_000,1);
  const p=await prepareFaithfulDialogueReflectRun(context,profile());
  const provider=createProviderAdapter({route,apiKey:'synthetic-not-a-real-key',fetchImpl:async(endpoint,init)=>{
    assert.equal(endpoint,route.endpoint);bytes=Buffer.byteLength(init.body);assert.ok(bytes<=12000);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw())}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }});
  const result=await p.run({adapter:provider,isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'candidate');assert.equal(route.maxRequestBytes,12000);assert.ok(bytes>0);
});

test('all four captured full-dialogue contexts fit the unchanged trusted transport budget',async()=>{
  const old=JSON.parse(readFileSync(new URL('../evaluations/2026-11-01-duration-source-v5.json',import.meta.url),'utf8'));
  const full=old.live.samples.find(s=>s.caseId==='V2_FULL_DIALOGUE');const bytes=[];
  for(const {context} of full.calls){
    const prepared=await(context.stage==='review'?prepareFaithfulDialogueReviewRun:prepareFaithfulDialogueReflectRun)(context,profile());
    bytes.push(prepareProviderRequest(prepared.requestData,route).byteLength);
  }
  assert.equal(bytes.length,4);assert.equal(bytes.every(n=>n>0&&n<=route.maxRequestBytes),true);
  // Historical-context capacity only. Real model histories are checked afresh.
  assert.equal(route.maxRequestBytes,12000);
});
