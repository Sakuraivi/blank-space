import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateRetentionReplay} from './clarity-retention-replay.mjs';

const output=new URL('../ai/evaluations/2026-11-01-retention-ledger.json',import.meta.url);
const source=new URL('../ai/evaluations/2026-11-01-material-set-v2.json',import.meta.url);
const digest=file=>existsSync(file)?createHash('sha256').update(readFileSync(file)).digest('hex'):null;

test('the fixed offline replay dispatches no network, writes no CLI artifact, and preserves the old report', {concurrency:false},async()=>{
  const original=globalThis.fetch,beforeOutput=digest(output),beforeSource=digest(source);let requests=0;
  globalThis.fetch=()=>{requests++;throw Error('network_forbidden_in_retention_replay');};
  try{
    const fresh=await import('./clarity-retention-replay.mjs?zero_io_import_check');
    assert.equal(digest(output),beforeOutput);assert.equal(digest(source),beforeSource);
    const report=await fresh.evaluateRetentionReplay();
    assert.equal(requests,0);assert.equal(digest(output),beforeOutput);assert.equal(digest(source),beforeSource);
    assert.equal(report.isFreshModelOutput,false);assert.equal(report.modelCalls,0);assert.equal(report.networkRequests,0);
    assert.equal(report.productionIntegrated,false);assert.equal(report.semanticCoverage,'unverified');
    assert.match(report.sourceCommit,/^[a-f0-9]{40}$/u);assert.equal(typeof report.sourceTreeDirty,'boolean');
    assert.deepEqual(report.counts,{historicalCases:4,historicalRequestsVerified:7,offlineMappedCases:3,preservedFailedCases:1,memorySavedCases:3});
    assert.equal(report.historicalSteps.every(step=>step.hostEnvelopeVerified&&step.exactTransportRequestMatched),true);
    assert.equal(report.mechanicalGate.passed,true);assert.equal(report.contentReleaseGate,'not_met');
  }finally{globalThis.fetch=original;}
});

test('three mapped cases reach actual visible, saved, serialized and reopened material without semantic success claims',async()=>{
  const report=await evaluateRetentionReplay();
  const mapped=report.samples.filter(sample=>sample.mappedCandidateProduced);
  assert.equal(mapped.length,3);
  for(const sample of mapped){
    assert.equal(sample.isContentSuccess,false);assert.equal(sample.semanticCoverage,'unverified');
    assert.equal(sample.mapping.unchangedAnalysisText,true);assert.equal(sample.runtime.localAdapterInvocations,1);
    assert.equal(sample.runtime.modelCalls,0);assert.equal(sample.runtime.networkRequests,0);
    assert.deepEqual(sample.state.visibleCheck,{status:'visible',allVisible:true});
    assert.equal(sample.save.beforeSaveVisible,true);assert.equal(sample.save.afterSaveVisible,true);assert.equal(sample.save.afterReadBackVisible,true);
    assert.equal(sample.save.visibleReview.blocks.find(block=>block.id==='context').text,sample.ledger.retainedText);
    assert.equal(sample.save.savedRecord.review.blocks.find(block=>block.id==='context').text,sample.ledger.retainedText);
    assert.ok(sample.reportCapacity.retainedUTF16<=240);assert.ok(sample.compile.totalClaimsUTF16<=480);
  }
  const feeling=mapped.find(sample=>sample.caseId==='V2_CORRECTED_FEELING');
  assert.equal(feeling.ledger.units.find(unit=>unit.quote==='我很失落。').status,'retired');
  assert.ok(feeling.ledger.units.some(unit=>unit.status==='active'&&unit.text==='生气。'));
  assert.equal(feeling.correctionEvidence.retiredQuotesShownInSavedContext.length,0);
  assert.match(feeling.save.savedRecord.review.blocks[0].text,/生气。/u);
});

test('the original fenced failure stays failed while its source ledger can be measured',async()=>{
  const report=await evaluateRetentionReplay(),group=report.samples.find(sample=>sample.caseId==='V2_GROUP_FEEDBACK');
  assert.equal(group.status,'preserved_historical_format_failure');assert.equal(group.mappedCandidateProduced,false);
  assert.equal(group.originalFailure.reason,'provider_response_failed');assert.equal(group.originalFailure.strictJSON,false);
  assert.equal(group.originalFailure.markdownWasNotStripped,true);assert.equal(group.originalFailure.originalOutcomeUnchanged,true);
  assert.match(group.originalFailure.originalContent,/^```json/u);
  assert.equal(group.compile,null);assert.equal(group.runtime,null);assert.equal(group.state,null);assert.equal(group.save,null);
  assert.equal(group.reportCapacity.retainedUTF16,138);assert.equal(group.isContentSuccess,false);
});

test('question provenance and known old analysis limitations remain explicit',async()=>{
  const report=await evaluateRetentionReplay(),full=report.samples.find(sample=>sample.caseId==='V2_FULL_DIALOGUE');
  assert.equal(full.ledger.questionAssociations.length,3);assert.equal(full.ledger.associationMeaning,'literal_question_answer_provenance_only');
  assert.deepEqual(full.ledger.questionAssociations.map(link=>link.sourceId),['u2','u3','u4']);
  assert.equal(full.ledger.retainedLength,228);assert.equal(full.compile.totalClaimsUTF16,304);
  const frequency=report.samples.find(sample=>sample.caseId==='V2_FREQUENCY_EXCEPTION');
  assert.ok(frequency.quality.knownUnfixedIssues.some(text=>text.includes('指代歧义')));
  assert.equal(report.contentQualityStatus,'not_evaluated');
});
