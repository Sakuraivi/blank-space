// Explicit local evaluation: whitelisted synthetic inputs, cumulative budget,
// durable reservations before dispatch. Never record headers or credentials.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inputs } from '../ai/fixtures/clarity-c01.mjs';
import { CLARITY_POLICY_VERSION } from '../ai/clarity.mjs';
import { CLARITY_SCHEMA_VERSION } from '../public/clarity-contract.mjs';
import { sampleForStatements } from '../ai/fixtures/clarity-samples.mjs';
const safeCost = (cost, reservation) => Number.isFinite(cost) && cost >= 0 ? cost : reservation;
export const evaluationSpend = report => (report.baselineSpendCny ?? 0) + report.calls.reduce((sum, c) => sum + safeCost(c.estimatedFullPriceCny, report.perCallReservationCny), 0);
export function createClarityEvaluation(fetchImpl = fetch, { followup = false, coreSuite = false, reportPath, priorReportPath } = {}) {
  const correction = '不是失落，是生气。我能理解临时有事，但她都没有主动说下次什么时候，好像只有我在等。又怕说了显得我在逼她。';
  const condensed = [inputs[0], inputs[1], correction].join('\n');
  const allowed = new Set([...inputs, correction, condensed]);
  const file = reportPath ?? resolve(import.meta.dirname, coreSuite ? '../work/clarity-evaluation-core-v2.json' : '../work/clarity-evaluation-c01.json');
  const prior = coreSuite ? JSON.parse(readFileSync(priorReportPath ?? resolve(import.meta.dirname, '../ai/evaluations/2026-10-31-c01.json'), 'utf8')) : null;
  const baselineSpend = prior ? evaluationSpend(prior) : 0;
  const report = (followup || coreSuite) && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { sample: coreSuite ? 'Core scenario suite, synthetic only' : 'C01 synthetic', policyVersion: CLARITY_POLICY_VERSION, schemaVersion: CLARITY_SCHEMA_VERSION,
    startedAt: new Date().toISOString(), provider: 'bailian', model: 'qwen3.8-max', maxCalls: 4, budgetCny: 1,
    priceSource: 'https://help.aliyun.com/zh/model-studio/qwen3-8-max', inputCnyPerMillion: 12, outputCnyPerMillion: 36,
    perCallReservationCny: .229, calls: [] };
  if (followup) report.maxCalls = 6;
  if (coreSuite) { report.maxCalls = 14; report.baselineSpendCny = baselineSpend; }
  // 13,000 input + 2,010 output tokens = ¥0.22836; no explicit cache creation.
  const persist = () => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(report, null, 2)); };
  persist();
  return async (url, options) => {
    const body = JSON.parse(options.body), context = JSON.parse(body.messages[1].content);
    const sample = coreSuite ? sampleForStatements(context.statements) : null;
    if (url !== 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' || body.model !== report.model ||
        body.max_completion_tokens !== 2000 || body.enable_thinking !== false ||
        (coreSuite ? !sample : ![inputs[0], ...(followup ? [condensed] : [])].includes(context.statements[0]?.text) || context.statements.some(s => !allowed.has(s.text))) ||
        report.calls.length >= report.maxCalls ||
        evaluationSpend(report) + report.perCallReservationCny > report.budgetCny) throw Error('evaluation_boundary');
    const entry = { index: report.calls.length + 1, policyVersion: CLARITY_POLICY_VERSION, schemaVersion: CLARITY_SCHEMA_VERSION, sample: sample ?? (context.statements[0].text === condensed ? 'C01-condensed-correction' : 'C01'), startedAt: new Date().toISOString(), input: body, status: 'dispatched' };
    report.calls.push(entry); persist(); const started = Date.now();
    try {
      const response = await fetchImpl(url, options);
      const output = await response.clone().json();
      entry.status = response.ok ? 'completed_transport' : 'provider_error'; entry.httpStatus = response.status;
      // Deliberately exclude headers, error text, and internal reasoning content.
      if (response.ok) {
        entry.output = { model: output.model, choices: output.choices?.map(c => ({ finish_reason: c.finish_reason, message: { content: c.message?.content } })), usage: output.usage };
        const usage = output.usage;
        if (Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0) entry.estimatedFullPriceCny = (usage.prompt_tokens * 12 + usage.completion_tokens * 36) / 1000000;
      }
      return response;
    } catch (error) { entry.status = error.name === 'AbortError' ? 'aborted' : 'transport_error'; throw Error('evaluation_transport_failed'); }
    finally { entry.durationMs = Date.now() - started; persist(); }
  };
}
