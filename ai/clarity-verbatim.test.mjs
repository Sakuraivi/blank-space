import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../public/clarity-state.mjs';
const raw = '今天自己做的面很好吃，我很开心。只想留住这一句，不需要分析或建议。';
const content = '今天自己做的面很好吃，我很开心。';
const store = () => {
  const values = new Map([['liubai.records.v1','[]']]);
  return { values, getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value) };
};

test('an explicit first-expression record becomes a user-authored review without an AI attempt', () => {
  const s = state.createClaritySession();
  assert.deepEqual(state.keepClarityVerbatim(s,raw),{handled:true,ok:true});
  assert.equal(s.stage,'reviewing'); assert.equal(s.complete,true); assert.equal(s.stale,false);
  assert.equal(s.callCount,0); assert.equal(s.pending,null); assert.equal(s.claims.length,0);
  assert.deepEqual(s.messages,[{role:'user',statementId:'u1'}]);
  assert.equal(s.statements[0].text,raw);
  assert.equal(s.review.blocks.length,1); assert.equal(s.review.blocks[0].text,content);
  assert.deepEqual(s.review.blocks[0].claimIds,[]);
  const storage = store(), saved = state.saveClarityRecord(s,storage);
  assert.equal(saved.ok,true); assert.equal(s.callCount,0);
  assert.equal(storage.values.get('liubai.records.v1'),'[]');
  const [reopened] = state.readRecordEntries(storage);
  assert.equal(reopened.record.review.blocks[0].text,content);
  assert.match(state.recordText(reopened.record),/今天自己做的面很好吃，我很开心。/);
  assert.doesNotMatch(state.recordText(reopened.record),/只想|不需要分析|statements|claims/);
});

test('local record capacity is the input boundary, not the model single-claim boundary', () => {
  const s = state.createClaritySession(), value = '春'.repeat(280)+'。\n  第二行，保留原来的间距。';
  assert.deepEqual(state.keepClarityVerbatim(s,value+'\n只想保留原话。'),{handled:true,ok:true});
  assert.equal(s.review.blocks[0].text,value); assert.equal(s.callCount,0);
  assert.equal(state.saveClarityRecord(s,store()).ok,true);
});

test('a directive without content requests words without mutating state or starting AI', () => {
  const s=state.createClaritySession(), before=structuredClone(s);
  assert.deepEqual(state.keepClarityVerbatim(s,'只想留住这一句，不需要分析或建议。'),{handled:true,ok:false,reason:'missing_verbatim'});
  assert.deepEqual(s,before);
});

test('ordinary, quoted, comma-linked and non-record requests stay on the existing path unchanged', () => {
  for (const value of ['今天很开心。','朋友说，只想留住这一句。','她说“只想留住这一句。”我有点困惑。','今天有点烦。不需要分析或建议。','今天很开心。只想留住这一句。其实还想聊聊。']) {
    const s=state.createClaritySession(), before=structuredClone(s);
    assert.deepEqual(state.keepClarityVerbatim(s,value),{handled:false},value); assert.deepEqual(s,before);
  }
});

test('local detection cannot overwrite a pending, existing, removed or protected conversation', () => {
  const variations = [
    s=>{state.addExpression(s,'前面已经说过的事。');},
    s=>{s.pending={requestId:'existing'};},
    s=>{s.review={title:'手动记录',blocks:[{id:'context',text:'原有内容',edited:true}]};},
    s=>{s.claims.push({id:'protected',status:'confirmed',locked:true});},
    s=>{s.messages.push({role:'assistant',text:'原有回应'});},
    s=>{s.dialogue.push({question:'原有问题',answerId:'u1'});},
    s=>{s.removed.push({index:0,block:{text:'刚移除的段落'}});},
    s=>{s.callCount=1;},
  ];
  for(const change of variations){ const s=state.createClaritySession(); change(s); const before=structuredClone(s);
    assert.deepEqual(state.keepClarityVerbatim(s,raw),{handled:false}); assert.deepEqual(s,before); }
});

test('input rejection, repeated submit and storage failure preserve the local draft', () => {
  const s=state.createClaritySession(), before=structuredClone(s);
  assert.deepEqual(state.keepClarityVerbatim(s,'字'.repeat(4001)+'。只想保留原话。'),{handled:false}); assert.deepEqual(s,before);
  assert.equal(state.keepClarityVerbatim(s,raw).ok,true); const ready=structuredClone(s);
  assert.deepEqual(state.keepClarityVerbatim(s,raw),{handled:false}); assert.deepEqual(s,ready);
  assert.equal(state.saveClarityRecord(s,{getItem:()=>null,setItem:()=>{throw Error('quota');}}).reason,'storage_failed');
  assert.equal(s.stage,'reviewing'); assert.equal(s.review.blocks[0].text,content); assert.equal(s.callCount,0);
});
