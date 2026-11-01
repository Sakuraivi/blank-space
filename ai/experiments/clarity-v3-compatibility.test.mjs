import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareClarityV3Compatibility,CLARITY_V3_COMPATIBILITY_VERSION} from './clarity-v3-compatibility.mjs';
import {prepareExampleReviewRun,EXAMPLE_REVIEW_POLICY} from './clarity-example-review.mjs';
import {getPersonalRoute} from '../providers.mjs';
import {prepareProviderRequest} from '../provider-transport.mjs';
import {validateClarityResponse} from '../clarity-v3.mjs';
import {CLARITY_FLOW,CLARITY_SCHEMA_VERSION} from '../../public/clarity-v3-contract.mjs';
import {deriveConversationPolicy} from '../../public/clarity-v3-intent.mjs';
import {beginClarityRequest,applyClarityReply,wireSession,saveClarityRecord,readRecordEntries} from '../../public/clarity-v3-state.mjs';

const evaluation=JSON.parse(readFileSync(new URL('../evaluations/2026-11-01-model-comparison-v1.json',import.meta.url),'utf8'));
const captured=()=>structuredClone(evaluation.live.cases.find(row=>row.caseId==='RELATION_K_FULL').arms.reference.calls[0]);
const sha=text=>createHash('sha256').update(text).digest('hex');
const envelope=(ticket,candidate)=>({status:'candidate',flow:CLARITY_FLOW,schemaVersion:CLARITY_SCHEMA_VERSION,policyVersion:ticket.policyVersion,
  requestId:ticket.requestId,revision:ticket.revision,candidate});

test('the captured old rejection remains unchanged while both original insights and exact anchor provenance are retained',async()=>{
  const call=captured(),before=JSON.stringify(call),probe=await prepareClarityV3Compatibility(call);
  assert.equal(probe.version,CLARITY_V3_COMPATIBILITY_VERSION);assert.equal(probe.counterfactual,true);assert.equal(probe.modelCalls,0);
  assert.deepEqual(probe.oldValidation,{ok:false,reason:'invalid_analysis_claim'});assert.equal(call.evidence.api.result.status,'fallback');
  assert.equal(JSON.stringify(call),before);assert.equal(probe.nativeContentSha256,sha(call.evidence.transport.response.choices[0].message.content));
  assert.deepEqual(probe.mapping.candidate.claims.slice(1).map(claim=>claim.text),probe.raw.claims.map(claim=>claim.text));
  assert.equal(probe.mapping.candidate.reply,probe.raw.reply);assert.equal(probe.mapping.candidate.title,probe.raw.title);
  assert.deepEqual(probe.mapping.candidate.claims.map(claim=>claim.type),['event','insight','insight']);
  assert.deepEqual(probe.mapping.claims.map(row=>row.evidenceIds),[['u1','u2','u3'],['u3','u4']]);
  for(const row of probe.mapping.claims){
    assert.deepEqual(row.anchorIds,probe.raw.claims[row.index].anchorIds);
    for(const source of row.sourceQuotes){const statement=probe.sourceContext.statements.find(s=>s.id===source.sourceId);
      assert.equal(statement.text.slice(source.start,source.end),source.text);assert.ok(row.anchorIds.includes(source.anchorId));}
  }
  assert.ok(probe.mapping.hostAddedFields.some(field=>field.path==='finish'&&field.provenance.includes('counterfactual')));
  assert.ok(Object.isFrozen(probe)&&Object.isFrozen(probe.mapping.candidate.claims[1])&&Object.isFrozen(probe.sourceContext));
});

test('working-state reconstruction preserves actual sources and question links without treating old automatic review as a new request',async()=>{
  const probe=await prepareClarityV3Compatibility(captured()),session=probe.createSession();
  assert.equal(session.revision,4);assert.equal(session.stage,'exploring');
  assert.deepEqual(session.statements,probe.sourceContext.statements);assert.deepEqual(session.dialogue,probe.sourceContext.dialogue);
  const ticket=beginClarityRequest(session);assert.equal(ticket.kind,'reflect');assert.equal(ticket.context.stage,'reflect');
  assert.equal(deriveConversationPolicy(ticket.context).reviewRequested,false);
  assert.equal(validateClarityResponse(probe.raw,ticket.context).reason,'invalid_shape');
  assert.equal(validateClarityResponse(probe.mapping.candidate,ticket.context).ok,false);
  const separate=probe.createSession();separate.statements[0].text='a local hypothetical edit';
  assert.notEqual(probe.createSession().statements[0].text,separate.statements[0].text);
  assert.equal(probe.sourceContext.statements.length,4);
});

test('an explicit hypothetical review passes the full v3 validator, groups both original insights, and saves format2 without private metadata',async()=>{
  const probe=await prepareClarityV3Compatibility(captured()),session=probe.createSession({explicitReview:true});
  assert.deepEqual(session.statements.slice(0,4),probe.sourceContext.statements);
  assert.deepEqual(session.statements[4],{id:'u5',text:'请AI整理成一份。',kind:'request'});
  assert.equal(session.revision,5);assert.deepEqual(session.dialogue,probe.sourceContext.dialogue);
  const ticket=beginClarityRequest(session,{review:true});assert.equal(ticket.kind,'review');assert.equal(ticket.context.stage,'review');
  const checked=validateClarityResponse(probe.mapping.candidate,ticket.context);assert.equal(checked.ok,true,JSON.stringify(checked));
  assert.equal(applyClarityReply(session,ticket,envelope(ticket,checked.candidate)).ok,true);
  const block=session.review.blocks.find(item=>item.id==='insight');
  assert.equal(block.text,probe.raw.claims.map(claim=>claim.text).join('\n\n'));assert.equal(block.claimIds.length,2);
  assert.equal(session.review.blocks.find(item=>item.id==='source').text,probe.sourceContext.statements.map(s=>s.text).join('\n\n'));
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const saved=saveClarityRecord(session,storage);assert.equal(saved.ok,true);assert.equal(saved.record.formatVersion,2);
  assert.deepEqual(readRecordEntries(storage)[0].record,saved.record);
  const serialized=JSON.stringify(saved.record);for(const privateKey of ['anchorIds','nativeContentSha256','counterfactual','hostAddedFields','sourceQuotes'])assert.equal(serialized.includes(privateKey),false);
  assert.equal(serialized.includes('请AI整理成一份。'),false);
});

test('a review button is itself a valid operation hypothesis and does not fabricate a historical user sentence',async()=>{
  const probe=await prepareClarityV3Compatibility(captured()),session=probe.createSession();
  const ticket=beginClarityRequest(session,{review:true});
  assert.equal(session.statements.length,4);assert.equal(ticket.kind,'review');
  assert.equal(validateClarityResponse(probe.mapping.candidate,ticket.context).ok,true);
  assert.equal(probe.sourceContext.statements.some(source=>source.kind==='request'),false);
});

test('malformed captures, native JSON fences, unknown anchors and changed model material cannot become compatibility evidence',async()=>{
  await assert.rejects(prepareClarityV3Compatibility(null),/invalid_compatibility_capture/);
  const incomplete=captured();incomplete.evidence.transport.response.choices[0].finish_reason='length';
  await assert.rejects(prepareClarityV3Compatibility(incomplete),/invalid_compatibility_native_response/);
  const fenced=captured();fenced.evidence.transport.response.choices[0].message.content='```json\n'+fenced.evidence.transport.response.choices[0].message.content+'\n```';
  await assert.rejects(prepareClarityV3Compatibility(fenced),/invalid_compatibility_native_json/);
  const unknown=captured(),raw=JSON.parse(unknown.evidence.transport.response.choices[0].message.content);raw.claims[1].anchorIds.push('m999');
  unknown.evidence.transport.response.choices[0].message.content=JSON.stringify(raw);
  await assert.rejects(prepareClarityV3Compatibility(unknown),/compatibility_unknown_anchor/);
  const changed=captured(),input=JSON.parse(changed.evidence.transport.request.messages[1].content);input.retention.materials[0].text='fabricated material';
  changed.evidence.transport.request.messages[1].content=JSON.stringify(input);
  await assert.rejects(prepareClarityV3Compatibility(changed),/compatibility_request_changed/);
  const source=captured();source.context.statements[0].text='changed source';source.evidence.context=structuredClone(source.context);
  await assert.rejects(prepareClarityV3Compatibility(source),/compatibility_request_changed/);
  const result=captured();result.evidence.api.result.reason='different_rejection';
  await assert.rejects(prepareClarityV3Compatibility(result),/compatibility_old_result_changed/);
});

test('candidate and stale working claims survive reconstruction; a probe does not silently clear old state to make a save pass',async()=>{
  // An explicitly synthetic capture variant, not another historical model call.
  const original=captured(),context=structuredClone(original.context);
  context.claims=[{id:'prior_candidate',type:'insight',text:'an earlier candidate',evidenceIds:['u1'],derivation:'inferred',status:'candidate'},
    {id:'prior_stale',type:'unknown',text:'an earlier unresolved item',evidenceIds:['u2'],derivation:'inferred',status:'stale'}];
  const route=getPersonalRoute(original.evidence.route.providerId,original.evidence.route.modelId),old=await prepareExampleReviewRun(context,route.profile);
  const synthetic=structuredClone(original);synthetic.context=context;synthetic.evidence.context=structuredClone(context);
  synthetic.evidence.transport.request=JSON.parse(prepareProviderRequest(old.requestData,route).body);
  synthetic.evidence.hostRequest={policyVersion:EXAMPLE_REVIEW_POLICY,schemaVersion:old.requestData.schemaVersion,binding:old.binding};
  const probe=await prepareClarityV3Compatibility(synthetic),session=probe.createSession({explicitReview:true});
  assert.deepEqual(wireSession(session).claims,context.claims);assert.equal(session.stale,true);
  const ticket=beginClarityRequest(session,{review:true}),checked=validateClarityResponse(probe.mapping.candidate,ticket.context);assert.equal(checked.ok,true);
  assert.equal(applyClarityReply(session,ticket,envelope(ticket,checked.candidate)).ok,true);
  assert.ok(session.claims.some(claim=>claim.id==='prior_stale'&&claim.status==='stale'&&!claim.archived));
  assert.equal(saveClarityRecord(session,{getItem:()=>null,setItem:()=>{throw Error('must not save stale');}}).reason,'review_stale');
});

test('the snapshot is captured before async preparation and no transport is dispatched',async()=>{
  const call=captured(),expected=JSON.parse(call.evidence.transport.response.choices[0].message.content),originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;throw Error('network forbidden in offline probe');};
  try{
    const pending=prepareClarityV3Compatibility(call);call.context.statements[0].text='late caller mutation';
    call.evidence.transport.response.choices[0].message.content='not the original response';
    const probe=await pending;assert.deepEqual(probe.raw,expected);assert.equal(requests,0);
    assert.throws(()=>probe.createSession({explicitReview:'yes'}),/invalid_compatibility_session_options/);
    assert.throws(()=>probe.createSession({unlisted:true}),/invalid_compatibility_session_options/);
  }finally{globalThis.fetch=originalFetch;}
});
