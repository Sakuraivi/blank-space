import test from 'node:test';import assert from 'node:assert/strict';
import {checkClarityContext,buildClarityContext,validateClarityCandidate,CLARITY_FLOW,CLARITY_SCHEMA_VERSION} from '../public/clarity-v3-contract.mjs';
import {validateClarityCandidate as oldValidate} from '../public/clarity-contract.mjs';
const ctx=(texts=['今天周末还在写代码。'],extra={})=>({sessionId:'v3_test',revision:texts.length,stage:'reflect',allowNextStep:false,modeId:'auto',goal:null,
 statements:texts.map((text,i)=>({id:`u${i+1}`,text,kind:'expression'})),dialogue:[],claims:[],...extra});
const raw=(extra={})=>({modeId:'moment',goal:'说说今天',reply:'周末的下午也投入在开发里了。',question:null,claims:[],finish:false,title:'周末的下午',...extra});
test('new seven fields allow null question continuation while old v2 keeps rejecting it',()=>{
 assert.equal(CLARITY_FLOW,'clarity-v3');assert.equal(CLARITY_SCHEMA_VERSION,'liubai-clarity-2');const value=raw();
 assert.equal(validateClarityCandidate(value,ctx()).ok,true);assert.equal(oldValidate(value,ctx()).reason,'missing_question');assert.deepEqual(value,raw());
 assert.equal(validateClarityCandidate(raw({finish:true}),ctx()).reason,'unexpected_finish');
});
test('four and twelve real question-answer links remain intact; independent capacities reject instead of slicing',()=>{
 const c=ctx(Array.from({length:12},(_,i)=>`生活片段${i}。`));c.dialogue=c.statements.map((s,i)=>({question:`第${i}次发生了什么？`,answerId:s.id}));checkClarityContext(c);
 const session={id:c.sessionId,modeId:c.modeId,goal:c.goal,statements:c.statements,dialogue:c.dialogue,claims:c.claims},copy=buildClarityContext({session,revision:c.revision});
 assert.equal(copy.dialogue.length,12);assert.notEqual(copy.dialogue,c.dialogue);
 assert.throws(()=>checkClarityContext({...c,statements:[...c.statements,{id:'u13',text:'第十三件。',kind:'expression'}]}));
 assert.throws(()=>checkClarityContext({...c,dialogue:[...c.dialogue,{...c.dialogue[0]}]}));
 const q=raw({question:{text:'另一件相关的小事呢？',target:'event',evidenceIds:['u12']}});assert.equal(validateClarityCandidate(q,c).ok,true);
});
test('question, explicit interpretation, action and reply checks cannot hide violations',()=>{
 const c=ctx(['不用追问。','今天很累。']),q=raw({question:{text:'发生了什么？',target:'event',evidenceIds:['u2']}});
 assert.equal(validateClarityCandidate(q,c).reason,'question_not_allowed');
 assert.equal(validateClarityCandidate(raw({reply:'今天很累。为什么呢？'}),c).reason,'question_in_reply');
 const insight={type:'insight',text:'我想被认可。',evidenceIds:['u2'],derivation:'inferred',supersedes:[]};assert.equal(validateClarityCandidate(raw({claims:[insight]}),c).reason,'interpretation_not_allowed');
 const allowed=ctx(['可以分析，但别再问。','今天很累。']);assert.equal(validateClarityCandidate(raw({claims:[insight]}),allowed).ok,true);
 assert.equal(validateClarityCandidate(raw({claims:[{...insight,type:'action'}]}),allowed).reason,'action_not_allowed');
});
test('review and independently authorized action cannot overwrite each other',()=>{
 const event={type:'event',text:'今天周末还在写代码。',evidenceIds:['u1'],derivation:'stated',supersedes:[]};
 assert.equal(validateClarityCandidate(raw({finish:true,claims:[event]}),ctx(undefined,{stage:'review'})).ok,true);
 assert.equal(validateClarityCandidate(raw({finish:true,claims:[event]}),ctx(undefined,{allowNextStep:true})).reason,'action_only');
 const action={...event,type:'action',text:'如果愿意，可以先休息一会。',derivation:'inferred'};
 assert.equal(validateClarityCandidate(raw({finish:true,claims:[action]}),ctx(undefined,{allowNextStep:true})).ok,true);
 assert.equal(validateClarityCandidate(raw({finish:true,claims:[event],question:null,extra:true}),ctx(undefined,{stage:'review'})).ok,false);
});
