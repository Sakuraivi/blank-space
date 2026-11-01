import test from 'node:test';import assert from 'node:assert/strict';
import {expressionPartsV3,deriveConversationPolicy} from '../public/clarity-v3-intent.mjs';
const ctx=(texts,extra={})=>({stage:'reflect',allowNextStep:false,statements:texts.map((text,i)=>({id:`u${i+1}`,text,kind:'expression'})),...extra});
test('L01: explicit listening and no-question are independent persistent preferences',()=>{
 const p=deriveConversationPolicy(ctx(['今天只是想说说，先不用问，也不用分析。','今天周末还在写代码。']));
 assert.equal(p.allowQuestion,false);assert.equal(p.allowInterpretation,false);assert.equal(p.endRequested,false);assert.equal(p.reviewRequested,false);
 assert.deepEqual(p.materials,[{id:'u2',text:'今天周末还在写代码。'}]);
 const q=deriveConversationPolicy(ctx(['不用问，也不用分析。','可以一起分析，但别再问。']));assert.equal(q.allowInterpretation,true);assert.equal(q.allowQuestion,false);
 assert.equal(deriveConversationPolicy(ctx(['不用问。','你可以继续问我。'])).allowQuestion,true);
});

test('ordinary concern permits provisional understanding without a trigger phrase; explicit preferences still win',()=>{
 const p=deriveConversationPolicy(ctx(['周末原本想推进工作，后来忙自己的事，也没休息好。','让我在周末也非常疲惫烦恼。']));
 assert.equal(p.allowInterpretation,true);assert.equal(p.explicitInterpretationBan,false);assert.equal(p.allowQuestion,true);
 assert.equal(p.reviewRequested,false);assert.equal(p.actionRequested,false);assert.equal(p.controls.length,0);assert.equal(p.materials.length,2);
 const noQuestion=deriveConversationPolicy(ctx(['别问了。','这让我很疲惫。']));assert.equal(noQuestion.allowQuestion,false);assert.equal(noQuestion.allowInterpretation,true);
 const listening=deriveConversationPolicy(ctx(['我只想说说，不用分析。','这让我很疲惫。','她说“帮我分析”。']));
 assert.equal(listening.allowInterpretation,false);assert.equal(listening.explicitInterpretationBan,true);
 assert.equal(deriveConversationPolicy(ctx(['不用分析。','这让我很疲惫。','帮我理清。'])).allowInterpretation,true);
});
test('quoted, reported, malformed and ambiguous instructions remain data',()=>{
 for(const value of ['她说“别问了”。','她说，别问了。','我对朋友说，别问了。','朋友说我今天没空，别问了。','她说可以散步，帮我分析。','她说：\n帮我分析。','她对我说：不用分析。','“不用分析','他说：请AI整理成一份。','我不知道是不是该分析。']){
  assert.deepEqual(expressionPartsV3(value),{content:value,controls:[]},value);
 }
 const p=deriveConversationPolicy(ctx(['她说，别问了。','我想一起理清。']));assert.equal(p.allowQuestion,true);assert.equal(p.allowInterpretation,true);
 const current=deriveConversationPolicy(ctx(['我想说一下周末的事，先不用问，也不用分析。']));assert.equal(current.allowQuestion,false);assert.equal(current.allowInterpretation,false);assert.equal(current.controls.length,2);
});
test('L02/L08: ordinary expression stays material and prospective thirteenth control needs no capacity bypass',()=>{
 const texts=Array.from({length:12},(_,i)=>`第${i}件小事。`),p=deriveConversationPolicy(ctx([...texts,'暂停一下。']));
 assert.equal(p.pauseRequested,true);assert.equal(p.materials.length,12);assert.equal(p.intentAction.kind,'pause');
 assert.equal(expressionPartsV3('后来我又去散步了。').controls.length,0);
});
test('one-shot operations expire, review does not reset preferences and stop wins typed review/action',()=>{
 assert.equal(deriveConversationPolicy(ctx(['请AI整理成一份。','后来又有新的经历。'])).reviewRequested,false);
 assert.equal(deriveConversationPolicy(ctx(['生活小事。'],{stage:'review'})).allowInterpretation,true);
 assert.equal(deriveConversationPolicy(ctx(['不用分析。','生活小事。'],{stage:'review'})).allowInterpretation,false);
 assert.equal(deriveConversationPolicy(ctx(['请AI整理成一份。','生活小事。'])).allowInterpretation,true,'ordinary reflection has its own default permission');
 assert.equal(deriveConversationPolicy(ctx(['不用分析。','请AI整理成一份。','生活小事。'])).allowInterpretation,false,'a one-shot review never lifts a personal ban');
 for(const op of ['结束不保存。','暂停一下。','不保存。']){const p=deriveConversationPolicy(ctx(['生活小事。',op],{stage:'review',allowNextStep:true}));assert.equal(p.reviewRequested,false);assert.equal(p.actionRequested,false);}
 const d=deriveConversationPolicy(ctx(['不保存。']));assert.equal(d.discardRequested,true);assert.equal(d.endRequested,false);
 const e=deriveConversationPolicy(ctx(['到这里吧，不保存。']));assert.equal(e.endRequested,true);assert.equal(e.discardRequested,true);
});
test('record instruction is current-only and never turns listening into ending',()=>{
 const p=deriveConversationPolicy(ctx(['散步很舒服。只留下这一句。']));assert.equal(p.recordOnly,true);assert.deepEqual(p.materials,[{id:'u1',text:'散步很舒服。'}]);
 assert.equal(deriveConversationPolicy(ctx(['只留下这一句。','后来又想说一点。'])).recordOnly,false);
});
test('explicit combined no-question/no-analysis controls never pollute material; quotes and reports stay data',()=>{
 const value='今天周末我却开发了一下午，只想说说，先别问也不用分析。',p=deriveConversationPolicy(ctx([value]));
 assert.equal(p.allowQuestion,false);assert.equal(p.allowInterpretation,false);assert.equal(p.endRequested,false);
 assert.deepEqual(p.materials,[{id:'u1',text:'今天周末我却开发了一下午，'}]);assert.equal(p.controls.length,2);
 for(const quoted of ['她说“先别问也不用分析”。','朋友说，先别问也不用分析。']){
  const q=deriveConversationPolicy(ctx(['帮我分析。',quoted]));assert.equal(q.allowQuestion,true);assert.equal(q.allowInterpretation,true);assert.deepEqual(q.materials,[{id:'u2',text:quoted}]);
 }
 const ambiguous=expressionPartsV3('先别问或者不用分析。');assert.equal(ambiguous.controls.length,0);assert.equal(ambiguous.content,'先别问或者不用分析。');
});
