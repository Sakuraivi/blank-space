import test from 'node:test';
import assert from 'node:assert/strict';
import {expressionPartsV3,deriveConversationPolicy,shouldGenerateClarityReply} from '../public/clarity-v3-intent.mjs';
import {createClaritySession,addExpression,conversationControl,beginClarityRequest} from '../public/clarity-v3-state.mjs';
const story='周末想做点工作的事，但是一直在做自己的事。';
test('natural explicit analysis requests trigger one reflective response with existing material',()=>{
  for(const text of ['你的拆解是什么？','你对这件事的分析是什么？','能帮我分析下吗？','帮我拆解一下。','你能不能帮我理清这件事？']){
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
  for(const text of ['她问“你的拆解是什么？”','我把“你的分析是什么”写在纸上。'])assert.equal(expressionPartsV3(text).controls.some(c=>c.type==='interpret'),false);
  const s=createClaritySession();addExpression(s,story);
  for(const text of ['不用分析。','别问了。','先到这里，不保存。','暂停一下。'])assert.equal(shouldGenerateClarityReply(expressionPartsV3(text),conversationControl(s,text)),false,text);
});
test('an analysis request without life material stays local until there is something to discuss',()=>{
  const s=createClaritySession(),text='你的拆解是什么？';
  assert.equal(shouldGenerateClarityReply(expressionPartsV3(text),conversationControl(s,text)),false);
  assert.equal(s.callCount,0);
});
