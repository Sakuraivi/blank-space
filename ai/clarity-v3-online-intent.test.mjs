import test from 'node:test';
import assert from 'node:assert/strict';
import {expressionPartsV3,deriveConversationPolicy,shouldGenerateClarityReply} from '../public/clarity-v3-intent.mjs';
import {createClaritySession,addExpression,conversationControl,beginClarityRequest,applyClarityReply,openClarityReview} from '../public/clarity-v3-state.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION} from '../public/clarity-v3-contract.mjs';
const story='周末想做点工作的事，但是一直在做自己的事。';
test('natural explicit analysis requests trigger one reflective response with existing material',()=>{
  for(const text of ['你的拆解是什么？','你对这件事的分析是什么？','能帮我分析下吗？','帮我拆解一下。','你能不能帮我理清这件事？','我该怎么计划安排','我应该如何安排比较好？']){
    const value=text,s=createClaritySession();addExpression(s,story);
    const parts=expressionPartsV3(value),policy=conversationControl(s,value);
    assert.equal(parts.content,'',value);assert.ok(parts.controls.some(c=>c.type==='interpret'),value);
    assert.equal(shouldGenerateClarityReply(parts,policy),true,value);
    s.question={text:'当时发生了什么？',target:'event',evidenceIds:['u1']};addExpression(s,value,{kind:'request'});
    const ticket=beginClarityRequest(s);assert.equal(ticket.kind,'reflect');assert.equal(ticket.context.dialogue.length,0);
    assert.equal(ticket.context.statements[1].kind,'request');assert.equal(deriveConversationPolicy(ticket.context).materials.length,1);
  }
});
test('quoted analysis words stay data, and preference or stop controls do not dispatch',()=>{
  for(const text of ['她问“你的拆解是什么？”','我把“你的分析是什么”写在纸上。','她问“我该怎么计划安排”。'])assert.equal(expressionPartsV3(text).controls.some(c=>c.type==='interpret'),false);
  const s=createClaritySession();addExpression(s,story);
  for(const text of ['不用分析。','别问了。','先到这里，不保存。','暂停一下。'])assert.equal(shouldGenerateClarityReply(expressionPartsV3(text),conversationControl(s,text)),false,text);
});
test('an analysis request without life material stays local until there is something to discuss',()=>{
  const s=createClaritySession(),text='你的拆解是什么？';
  assert.equal(shouldGenerateClarityReply(expressionPartsV3(text),conversationControl(s,text)),false);
  assert.equal(s.callCount,0);
});
test('explicit closure generates a real review even when reflection has no understanding yet',()=>{
  const s=createClaritySession();addExpression(s,story);addExpression(s,'我该怎么计划安排。',{kind:'request'});
  const calls=s.callCount,text='请AI整理成一份。',parts=expressionPartsV3(text),policy=conversationControl(s,text);
  assert.equal(shouldGenerateClarityReply(parts,policy),true);
  addExpression(s,text,{kind:'request'});const ticket=beginClarityRequest(s,{review:true});
  assert.equal(ticket.kind,'review');assert.equal(s.callCount,calls+1);assert.equal(s.review,null);
  const candidate={modeId:'concern',goal:'理清安排',reply:'先把原计划与实际经历分开。',question:null,finish:true,title:'工作打算与自己的事',
    claims:[{type:'insight',text:'我想先分清原本想做的工作，与实际花时间做的事，再决定怎样安排。',evidenceIds:['u1'],derivation:'inferred',supersedes:[]}]};
  assert.equal(applyClarityReply(s,ticket,{status:'candidate',flow:CLARITY_FLOW,schemaVersion:CLARITY_SCHEMA_VERSION,policyVersion:ticket.policyVersion,requestId:ticket.requestId,revision:ticket.revision,candidate}).ok,true);
  assert.equal(s.stage,'reviewing');assert.equal(s.review.blocks.find(b=>b.id==='insight').text,candidate.claims[0].text);
  assert.equal(s.review.blocks.find(b=>b.id==='source').text,story);
  assert.ok(!s.review.blocks.find(b=>b.id==='source').text.includes('请AI'));
});
