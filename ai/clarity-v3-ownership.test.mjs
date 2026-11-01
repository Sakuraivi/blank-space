import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildClarityModelRequest,validateClarityResponse,CLARITY_POLICY_VERSION} from './clarity-v3.mjs';
import {CLARITY_POLICY_VERSION as PUBLIC_POLICY} from '../public/clarity-v3-contract.mjs';
import {getOrganizerRoute} from './providers.mjs';
import {prepareProviderRequest} from './provider-transport.mjs';
import {prepareNativeFixture,NATIVE_SLOT_IDS} from '../scripts/experiments/clarity-v3-native-fixtures.mjs';

const published=JSON.parse(readFileSync(new URL('./evaluations/2026-11-01-v3-native-qualification.json',import.meta.url),'utf8'));
const captured=id=>published.trace.registeredSlots.find(s=>s.slotId===id).call;
const route=getOrganizerRoute({providerId:'bailian',modelId:'deepseek-v4-pro-0813',pricingMode:'manual',inputRate:null,outputRate:null,revision:3});
test('the recorded negative-positive emotion wording passes the new full contract unchanged while the old failure stays frozen',()=>{
  const call=captured('corrected_review'),raw=structuredClone(call.rawOutput),context=structuredClone(call.context);
  assert.equal(call.evidence.api.result.status,'fallback');assert.equal(call.evidence.api.result.reason,'correction_not_applied');
  const result=validateClarityResponse(raw,context);
  assert.equal(result.ok,true);assert.deepEqual(result.candidate,raw);assert.deepEqual(raw,call.rawOutput);assert.deepEqual(context,call.context);
  assert.equal(result.candidate.claims.some(c=>['insight','tradeoff'].includes(c.type)),false); // Not a content-quality repair.
  assert.equal(createHash('sha256').update(JSON.stringify(published.trace)).digest('hex'),'1198cd7d0d33e62349bc2fc0b6563b4d5310e5b5aa6e3d4bd470398936d3b019');
});
test('the same recorded response still fails for a genuinely reaffirmed denied emotion, wrong correction source, or fabricated event',()=>{
  const call=captured('corrected_review');
  for(const text of ['你还是很委屈。','你不是委屈，主要是生气，但你还是委屈。']){
    const raw=structuredClone(call.rawOutput);raw.claims[1].text=text;
    assert.equal(validateClarityResponse(raw,call.context).reason,'correction_not_applied');
  }
  const wrong=structuredClone(call.rawOutput);wrong.claims[1].evidenceIds=['u1'];
  assert.equal(validateClarityResponse(wrong,call.context).reason,'correction_not_applied');
  const invented=structuredClone(call.rawOutput);invented.claims[0].text='我一直答应随时帮邻居浇花。';
  assert.equal(validateClarityResponse(invented,call.context).reason,'ungrounded_event');
});
test('the new responsibility policy stays generic, immutable and within the unchanged trusted route capacity',()=>{
  assert.equal(CLARITY_POLICY_VERSION,'clarity-listening-2');assert.equal(PUBLIC_POLICY,CLARITY_POLICY_VERSION);
  for(const id of NATIVE_SLOT_IDS.filter(id=>id!=='stop')){
    const {context}=prepareNativeFixture(id,'ownership20261101a'),before=structuredClone(context),request=buildClarityModelRequest(context,route.profile);
    const body=prepareProviderRequest(request,route),data=JSON.parse(request.input.content);
    assert.equal(request.schemaVersion,'liubai-clarity-2');assert.equal(body.byteLength<=route.maxRequestBytes,true);
    assert.deepEqual(context,before);assert.deepEqual(data.context,context);
    assert.equal(data.outputResponsibilities.excerptIsNotUnderstanding,true);
    assert.doesNotMatch(request.instruction.text,/学日语|邻居|怕拒绝后尴尬|RELATION_K_FULL|委屈/);
    assert.equal(Object.isFrozen(request),true);assert.equal(JSON.parse(body.body).model,'deepseek-v4-pro-0813');
  }
});
test('event-only output remains a literal candidate, not evidence that an understanding was generated',()=>{
  const call=captured('review'),result=validateClarityResponse(call.rawOutput,call.context);
  assert.equal(result.ok,true);assert.deepEqual(result.candidate,call.rawOutput);
  assert.ok(result.candidate.claims.every(c=>c.type==='event'));
  assert.equal(published.semanticReview.slots.find(s=>s.slotId==='review').coreRelation,'fail');
});
test('an exact own-correction event or positive suffix is accepted unchanged at one actual source position',()=>{
  const source=['我不是失落，是生气。','我不是委屈，主要是生气。'];
  for(const text of source){
    const context={sessionId:'correction_quote',revision:2,stage:'review',allowNextStep:false,modeId:'concern',goal:null,
      statements:[{id:'u1',text,kind:'expression'},{id:'u2',text:'请AI整理成一份。',kind:'request'}],dialogue:[],claims:[]};
    const candidate={modeId:'concern',goal:'留下当前感受',reply:'你说的是生气。',question:null,finish:true,title:'当前感受',
      claims:[{type:'event',text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]};
    assert.deepEqual(validateClarityResponse(candidate,context).candidate,candidate);
    const suffix=structuredClone(candidate);suffix.claims[0].text='生气。';assert.deepEqual(validateClarityResponse(suffix,context).candidate,suffix);
    const duplicate=structuredClone(candidate);duplicate.claims[0].text+='\n生气。';assert.equal(validateClarityResponse(duplicate,context).reason,'ungrounded_event');
    const changed=structuredClone(candidate);changed.claims[0].text='我现在很生气。';assert.equal(validateClarityResponse(changed,context).reason,'ungrounded_event');
  }
});
