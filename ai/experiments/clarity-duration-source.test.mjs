import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDurationSourceCheck,DURATION_SOURCE_VERSION} from './clarity-duration-source.mjs';

const context=(texts=['我花了半小时。'])=>({sessionId:'duration_synthetic',revision:texts.length,stage:'reflect',allowNextStep:false,modeId:'auto',goal:null,
  statements:texts.map((text,i)=>({id:`u${i+1}`,kind:'expression',text})),dialogue:[],claims:[]});
const prepare=c=>prepareDurationSourceCheck(c,{purpose:'personal_reflection'});
const candidate=(text='先聊聊刚才的事。')=>({modeId:'concern',goal:'梳理这件事',title:'慢慢说',reply:text,question:{text:'当时是什么情形？',target:'event',evidenceIds:['u1']},claims:[],finish:false});
const native=text=>({reply:text,title:'这一刻',claims:[]});
const unverified=result=>{assert.equal(result.coverage,'duration_surface_forms_only');assert.equal(result.semanticTruth,'unverified');assert.equal(result.attribution,'unverified');};

test('the original two-hour invention is rejected; a nonquantified duration question remains legal',()=>{
  const p=prepare(context());assert.equal(p.trace.status,'ready');
  const added=p.check(candidate('那两小时的投入值得被接住。'));
  assert.equal(added.ok,false);assert.equal(added.status,'rejected');assert.equal(added.reason,'new_duration_surface_form');unverified(added);
  assert.deepEqual(added.outputForms.map(v=>v.text),['两小时']);assert.deepEqual(added.outputForms[0].matchingSourceSpans,[]);
  const q=candidate();q.question.text='用了多久？';assert.equal(p.check(q).ok,true);
  q.question.text='是不是两小时？';assert.equal(p.check(q).status,'rejected');
});

test('strict literal integer and half-hour grammar is accepted without numeric normalization',()=>{
  for(const form of ['0分钟','1小时','12小时','120分钟','一小时','两小时','十分钟','十一分钟','二十分钟','九十九分钟',
    '一个小时','两个小时','半小时','半个小时','一小时半','2小时半','一个小时半','两个半小时']){
    const p=prepare(context([`我花了${form}。`]));assert.equal(p.trace.status,'ready',form);assert.equal(p.trace.sourceForms[0].text,form);
    assert.equal(p.check(native(`我记得这${form}。`)).ok,true,form);
  }
  assert.equal(prepare(context(['我花了20分钟。'])).check(native('我花了二十分钟。')).status,'rejected');
  assert.equal(prepare(context(['我花了两小时。'])).check(native('我花了二小时。')).status,'rejected');
});

test('no conversion or arithmetic is performed',()=>{
  const p=prepare(context(['两次各半小时。']));assert.equal(p.trace.status,'ready');
  for(const text of ['两次总共一小时。','那是30分钟。','两小时。','60分钟。'])assert.equal(p.check(native(text)).status,'rejected',text);
  assert.equal(p.check(native('每次半小时。')).ok,true);
});

test('every public or native candidate text field is scanned, including all claims',()=>{
  const p=prepare(context());
  for(const field of ['goal','title','reply','question.text','claims[0].text','claims[1].text']){
    const c=candidate();c.claims=[{type:'insight',text:'留住已有表达。',anchorIds:['m1']},{type:'unknown',text:'还有未确认的部分。',anchorIds:['m1']}];
    if(field==='question.text')c.question.text='是不是两小时？';
    else if(field.startsWith('claims'))c.claims[Number(field[7])].text='用了两小时。';else c[field]='用了两小时。';
    const checked=p.check(c);assert.equal(checked.status,'rejected',field);assert.equal(checked.issues[0].field,field);
  }
  assert.equal(p.check({reply:'半小时。',title:'原话',claims:[{type:'insight',text:'两小时。',anchorIds:['m1']}]}).status,'rejected');
  const c=candidate();c.schemaVersion='two_hours_2小时';c.question.evidenceIds=['id_2小时'];
  assert.equal(p.check(c).ok,true,'schema and IDs are outside the text scanner; normal schema validation remains external');
});

test('adjacent qualifiers are part of the exact surface rather than silently stripped',()=>{
  for(const form of ['约两小时','约莫半小时','近半小时','大约半小时','不到两个小时','至少20分钟','最多一小时','不超过半小时','两小时左右','半小时上下','约两小时左右']){
    const p=prepare(context([`这次用了${form}。`]));assert.equal(p.trace.status,'ready',form);assert.equal(p.trace.sourceForms[0].text,form);
    assert.equal(p.check(native(`这次是${form}。`)).ok,true,form);
    assert.equal(p.check(native('两小时。')).status,'rejected',form);
  }
  const p=prepare(context(['我花了两小时。']));assert.equal(p.check(native('大约两小时。')).status,'rejected');
});

test('nonadjacent or unsupported qualifier scopes fail closed in source and output',()=>{
  for(const text of ['大约花了两小时。','至少等了半小时。','约用了两小时。','两小时多一点。','不超过大约两小时。','约 半小时。','用了半小时 多。']){
    const p=prepare(context([text]));assert.equal(p.trace.status,'unsupported',text);assert.equal(p.check(native('先停在这里。')).status,'unsupported');
  }
  assert.equal(prepare(context()).check(native('大概用了半小时。')).status,'unsupported');
  const weekday=prepare(context(['原本只约好我周二、周五浇。那两次各花了半小时。']));
  assert.equal(weekday.trace.status,'ready');assert.deepEqual(weekday.trace.sourceForms.map(v=>v.text),['半小时']);
  const appointment=prepare(context(['约朋友聊半小时。']));
  assert.equal(appointment.trace.status,'ready');assert.deepEqual(appointment.trace.sourceForms.map(v=>v.text),['半小时']);
  assert.equal(prepare(context(['大约用了半小时。'])).trace.status,'unsupported');
  assert.equal(prepare(context()).check(native('约 半小时。')).status,'unsupported');
  assert.equal(prepare(context()).check(native('用了半小时 多。')).status,'unsupported');
  assert.equal(prepare(context(['那两次我各多走了十分钟。'])).trace.status,'ready');
  const bounded=prepare(context(['我还没到半小时就结束了。']));
  assert.equal(bounded.trace.status,'ready');assert.deepEqual(bounded.trace.sourceForms.map(v=>v.text),['没到半小时']);
  assert.equal(bounded.check(native('半小时。')).status,'rejected');assert.equal(bounded.check(native('没到半小时。')).ok,true);
});

test('wide atoms reject decimals, ranges, aliases and malformed units without accepting a numeric substring',()=>{
  for(const text of ['2.5小时','２小时','2．5小时','二点五小时','.5小时','-2小时','负5小时','负 5小时','01小时','一百小时','几小时','½小时','2_5小时','2e3小时',
    '1-2小时','一到两个小时','2～3小时','1/2小时','一、二小时','2 小时','两小时30分钟','两小时半钟','两小时到三小时','两小时~三小时',
    '半钟头','十来分钟','两个多小时','一刻钟','2h','2 hours','half an hour','twenty hours','hours','several minutes','两秒','半天','第二小时']){
    const p=prepare(context([`用了${text}。`]));assert.equal(p.trace.status,'unsupported',text);
    const checked=prepare(context(['我花了5小时。'])).check(native(`用了${text}。`));assert.equal(checked.status,'unsupported',text);
  }
  const decimal=prepare(context(['我花了5小时。'])).check(native('2.5小时。'));
  assert.deepEqual(decimal.outputForms.map(v=>v.text),['2.5小时']);assert.deepEqual(decimal.outputForms[0].matchingSourceSpans,[]);
  const negative=prepare(context(['我花了5小时。'])).check(native('负5小时。'));
  assert.equal(negative.status,'unsupported');assert.deepEqual(negative.outputForms.map(v=>v.text),['负5小时']);
  assert.deepEqual(negative.outputForms[0].matchingSourceSpans,[]);
  assert.equal(prepare(context()).check(native('用了多久？')).ok,true);
});

test('request-kind durations do not supply values and mode cannot bypass the Host purpose',()=>{
  const c=context(['今天想聊聊。','请你写成两小时。']);c.statements[1].kind='request';
  const p=prepare(c);assert.equal(p.trace.status,'ready');assert.deepEqual(p.trace.sourceForms,[]);assert.deepEqual(p.trace.skippedRequestIds,['u2']);
  const output={...candidate('两小时。'),modeId:'moment'};assert.equal(p.check(output).status,'rejected');
  for(const purpose of [undefined,'knowledge','knowledge_probe','moment',null]){
    const unsupported=prepareDurationSourceCheck(context(),{purpose});assert.equal(unsupported.trace.status,'unsupported');assert.equal(unsupported.check(native('半小时。')).status,'unsupported');
  }
});

test('quantity corrections and negated or quoted duration sources are unsupported, without choosing a current value',()=>{
  const correction=context(['我花了半小时。','不是半小时，是两小时。']);correction.statements[1].kind='correction';
  assert.equal(prepare(correction).trace.status,'unsupported');
  const countCorrection=context(['我去了三次。']);countCorrection.statements[0].kind='correction';assert.equal(prepare(countCorrection).trace.status,'unsupported');
  for(const text of ['不是两小时。','我没有花两小时。','两小时不准确。','她说：“我花了两小时。”','“两小时','她说"半小时"。']){
    const p=prepare(context([text]));assert.equal(p.trace.status,'unsupported',text);assert.equal(p.check(native('两小时。')).status,'unsupported');
  }
  assert.equal(prepare(context(['她说“可以”，我花了半小时。'])).trace.status,'ready');
  assert.equal(prepare(context(['我没有带手机，走了半小时。'])).trace.status,'ready');
});

test('all matching source spans and UTF-16 locations are preserved, including duplicates within and across sources',()=>{
  const texts=['🌿我读了半小时，又走了半小时。','我今天也花了半小时。'],p=prepare(context(texts));
  assert.equal(p.trace.status,'ready');assert.equal(p.trace.sourceForms.length,3);
  for(const source of p.trace.sourceForms)assert.equal(texts[Number(source.sourceId.slice(1))-1].slice(source.start,source.end),source.text);
  assert.equal(p.trace.sourceForms[0].start,'🌿我读了'.length);
  const checked=p.check(native('半小时。'));assert.equal(checked.ok,true);assert.equal(checked.outputForms[0].matchingSourceSpans.length,3);
  assert.deepEqual(checked.outputForms[0].matchingSourceSpans.map(v=>v.sourceId),['u1','u1','u2']);
});

test('a wrong owner or false total can pass the same-form check and is explicitly NOT certified',()=>{
  const p=prepare(context(['我读了半小时。','我又走了半小时。']));
  for(const text of ['同事用了半小时。','两次总共半小时。']){
    const checked=p.check(native(text));assert.equal(checked.ok,true);assert.equal(checked.status,'passed');unverified(checked);
  }
  assert.match(p.trace.limitations.join(' '),/ownership or sum verification/u);
});

test('the check captures immutable source data and does not rewrite, retry or validate general counts',()=>{
  const c=context(),p=prepare(c);c.statements[0].text='两小时。';c.revision++;
  assert.equal(p.binding.revision,1);assert.equal(p.binding.version,DURATION_SOURCE_VERSION);assert.equal(p.check(native('两小时。')).status,'rejected');
  const value=candidate('半小时。'),before=structuredClone(value),result=p.check(value);assert.deepEqual(value,before);assert.equal(result.ok,true);
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.binding)&&Object.isFrozen(p.trace)&&Object.isFrozen(p.trace.sourceForms)&&Object.isFrozen(result));
  assert.throws(()=>{p.trace.sourceForms[0].text='两小时';},TypeError);
  assert.equal(prepare(context(['今天有件事。'])).check({...candidate(),question:{text:'能说说最近一次发生时的情形吗？',target:'event',evidenceIds:['u1']}}).ok,true);
  assert.equal(prepare(context(['今天有件事。'])).check(native('我去了三次。')).ok,true);
  assert.equal(p.check({reply:'半小时。',title:'记录',claims:[{text:null}]}).status,'unsupported');
});
