import test from 'node:test';
import assert from 'node:assert/strict';
import { materialSentences, groundingPlan } from './clarity-grounding.mjs';
import { validateClarityResponse } from './clarity.mjs';
import { createClaritySession, addExpression, beginClarityRequest } from '../public/clarity-state.mjs';

function context(text, correction) {
  const session = createClaritySession(); addExpression(session, text);
  if (correction) addExpression(session, correction, { kind: 'correction' });
  const result = beginClarityRequest(session).context; result.stage = 'review'; return result;
}
function finish(text, evidenceIds = ['u1']) {
  return { modeId:'concern', goal:'理清等待中的期待', title:'这次的安排', reply:'这里可以把经过和自己的期待分开留下。', question:null, finish:true,
    claims:[{type:'event', text, evidenceIds, derivation:'stated', supersedes:[]}] };
}
test('full source sentences preserve episode qualifiers, quoted speech and decimal numbers', () => {
  const text = '这次她说加班，发了个抱歉表情。上一次是家里有事。她说“抱歉。下周再看”，我还在等。费用是1.5元。';
  assert.deepEqual(materialSentences(text), ['这次她说加班，发了个抱歉表情。','上一次是家里有事。','她说“抱歉。下周再看”，我还在等。','费用是1.5元。']);
  const c = context(text);
  assert.equal(validateClarityResponse(finish(text),c).ok,true);
  for (const wrong of ['两次她都发了抱歉表情。','发了个抱歉表情。','上一次是家里有事。这次她说加班，发了个抱歉表情。']) {
    const repaired = validateClarityResponse(finish(wrong),c);
    assert.equal(repaired.ok,true); assert.equal(repaired.candidate.claims[0].text,materialSentences(text).join('\n'));
  }
  assert.equal(validateClarityResponse(finish(text,['fake']),c).reason,'invalid_claim');
});
test('a fact quote must cite the sentence source; valid IDs alone do not suffice', () => {
  const c = context('上一次她说家里有事。','这次她说临时加班。');
  const reconstructed = validateClarityResponse(finish('这次她说临时加班。'),c);
  assert.equal(reconstructed.ok,true);
  assert.equal(reconstructed.candidate.claims[0].text,'上一次她说家里有事。\n这次她说临时加班。');
  assert.deepEqual(reconstructed.candidate.claims[0].evidenceIds,['u1','u2']);
  assert.equal(validateClarityResponse(finish('这次她说临时加班。',['u2']),c).ok,true);
});

test('long source material is never cut into a made-up partial sentence', () => {
  const c=context('长'.repeat(300)+'。');
  assert.equal(validateClarityResponse(finish('一段模型改写。'),c).reason,'ungrounded_event');
  assert.equal(c.statements[0].text.length,301);
});

test('an ordinary reflection can finish when the model paraphrases the event', () => {
  const c=context('周末下午在家做一个手工项目。','原本想出去走走，后来没有出门。');
  c.statements.push({id:'u3',kind:'expression',text:'希望每个周末都能留出放松的时间。'});
  const raw=finish('周末花了一下午做手工，没有安排休息。',['u1','u2']);
  raw.claims.push({type:'insight',text:'我想在周末给放松留出稳定的时间。',evidenceIds:['u3'],derivation:'inferred',supersedes:[]});
  const result=validateClarityResponse(raw,c);
  assert.equal(result.ok,true);
  assert.equal(result.candidate.claims[0].text,c.statements.map(s=>s.text).join('\n'));
  assert.equal(result.candidate.claims[1].text,raw.claims[1].text);
});
test('explicit emotion correction removes only its matching contrast and preserves original material', () => {
  const c = context('约好的朋友临时取消了。','不是失落，是生气。我希望下次能提前说。');
  const original = structuredClone(c), raw = finish('约好的朋友临时取消了。');
  raw.claims.push({ type:'insight',text:'我不是失落，是生气。我希望下次能提前说。',evidenceIds:['u2'],derivation:'stated',supersedes:[] });
  const result = validateClarityResponse(raw,c);
  assert.equal(result.ok,true); assert.equal(result.candidate.claims[1].text,'生气。我希望下次能提前说。');
  assert.deepEqual(c,original);
  raw.claims[1].evidenceIds=['u1'];
  assert.equal(validateClarityResponse(raw,c).reason,'correction_not_applied');
  raw.claims[1].evidenceIds=['u2']; raw.claims[1].text='我其实还是很失落。';
  assert.equal(validateClarityResponse(raw,c).reason,'correction_not_applied');
});
test('quotes and changing emotions are not silently interpreted as a correction', () => {
  for (const text of ['她说“不是失落，是生气。”我有点担心。','当时失落，现在生气。','她不是失落，是生气。']) assert.equal(groundingPlan(context(text)).corrections.length,0);
  const c=context('她说“唉。不是失落，是生气。”','不是失落，是生气。');
  const raw=finish('她说“唉。不是失落，是生气。”');
  raw.reply='她说“唉。不是失落，是生气。”你也明确说了生气。';
  assert.equal(validateClarityResponse(raw,c).candidate.reply,raw.reply);
  raw.reply='我生气，但也担心她失落。';
  raw.claims.push({type:'insight',text:'我生气，但也担心她失落。',evidenceIds:['u2'],derivation:'inferred',supersedes:[]});
  assert.equal(validateClarityResponse(raw,c).ok,true);
  c.statements.push({ id:'u3',kind:'correction',text:'不是生气，是失落。' });
  raw.reply='你现在说的是失落。';
  raw.claims.pop();
  assert.equal(validateClarityResponse(raw,c).ok,true);
});
