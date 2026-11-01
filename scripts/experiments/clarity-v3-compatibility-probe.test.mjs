import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {runV3CompatibilityProbe,COMPATIBILITY_CAPTURE_SHA} from './clarity-v3-compatibility-probe.mjs';
const load=()=>JSON.parse(readFileSync(new URL('../../ai/evaluations/2026-11-01-model-comparison-v1.json',import.meta.url),'utf8'));
test('frozen known capture replays without network and keeps native failure separate from counterfactual saves',async()=>{
  const input=load(),before=JSON.stringify(input),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('network_forbidden_in_offline_probe');};
  try{
    const report=await runV3CompatibilityProbe(input);assert.equal(calls,0);assert.equal(JSON.stringify(input),before);
    assert.equal(report.complete,true);assert.equal(report.counterfactual,true);assert.equal(report.modelCalls,0);assert.equal(report.providerRequests,0);
    assert.equal(report.capture.liveSha256,COMPATIBILITY_CAPTURE_SHA);assert.equal(report.nativeV3Verified,false);
    assert.deepEqual(report.unchangedPriorAssessment,{modelScreeningGate:'not_met',originalCandidateCount:23,originalRejectedCount:1,eligibleCandidates:[]});
    const r=report.arms[0];assert.equal(r.original.reason,'invalid_analysis_claim');assert.equal(r.original.oldReplay.ok,false);
    assert.equal(r.nativeThreeFieldsToV3.validation.reason,'invalid_shape');assert.equal(r.normalContinuation.ticketKind,'reflect');
    assert.equal(r.normalContinuation.validation.reason,'interpretation_not_allowed');
    assert.equal(r.legacyStageCarryover.validation.ok,true);assert.equal(r.legacyStageCarryover.eligibleForRealOutcome,false);assert.equal(r.legacyStageCarryover.applied,false);
    for(const arm of report.arms){
      const e=arm.explicitRequestAssumption;assert.equal(e.newUserReviewObserved,false);assert.equal(e.counterfactual,true);
      assert.equal(e.request.dispatched,false);assert.ok(e.request.byteLength<12000);assert.equal(e.request.maximumBytes,12000);
      assert.ok(e.applied&&e.saved.roundTripExact&&Object.values(e.preservation).every(Boolean));assert.equal(e.saved.record.formatVersion,2);
      assert.equal(e.saved.humanConfirmationObserved,false);assert.equal(e.saved.confirmationAssumption,'programmatic_test_confirmation');
      assert.equal(e.context.statements.length,5);assert.equal(e.context.dialogue.length,3);assert.equal(e.policy.materials.length,4);
      assert.equal(e.addedControl.id,'u5');assert.equal(e.addedControl.kind,'request');
      assert.equal(arm.semanticStatus.nativeV3ModelSuccess,false);assert.equal(arm.semanticStatus.eligibleForProduction,false);
    }
    assert.equal(r.explicitRequestAssumption.saved.record.review.blocks.find(b=>b.id==='insight').text,r.raw.claims.map(c=>c.text).join('\n\n'));
  }finally{globalThis.fetch=original;}
});
test('mechanical compatibility does not upgrade previously failed Max or Flash semantics',async()=>{
  const report=await runV3CompatibilityProbe(load());
  assert.deepEqual(report.arms.map(arm=>[arm.arm,arm.semanticStatus.priorGrade]),[['reference','unavailable'],['max','fail'],['flash','fail']]);
  assert.ok(report.arms.every(arm=>arm.semanticStatus.inheritedWithoutRegrading&&arm.semanticStatus.formatAcceptanceIsNotSemanticRepair));
  assert.equal(report.negativeControls.length,10);assert.ok(report.negativeControls.every(control=>control.ok));
  assert.equal(report.negativeControls.find(c=>c.name==='confirmed_manual_text_survives_another_mapped_candidate').saveReason,'review_stale');
});
test('changed source capture or claimed provenance cannot be treated as the historical model response',async()=>{
  for(const mutate of [r=>{r.liveReportSha256='0'.repeat(64);},r=>{r.live.sourceCommit='0'.repeat(40);},
    r=>{r.live.cases[0].arms.reference.calls[0].evidence.transport.response.choices[0].message.content+=' ';},
    r=>{r.semanticReview.cases[0].arms.max.grade='pass';},r=>{r.counts.runtimeRejected=0;}]){
    const input=load();mutate(input);await assert.rejects(runV3CompatibilityProbe(input),/capture_/);
  }
});
test('importing the offline CLI performs no network or filesystem writes',async()=>{
  const originalFetch=globalThis.fetch,originalWrite=fs.writeFileSync;let network=0,writes=0;
  globalThis.fetch=async()=>{network++;throw Error('import_network_forbidden');};
  fs.writeFileSync=()=>{writes++;throw Error('import_write_forbidden');};syncBuiltinESMExports();
  try{await import('./clarity-v3-compatibility-probe.mjs?import-only');assert.equal(network,0);assert.equal(writes,0);}
  finally{globalThis.fetch=originalFetch;fs.writeFileSync=originalWrite;syncBuiltinESMExports();}
});
