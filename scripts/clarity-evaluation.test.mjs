import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createClarityEvaluation, evaluationSpend } from './clarity-evaluation.mjs';
import { CORE_SAMPLES } from '../ai/fixtures/clarity-samples.mjs';
const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const options = (text = CORE_SAMPLES.M03[0]) => ({ headers: { Authorization: 'Bearer synthetic-do-not-record' }, body: JSON.stringify({ model: 'qwen3.8-max', max_completion_tokens: 2000, enable_thinking: false, messages: [{ content: 'synthetic policy' }, { content: JSON.stringify({ statements: [{ id: 'u1', text }] }) }] }) });
function setup(t, baseline) {
  const dir = mkdtempSync(join(tmpdir(), 'liubai-eval-'));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('liubai-eval-'));
    rmSync(dir, { recursive: true, force: true });
  });
  const reportPath = join(dir, 'report.json'), priorReportPath = join(dir, 'prior.json');
  writeFileSync(priorReportPath, JSON.stringify({ calls: [{ estimatedFullPriceCny: baseline }], perCallReservationCny: .229 }));
  return { coreSuite: true, reportPath, priorReportPath };
}
test('budget reserves concurrent work and keeps unknown spend after restart', async t => {
  const config = setup(t, .55); let dispatches = 0, resolveResponse;
  const fetcher = () => { dispatches++; return new Promise(resolve => { resolveResponse = resolve; }); };
  const wrapped = createClarityEvaluation(fetcher, config), pending = wrapped(endpoint, options());
  await assert.rejects(wrapped(endpoint, options()), /evaluation_boundary/);
  resolveResponse(Response.json({ choices: [], usage: { prompt_tokens: -10, completion_tokens: 1 } })); await pending;
  assert.equal(dispatches, 1);
  const report = JSON.parse(readFileSync(config.reportPath)); assert.equal(evaluationSpend(report), .779);
  const resumed = createClarityEvaluation(fetcher, config);
  await assert.rejects(resumed(endpoint, options()), /evaluation_boundary/); assert.equal(dispatches, 1);
  assert.doesNotMatch(readFileSync(config.reportPath, 'utf8'), /Bearer|synthetic-do-not-record|Authorization/);
});
test('real usage replaces reservation; foreign input and endpoints never dispatch', async t => {
  const config = setup(t, .65); let dispatches = 0;
  const wrapped = createClarityEvaluation(async () => { dispatches++; return Response.json({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } }); }, config);
  await assert.rejects(wrapped(endpoint, options('not a synthetic sample')), /evaluation_boundary/);
  await assert.rejects(wrapped('https://invalid.example', options()), /evaluation_boundary/);
  await wrapped(endpoint, options()); await wrapped(endpoint, options());
  assert.equal(dispatches, 2);
  assert.ok(Math.abs(evaluationSpend(JSON.parse(readFileSync(config.reportPath))) - .6812) < 1e-8);
});
