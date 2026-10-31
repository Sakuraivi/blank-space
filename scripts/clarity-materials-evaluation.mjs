// 仅离线合成设计评估：不读取Key，不创建adapter，不派发网络或模型请求。
// 编译成功只表示引用/结构满足本次工程契约，不表示语义忠实或内容达标。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildClarityContext } from '../public/clarity-contract.mjs';
import { publicProviders, getPersonalRoute } from '../ai/providers.mjs';
import { prepareProviderRequest } from '../ai/provider-transport.mjs';
import { inputs as c01Inputs } from '../ai/fixtures/clarity-c01.mjs';
import { MATERIAL_SAMPLES } from '../ai/fixtures/clarity-material-samples.mjs';
import {
  MATERIAL_INDEX_VERSION, MATERIAL_SELECTION_VERSION,
  buildMaterialIndex, compileConcernSelection, buildConcernMaterialRequest,
} from '../ai/experiments/clarity-materials.mjs';

const historicalFile = new URL('../ai/evaluations/2026-11-01-content-retention.json', import.meta.url);
const outputFile = new URL('../ai/evaluations/2026-11-01-material-selection.json', import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const expectedBody = sample => sample.statements.map(statement => [statement.id, statement.kind, statement.text]);
const errorInfo = error => ({ name: error?.name ?? 'Error', reason: String(error?.message ?? 'unknown_error') });

function materialContext(sample) {
  return buildClarityContext({
    session: { id: `synthetic_material_${sample.id}`, modeId: 'concern', goal: '核对原句、顾虑与条件',
      statements: structuredClone(sample.statements), dialogue: [], claims: [] },
    revision: sample.statements.length, stage: 'review', allowNextStep: false,
  });
}

function loadHistoricalC01() {
  // 仅此已知合成报告、指定策略、指定样例的最后一次request.body可进入评估。
  // 不接受外部路径、网页输入、环境变量或任意用户内容。
  const report = JSON.parse(readFileSync(historicalFile, 'utf8'));
  if (report.synthetic !== true || !Array.isArray(report.runs)) throw Error('historical_synthetic_boundary');
  const run = report.runs.find(value => value.evidence?.policyVersion === 'clarity-warm-19');
  const sample = run?.evidence?.samples?.find(value => value.id === 'C01');
  const call = sample?.calls?.at(-1), body = call?.request?.body;
  if (!body || body.flow !== 'clarity-v2' || body.sourceMode !== 'default' ||
      ['personalApiKey', 'apiKey', 'authorization', 'password'].some(key => Object.hasOwn(body, key))) throw Error('historical_request_boundary');
  const expected = c01Inputs.map((text, index) => [`u${index + 1}`, 'expression', text]);
  const actual = body.session?.statements?.map(statement => [statement.id, statement.kind, statement.text]);
  if (JSON.stringify(actual) !== JSON.stringify(expected) || sample.calls.length !== 4 || body.stage !== 'review' || body.allowNextStep !== false) {
    // 不在异常信息中打印不符合白名单的正文。
    throw Error('historical_fixture_mismatch');
  }
  const context = buildClarityContext({ session: body.session, revision: body.revision, stage: body.stage, allowNextStep: body.allowNextStep });
  return { id: 'C01_HISTORICAL_FINAL', context, origin: {
    kind: 'recorded_synthetic_context', file: 'ai/evaluations/2026-11-01-content-retention.json',
    policyVersion: 'clarity-warm-19', sourceCommit: run.commit, sampleId: 'C01', callIndex: call.index,
    requestId: call.requestId, fixtureInputsMatched: true, inputSha256: digest(JSON.stringify(expected)),
  } };
}

const event = (...anchorIds) => ({ type: 'event', anchorIds, supersedes: [] });
const note = (type, text, anchorIds) => ({ type, text, anchorIds, derivation: 'inferred', supersedes: [] });
const selection = (index, claims) => ({ version: MATERIAL_SELECTION_VERSION, snapshotId: index.snapshotId,
  modeId: 'concern', goal: '核对原句、顾虑与条件', reply: '这段原话可以原样留下。', question: null,
  claims, finish: true, title: '离线原句摘录' });
const idsFrom = (index, ...sourceIds) => index.anchors.filter(anchor => sourceIds.includes(anchor.sourceId)).map(anchor => anchor.id);

async function checkIndex(sample) {
  const context = materialContext(sample);
  try {
    const index = await buildMaterialIndex(context), spans = [], compilations = [];
    for (const anchor of index.anchors) {
      const source = context.statements.find(statement => statement.id === anchor.sourceId);
      const sourceSliceMatches = Boolean(source) && source.text.slice(anchor.start, anchor.end) === anchor.quote;
      spans.push({ anchorId: anchor.id, sourceId: anchor.sourceId, start: anchor.start, end: anchor.end,
        quote: anchor.quote, selectable: anchor.selectable, sourceSliceMatches });
      if (!anchor.selectable) continue;
      const designed = selection(index, [event(anchor.id)]);
      try {
        const compiled = await compileConcernSelection(designed, context);
        const preserved = compiled.ok && compiled.candidate.claims.length === 1 && compiled.candidate.claims[0].type === 'event' &&
          compiled.candidate.claims[0].text === anchor.quote && compiled.candidate.claims[0].evidenceIds.length === 1 &&
          compiled.candidate.claims[0].evidenceIds[0] === anchor.sourceId;
        compilations.push({ kind: 'deterministic_mechanical_fixture', anchorId: anchor.id, selection: designed,
          compiledOK: compiled.ok, wholeOriginalSentencePreserved: preserved, result: compiled, isModelOutput: false });
      } catch (error) {
        compilations.push({ kind: 'deterministic_mechanical_fixture', anchorId: anchor.id, selection: designed,
          compiledOK: false, wholeOriginalSentencePreserved: false, error: errorInfo(error), isModelOutput: false });
      }
    }
    return { id: sample.id, context, requirements: [...sample.requirements], index, spans, compilations,
      allSourceSlicesMatch: spans.length > 0 && spans.every(span => span.sourceSliceMatches),
      allSelectableAnchorsCompiledWhole: compilations.length > 0 && compilations.every(value => value.compiledOK && value.wholeOriginalSentencePreserved),
      contentQualityStatus: 'not_evaluated' };
  } catch (error) {
    return { id: sample.id, context, requirements: [...sample.requirements], error: errorInfo(error),
      allSourceSlicesMatch: false, allSelectableAnchorsCompiledWhole: false, contentQualityStatus: 'not_evaluated' };
  }
}

function routesForEvaluation() {
  const defaults = publicProviders();
  assert.ok(defaults.length === 5, 'expected_five_public_provider_defaults');
  const routes = defaults.map(provider => getPersonalRoute(provider.id, provider.defaultModelId));
  routes.push(getPersonalRoute('bailian', 'deepseek-v4-pro-0813'));
  assert.ok(routes.every(Boolean), 'missing_trusted_evaluation_route');
  assert.ok(new Set(routes.map(route => `${route.providerId}:${route.modelId}`)).size === 6, 'expected_six_distinct_transport_profiles');
  return routes;
}

async function measureRequest(sample, route) {
  const record = { sampleId: sample.id, providerId: route.providerId, modelId: route.modelId,
    instructionChannel: route.profile.instructionChannel, transportMode: route.transportMode ?? 'catalog',
    maxRequestBytes: route.maxRequestBytes, maxOutputTokens: route.maxOutputTokens,
    prepared: false, byteLength: null, headroomBytes: null, withinRequestBudget: false, dispatched: false };
  try {
    const request = await buildConcernMaterialRequest(sample.context, route.profile);
    const prepared = prepareProviderRequest(request, route), body = JSON.parse(prepared.body);
    // byteLength直接采用可信transport的完整JSON测量，不使用字符数或token估计。
    Object.assign(record, { prepared: true, byteLength: prepared.byteLength,
      headroomBytes: route.maxRequestBytes - prepared.byteLength, withinRequestBudget: prepared.byteLength <= route.maxRequestBytes,
      serializedBodySha256: digest(prepared.body), policyVersion: request.policyVersion, schemaVersion: request.schemaVersion,
      requestedOutputTokens: body.max_completion_tokens ?? body.max_tokens,
      systemRoleMatchesRoute: body.messages[0].role === route.profile.instructionChannel });
  } catch (error) {
    // 容量拒绝时保留失败；不截断材料、修改route上限或重试更短请求。
    record.error = errorInfo(error);
  }
  return record;
}

function counterexampleDefinitions() {
  return [
    { id: 'NEG_FREQUENCY_EXPANSION', sampleId: 'H01_FREQUENCY',
      rationale: '把通常扩大为每次和每天，忽略原文明确给出的例外。',
      claims: index => [note('insight', '室友每次洗完衣服都会把晾衣架留在过道，我每天都得绕路。', idsFrom(index, 'u1'))] },
    { id: 'NEG_CONDITION_AS_DECISION', sampleId: 'H02_CONDITION',
      rationale: '尚未报名且取决于照看猫的条件，被写成已经报名并决定出门。',
      claims: index => [note('insight', '我已经报名周日的木工体验课，会按计划出门。', idsFrom(index, 'u1', 'u2'))] },
    { id: 'NEG_INITIAL_GUESS_AS_FACT', sampleId: 'H03_SELF_DOUBT',
      rationale: '没有点评被当作照片差的证据，原始自我怀疑未经证实却变成结论。',
      claims: index => [note('insight', '没有点评说明我的照片拍得很差。', idsFrom(index, 'u1'))] },
    { id: 'NEG_RETRACTED_GUESS_RESTORED', sampleId: 'H04_WITHDRAWAL',
      rationale: '本人已明确撤回不想一起出去的猜测，不能重新作为当前未知。',
      claims: index => [note('unknown', '她是不是不想和我出去，仍未得到答复。', idsFrom(index, 'u1', 'u2'))] },
    { id: 'NEG_QUOTED_FEELING_AS_OWN', sampleId: 'H05_QUOTED_FEELING',
      rationale: '他人说自己烦被归到本人；本人明确说的是意外。',
      claims: index => [note('insight', '排练后我很烦，所以不想再回答问题。', idsFrom(index, 'u1', 'u2'))] },
    { id: 'NEG_CROSS_SENTENCE_CONDITIONS_OMITTED', sampleId: 'H06_CROSS_SENTENCE',
      rationale: '只选愿景原句却丢掉不挡窗、预算和暂缓条件；逐字摘录仍不等于记录完整。',
      claims: index => [event(index.anchors.find(anchor => anchor.sourceId === 'u1').id)] },
    { id: 'NEG_REPEATED_QUOTE_ATTRIBUTION', sampleId: 'H07_REPEATED_QUOTE',
      rationale: '相同话语来自不同时间和原因，不能合并成两天都等天气。',
      claims: index => [note('insight', '第一天和第二天都在等天气预报更新。', idsFrom(index, 'u1', 'u2'))] },
    { id: 'NEG_REVISED_PLAN_REVERSED', sampleId: 'H08_REVISED_PLAN',
      rationale: '散步、不跑步且仍看天气，被改成已决定跑步并忽略天气。',
      claims: index => [note('insight', '我已决定周六下午跑步，不用再看天气。', idsFrom(index, 'u1', 'u2', 'u3'))] },
    { id: 'NEG_EMOTION_CORRECTION_PARAPHRASE', sampleId: 'DESIGNED_EMOTION_CORRECTION',
      statements: [{ id: 'u1', text: '我很失落。', kind: 'expression' }, { id: 'u2', text: '不是失落，是生气。', kind: 'correction' }],
      rationale: '正确引用新感受的原句，但改写文本仍恢复被本人否认的失落；窄文字规则不能证明各种同义表达都忠实。',
      claims: index => [note('insight', '我的真实感受是失落。', idsFrom(index, 'u2'))] },
  ];
}

async function evaluateCounterexamples(samples) {
  const reports = [];
  for (const definition of counterexampleDefinitions()) {
    const sample = definition.statements ? { id: definition.sampleId, statements: definition.statements } : samples.find(value => value.id === definition.sampleId);
    assert.ok(sample, 'missing_counterexample_fixture');
    const context = materialContext(sample);
    try {
      const index = await buildMaterialIndex(context), designed = selection(index, definition.claims(index));
      const compiled = await compileConcernSelection(designed, context);
      reports.push({ id: definition.id, sampleId: sample.id, kind: 'designed_counterexample',
        expectedSemanticVerdict: 'fail', semanticVerdict: 'not_evaluated', semanticReviewMethod: 'authored_counterexample_not_automated_grading',
        rationale: definition.rationale, context, selection: designed, compiledOK: compiled.ok, result: compiled,
        isContentSuccess: false, isModelOutput: false });
    } catch (error) {
      reports.push({ id: definition.id, sampleId: sample.id, kind: 'designed_counterexample', expectedSemanticVerdict: 'fail',
        semanticVerdict: 'not_evaluated', rationale: definition.rationale, compiledOK: false, error: errorInfo(error),
        isContentSuccess: false, isModelOutput: false });
    }
  }
  return reports;
}

export async function evaluateMaterialExperiment() {
  const startedAt = new Date().toISOString();
  assert.ok(MATERIAL_SAMPLES.length === 8 && new Set(MATERIAL_SAMPLES.map(sample => sample.id)).size === 8, 'expected_eight_synthetic_material_samples');
  const historical = loadHistoricalC01();
  const indexChecks = [];
  for (const sample of MATERIAL_SAMPLES) indexChecks.push(await checkIndex(sample));
  const requestSamples = MATERIAL_SAMPLES.map(sample => ({ id: sample.id, context: materialContext(sample),
    origin: { kind: 'new_synthetic_fixture', file: 'ai/fixtures/clarity-material-samples.mjs', inputSha256: digest(JSON.stringify(expectedBody(sample))) } }));
  requestSamples.push(historical);
  const routes = routesForEvaluation(), requestBudgetChecks = [];
  for (const sample of requestSamples) for (const route of routes) requestBudgetChecks.push(await measureRequest(sample, route));
  const counterexamples = await evaluateCounterexamples(MATERIAL_SAMPLES);
  const mechanical = {
    allSourceSpansExact: indexChecks.length === 8 && indexChecks.every(value => value.allSourceSlicesMatch),
    everySelectableAnchorCompiledWhole: indexChecks.every(value => value.allSelectableAnchorsCompiledWhole),
    allRequestBudgetsFit: requestBudgetChecks.length === 54 && requestBudgetChecks.every(value => value.prepared && value.withinRequestBudget && value.systemRoleMatchesRoute && value.requestedOutputTokens === value.maxOutputTokens),
    semanticCounterexamplesRemainExplicit: counterexamples.length >= 5 && counterexamples.every(value => value.compiledOK &&
      value.expectedSemanticVerdict === 'fail' && value.isContentSuccess === false && value.result.selectionTrace.semanticCoverage === 'unverified'),
  };
  const heads = requestBudgetChecks.map(value => value.headroomBytes).filter(Number.isFinite);
  return { method: 'offline_synthetic_design_only', evaluatedAt: new Date().toISOString(), startedAt,
    baselineCommit: '1fbf7c4', baselineMeaning: '实验前功能基线，不表示本次未提交实验的代码SHA或线上发布版本。',
    sourceDigests: ['ai/experiments/clarity-materials.mjs','ai/fixtures/clarity-material-samples.mjs','ai/clarity-grounding.mjs','scripts/clarity-materials-evaluation.mjs']
      .map(file => ({ file, sha256: digest(readFileSync(new URL('../'+file, import.meta.url))) })),
    materialIndexVersion: MATERIAL_INDEX_VERSION, materialSelectionVersion: MATERIAL_SELECTION_VERSION,
    synthetic: true, paidModelCalls: 0, networkRequests: 0, productionIntegrated: false, contentQualityStatus: 'not_evaluated',
    noAutomaticRetries: true, noInputTruncation: true, noCredentialAccess: true,
    scope: '8个保留样例的已知concern/review材料引用，加已验证白名单的历史合成C01收尾上下文；不评场景分类或完整三场景体验。',
    counts: { materialSamples: indexChecks.length, sourceAnchors: indexChecks.reduce((sum, value) => sum + (value.spans?.length ?? 0), 0),
      selectableAnchorCompilations: indexChecks.reduce((sum, value) => sum + (value.compilations?.length ?? 0), 0),
      requestContexts: requestSamples.length, trustedTransportProfiles: routes.length, requestBudgetChecks: requestBudgetChecks.length,
      designedSemanticCounterexamples: counterexamples.length },
    mechanicalGate: { passed: Object.values(mechanical).every(Boolean), checks: mechanical,
      meaning: '仅机械索引、编译、容量及显式语义边界实验通过；不表示模型理解或产品内容质量通过。' },
    capacity: { minHeadroomBytes: heads.length ? Math.min(...heads) : null,
      maxRequestBytesObserved: Math.max(...requestBudgetChecks.map(value => value.byteLength ?? 0)),
      headroomAtLeast1000InEveryPreparedRequest: heads.length === 54 && heads.every(value => value >= 1000),
      headroomNote: '保留精确完整JSON字节余量；1000字节字段仅诊断，不新增或放宽任何生产容量限制。' },
    requestSamples, indexChecks, requestBudgetChecks, counterexamples,
    evidenceBoundaries: [
      '所有选择和输出由确定性测试构造，均非模型生成，不评遵循能力、延迟、tokens或价格。',
      '8个新样例未用于此前三版提示词，但已参与本轮工程实现与检查，不是盲测或真实模型保留集成绩。',
      '引用ID、完整原句和修订身份只能证明当前材料来源；语义涵盖、未知仍成立、程度与条件关系需另行评审。',
      '刻意错误但引用合法的对照可编译并非内容成功，正用于显示本实验不能自动识别这些语义问题。',
      '没有读取默认Key、服务商账户或后台，不修改线上模型、额度、数据库、公开协议或用户记录。',
      'prepareProviderRequest容量拒绝会原样保留，不缩短材料、改路由上限或追加请求。',
    ] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('offline_evaluation_accepts_no_external_inputs');
  let report;
  try { report = await evaluateMaterialExperiment(); }
  catch (error) {
    report = { method: 'offline_synthetic_design_only', evaluatedAt: new Date().toISOString(), baselineCommit: '1fbf7c4',
      synthetic: true, paidModelCalls: 0, networkRequests: 0, productionIntegrated: false, contentQualityStatus: 'not_evaluated',
      mechanicalGate: { passed: false, reason: 'evaluation_initialization_failed' }, error: errorInfo(error) };
  }
  writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ file: fileURLToPath(outputFile), method: report.method, mechanicalGatePassed: report.mechanicalGate.passed,
    counts: report.counts ?? null, capacity: report.capacity ?? null, paidModelCalls: 0, contentQualityStatus: report.contentQualityStatus,
    ...(report.error ? { error: report.error } : {}) }));
  if (!report.mechanicalGate.passed) process.exitCode = 1;
}
