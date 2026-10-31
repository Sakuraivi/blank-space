import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRetainedConcernRun,prepareFaithfulRetainedConcernRun,FAITHFUL_RETAINED_CONCERN_POLICY} from './clarity-retained-concern.mjs';
import {getPersonalRoute} from '../providers.mjs';
import {prepareV2Step,V2_CASE_IDS} from '../../scripts/experiments/clarity-material-v2-fixtures.mjs';
const route=getPersonalRoute('bailian','deepseek-v4-pro-0813');
const context=()=>prepareV2Step(V2_CASE_IDS[0],'faithful_policy',1_790_000_000_000,1).context;

test('faithful policy preserves v3 wire, material and public output with an independently bound new instruction',async()=>{
  const c=context(),old=await prepareRetainedConcernRun(c,route.profile),next=await prepareFaithfulRetainedConcernRun(c,route.profile);
  assert.equal(old.requestData.policyVersion,'clarity-material-experiment-3');assert.equal(next.requestData.policyVersion,FAITHFUL_RETAINED_CONCERN_POLICY);
  assert.equal(next.requestData.schemaVersion,old.requestData.schemaVersion);assert.deepEqual(next.requestData.input,old.requestData.input);
  assert.equal(next.requestData.instruction.text.startsWith(old.requestData.instruction.text),true);
  assert.deepEqual(next.ledger,old.ledger);assert.equal(Object.hasOwn(old.binding,'policyVersion'),false);
  const output={reply:'已经表达的部分先留下。',title:'这次的表达',claims:[]};
  const one=await old.run({adapter:{profile:route.profile,generate:async()=>({status:'completed',output})},isCurrent:()=>true,timeoutMs:1000});
  const two=await next.run({adapter:{profile:route.profile,generate:async()=>({status:'completed',output})},isCurrent:()=>true,timeoutMs:1000});
  assert.equal(two.status,'candidate');assert.deepEqual(two.candidate,one.candidate);assert.equal(two.schemaVersion,'liubai-clarity-1');
  assert.equal(two.policyVersion,FAITHFUL_RETAINED_CONCERN_POLICY);assert.equal(two.candidate.claims[0].text,next.ledger.retainedText);
  assert.deepEqual(Object.keys(two).sort(),['candidate','policyVersion','schemaVersion','status']);
});

test('new wording does not certify semantics or repair invalid evidence',async()=>{
  const c=context(),run=await prepareFaithfulRetainedConcernRun(c,route.profile),anchor=run.ledger.activeAnchorIds[0];
  const wrong={reply:'先留着。',title:'这次表达',claims:[{type:'insight',text:'我愿意接受所有后续安排。',anchorIds:[anchor]}]};
  assert.equal(run.validateSelection(wrong,c).ok,true); // Legal references cannot certify this unsupported interpretation.
  assert.equal(run.validateSelection({...wrong,claims:[{...wrong.claims[0],anchorIds:['not_real']}]},c).ok,false);
  let calls=0;const result=await run.run({adapter:{profile:route.profile,generate:async()=>{calls++;return {status:'completed',output:{...wrong,event:'cannot_add'}};}},isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'fallback');assert.equal(calls,1);
});

test('new policy captures material/profile before await and discards cancelled output',async()=>{
  const c=context(),p=structuredClone(route.profile),pending=prepareFaithfulRetainedConcernRun(c,p);c.statements[0].text='mutated';p.modelId='other';
  const run=await pending;assert.doesNotMatch(run.ledger.retainedText,/mutated/u);assert.equal(run.binding.modelId,route.profile.modelId);
  let calls=0;const controller=new AbortController();controller.abort();
  const result=await run.run({adapter:{profile:route.profile,generate:async()=>{calls++;}},signal:controller.signal,isCurrent:()=>true,timeoutMs:1000});
  assert.equal(result.status,'discarded');assert.equal(calls,0);
});
