import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProviderRequest} from '../provider-transport.mjs';
import {prepareExampleReviewRun,EXAMPLE_REVIEW_BLOCK} from './clarity-example-review.mjs';
import {MODEL_COMPARISON_ARMS,MODEL_COMPARISON_SOURCE,comparisonRoute,comparisonApiRoute,loadModelComparisonFixtures,
  modelComparisonOrder,modelComparisonRequestId,prepareModelComparisonFixture,prepareModelComparison} from '../../scripts/experiments/clarity-model-comparison-fixtures.mjs';
const RUN='synthetic_models_run',START=1_790_000_000_000;
const stripModel=body=>{const value=structuredClone(body);delete value.model;return value;};
test('eight known contexts and fixed E produce 24 real complete bodies with model as their only difference',async()=>{
  const samples=await loadModelComparisonFixtures();assert.equal(samples.length,8);let maximum=0;
  for(const sample of samples){
    const pair=await prepareModelComparison(sample.context),reference=pair.arms.reference;
    const old=await prepareExampleReviewRun(sample.context,comparisonRoute('reference').profile);
    assert.equal(reference.transport.body,prepareProviderRequest(old.requestData,comparisonRoute('reference')).body);
    const expected=stripModel(JSON.parse(reference.transport.body));
    for(const arm of MODEL_COMPARISON_ARMS){
      const current=pair.arms[arm.id],body=JSON.parse(current.transport.body);
      assert.deepEqual(stripModel(body),expected);assert.equal(body.model,arm.modelId);
      assert.ok(current.prepared.requestData.instruction.text.endsWith(EXAMPLE_REVIEW_BLOCK));
      assert.equal(current.prepared.requestData.output.format,'json_text');assert.equal(body.response_format,undefined);
      assert.equal(current.route.maxRequestBytes,12000);assert.ok(current.transport.byteLength<=12000);
      maximum=Math.max(maximum,current.transport.byteLength);
    }
    assert.equal(pair.control.onlyModelDifference,true);
  }
  assert.ok(maximum>9000&&maximum<12000);
});
test('all registered identities and initial states are independent; order is a rotation, not outcome-dependent',async()=>{
  const samples=await loadModelComparisonFixtures(),ids=new Set(),positions={reference:[0,0,0],max:[0,0,0],flash:[0,0,0]};
  for(const [index,sample]of samples.entries()){
    const sessions=[];
    for(const [position,arm]of modelComparisonOrder(index).entries()){
      positions[arm][position]++;
      const seeded=prepareModelComparisonFixture(sample,RUN,START,arm);
      assert.deepEqual(seeded.context,sample.context);assert.equal(seeded.ticket.requestId,modelComparisonRequestId(RUN,sample.id,arm));
      assert.equal(ids.has(seeded.ticket.requestId),false);ids.add(seeded.ticket.requestId);sessions.push(seeded.session);
    }
    assert.notEqual(sessions[0].statements,sessions[1].statements);sessions[0].statements[0].text='synthetic mutation';
    assert.notEqual(sessions[1].statements[0].text,'synthetic mutation');assert.notEqual(sessions[2].statements[0].text,'synthetic mutation');
  }
  assert.equal(ids.size,24);for(const counts of Object.values(positions))assert.deepEqual([...counts].sort(),[2,3,3]);
});
test('candidate selection is a closed server plan and cannot widen endpoints, source ownership or output limits',()=>{
  for(const arm of MODEL_COMPARISON_ARMS){
    const route=comparisonRoute(arm.id);assert.equal(route.endpoint,'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(route.maxOutputTokens,2000);assert.equal(route.maxPromptTokens,13000);
    assert.deepEqual(comparisonApiRoute(arm.id),{...MODEL_COMPARISON_SOURCE,modelId:arm.modelId});
  }
  for(const arm of ['custom','openai','https://example.com','reference/../max']){
    assert.throws(()=>comparisonRoute(arm),/invalid_model_arm/);assert.throws(()=>comparisonApiRoute(arm),/invalid_model_arm/);
  }
  assert.throws(()=>modelComparisonRequestId('short','case','max'),/identity/);
  assert.throws(()=>modelComparisonOrder(8),/case_index/);
});
test('preparation snapshots inputs before async work instead of borrowing a later source revision',async()=>{
  const sample=(await loadModelComparisonFixtures())[0],context=structuredClone(sample.context),original=structuredClone(context);
  const pending=prepareModelComparison(context);context.statements[0].text='caller changed this after the operation started';
  const result=await pending,expected=await prepareModelComparison(original);
  for(const arm of MODEL_COMPARISON_ARMS)assert.equal(result.arms[arm.id].transport.body,expected.arms[arm.id].transport.body);
});
