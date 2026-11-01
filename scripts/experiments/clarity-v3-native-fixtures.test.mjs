import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_CASES,NATIVE_SLOT_IDS,prepareNativeFixture} from './clarity-v3-native-fixtures.mjs';
import {deriveConversationPolicy} from '../../public/clarity-v3-intent.mjs';
import {buildClarityModelRequest} from '../../ai/clarity-v3.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';

test('fixed snapshots have exact deterministic inputs and no invented model history or future material',()=>{
  for(const id of NATIVE_SLOT_IDS){
    const a=prepareNativeFixture(id,'native20261101a'),b=prepareNativeFixture(id,'native20261101a');
    assert.deepEqual(a,b);assert.deepEqual(a.context.claims,[]);assert.deepEqual(a.context.dialogue,[]);
    assert.equal(a.session.messages.filter(m=>m.role==='assistant').length,0);
    assert.deepEqual(a.context.statements.map(s=>s.text),a.sample.entries);
    assert.ok(a.context.statements.every(s=>s.kind==='expression'));
    assert.equal(a.session.review,null);
  }
  assert.equal(prepareNativeFixture('listen','native20261101a').context.statements.length,2);
  assert.equal(prepareNativeFixture('continue','native20261101a').context.statements.length,3);
});
test('native requests use the unchanged public seven-field contract and trusted capacity',()=>{
  const route=getPersonalRoute('bailian','deepseek-v4-pro-0813');
  for(const sample of NATIVE_CASES.filter(s=>s.id!=='stop')){
    const {context,ticket}=prepareNativeFixture(sample.id,'native20261101a'),policy=deriveConversationPolicy(context);
    for(const [key,value]of Object.entries(sample.expected))assert.equal(key==='stage'?context.stage:policy[key],value,`${sample.id}:${key}`);
    const request=buildClarityModelRequest(context,route.profile),body=prepareProviderRequest(request,route);
    assert.equal(request.policyVersion,'clarity-listening-2');assert.equal(request.schemaVersion,'liubai-clarity-2');
    assert.ok(body.byteLength<=route.maxRequestBytes);assert.equal(ticket.kind,sample.expected.stage);
    const input=JSON.parse(request.input.content);assert.equal(Object.hasOwn(input,'expected'),false);
    assert.deepEqual(input.context.claims,[]);
  }
});
test('stop is a local control and invalid registrations fail before generating',()=>{
  const value=prepareNativeFixture('stop','native20261101a'),policy=deriveConversationPolicy(value.context);
  assert.equal(value.ticket,null);assert.equal(value.session.callCount,0);
  assert.equal(policy.endRequested,true);assert.equal(policy.discardRequested,true);
  assert.throws(()=>buildClarityModelRequest(value.context,getPersonalRoute('bailian','deepseek-v4-pro-0813').profile),/generation_not_allowed/);
  assert.throws(()=>prepareNativeFixture('other','native20261101a'),/invalid_native_slot/);
  assert.throws(()=>prepareNativeFixture('listen','short'),/invalid_native_run_id/);
});
