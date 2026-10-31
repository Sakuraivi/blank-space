// Explicit paid synthetic evaluation only. Importing this module performs no
// network or writes. The CLI requires one runId and refuses an existing ledger.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLARITY_SCHEMA_VERSION } from '../../public/clarity-contract.mjs';
import { applyClarityReply, saveClarityRecord, readRecordEntries, RECORD_STORE } from '../../public/clarity-state.mjs';
import {
  createMaterialReviewCase, MATERIAL_LIVE_CASE_IDS, MATERIAL_LIVE_LABEL, MATERIAL_LIVE_ORIGIN,
  MATERIAL_LIVE_ROUTE, MATERIAL_LIVE_TTL_MS, validMaterialRunId,
} from './clarity-material-fixtures.mjs';

const visible = review => ({ title: review.title, blocks: review.blocks.map(({ id, type, group, label, text }) => ({ id, type, group, label, text })) });
const fixedFailure = code => ({ code });

function checkAndSave(evidence, fixture) {
  assert.equal(evidence.synthetic, true);
  assert.equal(evidence.label, MATERIAL_LIVE_LABEL);
  assert.equal(evidence.kind, 'controlled_review_only');
  assert.equal(evidence.runId, fixture.runId);
  assert.equal(evidence.caseId, fixture.caseId);
  assert.equal(evidence.requestId, fixture.ticket.requestId);
  assert.equal(evidence.revision, fixture.ticket.revision);
  assert.deepEqual(evidence.route, MATERIAL_LIVE_ROUTE);
  assert.deepEqual(evidence.context, fixture.context);
  assert.equal(evidence.api?.httpStatus, 200);
  const result = evidence.api.result;
  assert.equal(result.status, 'candidate');
  assert.equal(result.flow, 'clarity-v2');
  assert.equal(result.policyVersion, 'clarity-material-experiment-1');
  assert.equal(result.schemaVersion, CLARITY_SCHEMA_VERSION);
  assert.deepEqual(result.route, MATERIAL_LIVE_ROUTE);
  assert.equal(result.candidate.finish, true);
  assert.equal(result.candidate.question, null);
  const applied = applyClarityReply(fixture.session, fixture.ticket, result);
  assert.equal(applied.ok, true);
  assert.equal(fixture.session.stage, 'reviewing');
  const before = visible(fixture.session.review);
  const store = new Map([['liubai.records.v1', '[]']]);
  const saved = saveClarityRecord(fixture.session, { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) });
  assert.equal(saved.ok, true);
  const reopened = new Map(JSON.parse(JSON.stringify([...store])));
  const entries = readRecordEntries({ getItem: key => reopened.get(key) ?? null });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].record.id, fixture.session.id);
  assert.deepEqual(visible(entries[0].record.review), before);
  assert.equal(reopened.get('liubai.records.v1'), '[]');
  return { ok: true, visibleReview: before, recordStore: RECORD_STORE,
    storageRoundTrip: '内存保存、JSON序列化与读回；不是浏览器刷新、localStorage或图片导出验证。' };
}

export async function runMaterialLiveEvaluation({ runId, origin = MATERIAL_LIVE_ORIGIN,
  fetchImpl = globalThis.fetch, persist, now = () => Date.now() } = {}) {
  if (!validMaterialRunId(runId) || origin !== MATERIAL_LIVE_ORIGIN || typeof fetchImpl !== 'function' || typeof persist !== 'function') throw new TypeError('invalid_live_evaluation_options');
  const report = { synthetic: true, kind: 'controlled_material_review_only', label: MATERIAL_LIVE_LABEL,
    runId, origin, startedAt: new Date(now()).toISOString(), expectedRoute: MATERIAL_LIVE_ROUTE,
    scope: '三例已见合成材料、强制concern/review；不评自然路由、连续交流、首次用户体验或总体成功率。',
    retries: 0, statusRequestsDispatched: 0, caseRequestsDispatched: 0, samples: [], complete: false,
    modelDispatchesObserved: 0, semanticReview: 'pending_manual_review',
    usage: '优先保留各请求真实token计数；未核实精确别名费率，不推算金额。',
  };
  const save = async () => persist(structuredClone(report));
  await save();
  report.health = { dispatched: true, httpStatus: null }; report.statusRequestsDispatched++;
  await save();
  let health;
  try {
    const response = await fetchImpl(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    report.health.httpStatus = response.status; health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.label, MATERIAL_LIVE_LABEL); assert.equal(health.runId, runId);
    assert.equal(Object.keys(health).length, 4);
    assert.ok(Number.isSafeInteger(health.startedAt) && health.startedAt > 0);
    assert.equal(health.expiresAt, health.startedAt + MATERIAL_LIVE_TTL_MS);
    assert.ok(now() >= health.startedAt && now() < health.expiresAt);
    report.health.window = { runId: health.runId, startedAt: health.startedAt, expiresAt: health.expiresAt };
  } catch {
    report.health.failure = fixedFailure('health_failed'); await save(); return report;
  }
  await save();
  for (const caseId of MATERIAL_LIVE_CASE_IDS) {
    if (now() < health.startedAt || now() >= health.expiresAt) {
      report.boundaryFailure = fixedFailure('preview_expired_before_case'); await save(); break;
    }
    const fixture = { ...createMaterialReviewCase(caseId, runId), runId };
    const sample = { caseId, requestId: fixture.ticket.requestId, revision: fixture.ticket.revision,
      requirements: fixture.requirements, context: fixture.context,
      dispatches: 1, httpStatus: null, evidence: null, stateVerification: null,
      semanticReview: 'pending_manual_review' };
    report.samples.push(sample); report.caseRequestsDispatched++;
    // Persist attempted dispatch before fetch. A crash or timeout cannot erase
    // the client attempt. Never resume this ledger with a new requestId.
    await save(); const started = now();
    try {
      const response = await fetchImpl(`${origin}/evaluate/${caseId}`, { method: 'POST', headers: { 'X-Liubai-Evaluation-Run': runId }, redirect: 'error', signal: AbortSignal.timeout(60000) });
      sample.httpStatus = response.status;
      if (response.status === 200) {
        sample.evidence = await response.json();
        report.modelDispatchesObserved += sample.evidence.transport?.dispatches === 1 ? 1 : 0;
        await save();
        try { sample.stateVerification = checkAndSave(sample.evidence, fixture); }
        catch { sample.stateVerification = { ok: false, failure: fixedFailure('candidate_or_state_rejected') }; }
      } else {
        // Rejection is a fixed enum response from the isolated worker. Do not
        // retain arbitrary proxy/Cloudflare/provider error-page bodies.
        await response.body?.cancel().catch(() => {});
        sample.failure = fixedFailure('preview_request_rejected');
      }
    } catch { sample.failure = fixedFailure('preview_transport_failed'); }
    sample.elapsedMs = Math.max(0, now() - started); await save();
  }
  report.complete = report.samples.length === MATERIAL_LIVE_CASE_IDS.length;
  report.mechanicalPassCount = report.samples.filter(sample => sample.stateVerification?.ok).length;
  report.completedAt = new Date(now()).toISOString(); await save(); return report;
}

function cliArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = args.slice(i, i + 2);
    if (!['--run-id', '--origin'].includes(name) || Object.hasOwn(parsed, name) || typeof value !== 'string' || !value || value.startsWith('--')) throw new TypeError('invalid_live_evaluation_cli');
    parsed[name] = value;
  }
  if (!validMaterialRunId(parsed['--run-id']) || parsed['--origin'] !== undefined && parsed['--origin'] !== MATERIAL_LIVE_ORIGIN) throw new TypeError('invalid_live_evaluation_cli');
  return { runId: parsed['--run-id'], origin: parsed['--origin'] ?? MATERIAL_LIVE_ORIGIN };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = cliArgs(process.argv.slice(2));
  const output = new URL(`../../work/material-live-${options.runId}.json`, import.meta.url);
  if (existsSync(output)) throw new Error('existing_live_evaluation_ledger');
  mkdirSync(dirname(fileURLToPath(output)), { recursive: true });
  const report = await runMaterialLiveEvaluation({ ...options, persist: value => writeFileSync(output, JSON.stringify(value, null, 2)) });
  console.log(JSON.stringify({ file: output.href, clientCaseAttempts: report.caseRequestsDispatched,
    modelDispatchesObserved: report.modelDispatchesObserved, mechanicalPassCount: report.mechanicalPassCount ?? 0,
    semanticReview: report.semanticReview, complete: report.complete }));
  if (!report.complete || report.mechanicalPassCount !== MATERIAL_LIVE_CASE_IDS.length) process.exitCode = 1;
}
