import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPersonalRoute} from '../providers.mjs';
import {validateClarityResponse} from '../clarity.mjs';
import {prepareSourceCheckedReflectRun,prepareSourceCheckedReviewRun,SOURCE_CHECKED_REFLECT_POLICY,SOURCE_CHECKED_REVIEW_POLICY} from './clarity-source-checked.mjs';
const profile=()=>structuredClone(getPersonalRoute('bailian','deepseek-v4-pro-0813').profile);
const ctx=(text='昨天等了半小时，原本留给看书的时间被占了。')=>({sessionId:'duration_synthetic',revision:1,stage:'reflect',allowNextStep:false,modeId:'concern',goal:'理清这件事',
  statements:[{id:'u1',kind:'expression',text}],dialogue:[],claims:[]});
const raw=(extra={})=>({modeId:'concern',goal:'理清这件事',title:'等候的影响',reply:'原本留给看书的时间被占了。',
  question:{text:'最近一次具体发生了什么？',target:'event',evidenceIds:['u1']},claims:[],finish:false,...extra});
const adapter=(output,p=profile())=>({profile:p,generate:async()=>({status:'completed',output})});

test('the actual v4 two-hour error is rejected without rewriting its raw output or old evidence',async()=>{
  const path=new URL('../evaluations/2026-11-01-guided-retention-v4.json',import.meta.url),bytes=readFileSync(path),old=JSON.parse(bytes);
  const call=old.live.samples.find(s=>s.caseId==='V2_FULL_DIALOGUE').calls[1],value=JSON.parse(call.evidence.transport.response.choices[0].message.content),before=structuredClone(value);
  assert.match(value.reply,/两小时/u);assert.equal(validateClarityResponse(value,call.context).ok,true);
  const p=await prepareSourceCheckedReflectRun(call.context,profile());let calls=0;
  const result=await p.run({adapter:{profile:profile(),generate:async()=>{calls++;return {status:'completed',output:value};}},isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'fallback');assert.equal(result.reason,'duration_source_mismatch');assert.equal(result.candidate,null);assert.equal(calls,1);
  assert.deepEqual(value,before);assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
});

test('all visible raw fields are checked before existing normalization can remove an unsupported duration',async()=>{
  const c=ctx(),p=await prepareSourceCheckedReflectRun(c,profile());
  const variants=[raw({goal:'理清两小时的安排'}),raw({title:'两小时的等待'}),raw({reply:'先留住影响。是不是等了两小时？'}),
    raw({question:{text:'是不是等了两小时？',target:'event',evidenceIds:['u1']}}),
    raw({claims:[{type:'thought',text:'等了两小时。',evidenceIds:['u1'],derivation:'inferred',supersedes:[]}]})];
  for(const value of variants){assert.equal(p.checkDuration(value).ok,false);assert.equal(p.validateCandidate(value,c).reason,'duration_source_mismatch');}
  const before=raw({reply:'先留住影响。是不是等了两小时？'});assert.equal(validateClarityResponse(before,c).ok,true);
  assert.doesNotMatch(validateClarityResponse(before,c).candidate.reply,/两小时/u);
});

test('native review and compiled Host material are both checked while only original public fields leave Runtime',async()=>{
  const c={...ctx(),stage:'review'},p=await prepareSourceCheckedReviewRun(c,profile()),value={reply:'留给看书的时间被占了。',title:'这次等待',claims:[]};
  const checked=p.validateSelection(value,c);assert.equal(checked.ok,true);assert.equal(checked.durationTrace.compiled.ok,true);
  assert.match(checked.candidate.claims[0].text,/半小时/u);
  const result=await p.run({adapter:adapter(value),isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'candidate');assert.equal(result.policyVersion,SOURCE_CHECKED_REVIEW_POLICY);assert.equal(result.schemaVersion,'liubai-clarity-1');
  assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion'].sort());
  assert.deepEqual(Object.keys(result.candidate).sort(),['modeId','goal','reply','question','claims','finish','title'].sort());
  assert.equal(result.candidate.claims[0].text,p.ledger.retainedText);
});

test('post-compilation check rejects a model-derived old goal that is not a user duration source',async()=>{
  const c={...ctx(),stage:'review',goal:'梳理两小时的等待'},p=await prepareSourceCheckedReviewRun(c,profile());
  const value={reply:'先保留已经说出的经过。',title:'这次等待',claims:[]};
  assert.equal(p.checkDuration(value).ok,true); // The private review has no goal field.
  assert.equal(p.validateSelection(value,c).reason,'duration_source_mismatch');
  assert.equal((await p.run({adapter:adapter(value),isCurrent:()=>true,timeoutMs:1000})).status,'fallback');
});

test('reflect with an existing Host finish plan adds no new continuation question',async()=>{
  const c=ctx('今天等了半小时。只留原话，不用分析。'),p=await prepareSourceCheckedReflectRun(c,profile());
  assert.equal(JSON.parse(p.requestData.input.content).turnPlan.finish,true);
  assert.doesNotMatch(p.requestData.instruction.text,/【具体承接与开放追问】/u);assert.match(p.requestData.instruction.text,/【有依据的收尾】/u);
  const value=raw({modeId:'moment',goal:'留下原话',title:'今天的等待',reply:'先把这句话留下。',finish:true,question:null,
    claims:[{type:'event',text:'今天等了半小时。',evidenceIds:['u1'],derivation:'stated',supersedes:[]}]});
  const result=await p.run({adapter:adapter(value),isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'candidate');assert.equal(result.candidate.finish,true);assert.equal(result.candidate.question,null);
});

test('model mode cannot turn off a personal guard; only explicit Host knowledge purpose is out of coverage',async()=>{
  const c=ctx(),p=await prepareSourceCheckedReflectRun(c,profile()),value=raw({modeId:'moment',reply:'我们先看看两小时的影响。',question:{text:'你想从哪里说起？',target:'unknown',evidenceIds:['u1']}});
  assert.equal((await p.run({adapter:adapter(value),isCurrent:()=>true,timeoutMs:1000})).reason,'duration_source_mismatch');
  const knowledge=ctx('一般如何观察鸟？');knowledge.modeId='auto';knowledge.goal=null;
  const kp=await prepareSourceCheckedReflectRun(knowledge,profile(),{purpose:'knowledge_opener'}),kv=raw({modeId:'moment',reply:'有人会先观察半小时，再决定想看的方面。',question:{text:'你想了解什么方面？',target:'unknown',evidenceIds:['u1']}});
  assert.equal(kp.checkDuration(kv).status,'not_applicable');assert.equal(kp.durationTrace.coverage,'not_applicable_host_knowledge_scope');
  assert.equal((await kp.run({adapter:adapter(kv),isCurrent:()=>true,timeoutMs:1000})).status,'candidate');
  await assert.rejects(prepareSourceCheckedReflectRun(c,profile(),{purpose:'model_says_knowledge'}),/unsupported_source_checked_scope/);
});

test('unsupported duration sources refuse preparation; legal duration words cannot rescue illegal claim sources',async()=>{
  const c=ctx('她说“要等两小时”。');await assert.rejects(prepareSourceCheckedReflectRun(c,profile()),/unsupported_duration_source_scope/);
  const p=await prepareSourceCheckedReflectRun(ctx(),profile()),bad=raw({claims:[{type:'thought',text:'半小时的等候。',evidenceIds:['foreign'],derivation:'inferred',supersedes:[]}]});
  assert.equal(p.checkDuration(bad).ok,true);assert.equal(p.validateCandidate(bad,ctx()).ok,false);
});

test('pre-await context/profile and Host purpose are fixed, and cancellation or late output never retries',async()=>{
  const c=ctx(),pr=profile(),pending=prepareSourceCheckedReflectRun(c,pr,{purpose:'personal_reflection'});c.statements[0].text='改成两小时。';pr.modelId='changed';
  const p=await pending;assert.equal(p.binding.modelId,profile().modelId);assert.equal(p.binding.purpose,'personal_reflection');
  assert.equal(JSON.parse(p.requestData.input.content).statements[0].text,ctx().statements[0].text);assert.equal(p.requestData.policyVersion,SOURCE_CHECKED_REFLECT_POLICY);
  let calls=0;const abort=new AbortController();abort.abort();
  assert.equal((await p.run({adapter:{profile:profile(),generate:async()=>{calls++;}},signal:abort.signal,isCurrent:()=>true,timeoutMs:1000})).status,'discarded');assert.equal(calls,0);
  let current=true;const result=await p.run({adapter:{profile:profile(),generate:async()=>{calls++;current=false;return {status:'completed',output:raw()};}},isCurrent:()=>current,timeoutMs:1000});
  assert.equal(result.status,'discarded');assert.equal(calls,1);
});
