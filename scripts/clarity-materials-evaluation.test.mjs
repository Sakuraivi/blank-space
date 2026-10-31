import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluateMaterialExperiment } from './clarity-materials-evaluation.mjs';

const output = new URL('../ai/evaluations/2026-11-01-material-selection.json', import.meta.url);
const artifactHash = () => existsSync(output) ? createHash('sha256').update(readFileSync(output)).digest('hex') : null;

test('the offline evaluator neither dispatches requests nor writes its CLI artifact on import/function call', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch, before = artifactHash(); let dispatched = 0;
  globalThis.fetch = async () => { dispatched++; throw Error('network_forbidden_in_offline_evaluation'); };
  try {
    const report = await evaluateMaterialExperiment();
    assert.equal(dispatched, 0); assert.equal(artifactHash(), before);
    assert.equal(report.method, 'offline_synthetic_design_only'); assert.equal(report.paidModelCalls, 0);
    assert.equal(report.productionIntegrated, false); assert.equal(report.contentQualityStatus, 'not_evaluated');
    assert.equal(report.mechanicalGate.passed, true);
    assert.equal(report.counts.materialSamples, 8); assert.equal(report.counts.requestContexts, 9);
    assert.equal(report.counts.trustedTransportProfiles, 6); assert.equal(report.counts.requestBudgetChecks, 54);
    assert.ok(report.indexChecks.every(sample => sample.allSourceSlicesMatch && sample.allSelectableAnchorsCompiledWhole));
    assert.ok(report.requestBudgetChecks.every(value => value.byteLength + value.headroomBytes === value.maxRequestBytes && !value.dispatched));
    assert.equal(report.requestSamples.at(-1).origin.fixtureInputsMatched, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('legal-reference semantic counterexamples remain designed failures rather than content successes', async () => {
  const report = await evaluateMaterialExperiment();
  assert.ok(report.counterexamples.length >= 5);
  for (const value of report.counterexamples) {
    assert.equal(value.kind, 'designed_counterexample'); assert.equal(value.expectedSemanticVerdict, 'fail');
    assert.equal(value.semanticVerdict, 'not_evaluated'); assert.equal(value.isContentSuccess, false);
    assert.equal(value.isModelOutput, false); assert.equal(value.compiledOK, true);
    assert.equal(value.result.selectionTrace.semanticCoverage, 'unverified');
  }
  const emotion = report.counterexamples.find(value => value.id === 'NEG_EMOTION_CORRECTION_PARAPHRASE');
  assert.equal(emotion.result.candidate.claims[0].text, '我的真实感受是失落。');
  assert.deepEqual(emotion.result.candidate.claims[0].evidenceIds, ['u2']);
  // 这是当前契约的已知语义缺口，不是要求生产继续接受错误理解。
  // 未来若真正新增了相应语义检查，应更新反例与证据，不能为保留本测试而放宽校验。
});
