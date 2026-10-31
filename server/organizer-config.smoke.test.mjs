import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getOrganizerRoute, getPersonalRoute, getRoute, isTrustedRoute } from '../ai/providers.mjs';
import { createLedger } from '../ai/ledger.mjs';
import { decryptKey } from './secrets.mjs';
import { getOrganizerStatus, saveOrganizerConfig, setOrganizerEnabled, clearOrganizerKey, resolveOrganizerSource } from './organizer-config.mjs';
import { handleApi, CONSENT_VERSION, PUBLIC_CONFIG_VERSION } from './api.mjs';
import { createSession } from '../public/core.mjs';

// New organizer flow only. All keys and provider responses are synthetic.
const DATE = Date.parse('2026-10-31T12:00:00+08:00');
const now = () => DATE;
const KEY = 'fake-organizer-key-for-smoke-only';
const ORIGIN = 'https://organizer.test';
const CANDIDATE = { reflection: { text: '你说散步很开心。', evidenceIds: ['u_story'] }, hypothesis: null, question: null, nextStep: null };
const complete = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(CANDIDATE) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }));
function fixture(t, historicalCalls = 2) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_glamorous_jackal.sql', '0001_rapid_shocker.sql', '0002_organizer_admin.sql']) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  for (let index = 0; index < historicalCalls; index++) sqlite.prepare(`INSERT INTO pilot_requests
    (request_id,session_id,digest,config_version,state,created_at_ms,reserved_micros)
    VALUES (?,?,'historic','historic','finished',?,50000)`).run(`historic-${index}`, `historic-session-${index}`, DATE - 1000);
  let onRead = () => {}, onRun = () => {}, calls = 0;
  const env = { LIUBAI_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'), LIUBAI_DEFAULT_DEEPSEEK_KEY: 'fake-environment-default-key-only', DB: { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { const row = sqlite.prepare(sql).get(...args) ?? null; onRead(sql); return row; },
      async run() { const result = sqlite.prepare(sql).run(...args); onRun(sql); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  } } };
  const api = async (body, fetchImpl = async () => { calls++; return complete(); }, path = '/api/ai/generate', clock = now) => {
    const request = new Request(ORIGIN + path, body ? { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const response = await handleApi(request, env, { now: clock, fetchImpl });
    return { status: response.status, body: await response.json() };
  };
  return { env, sqlite, api, calls: () => calls, onRead: hook => { onRead = hook; }, onRun: hook => { onRun = hook; } };
}
const settings = overrides => ({ expectedRevision: 0, providerId: 'bailian', modelId: 'qwen3.8-flash', pricingMode: 'catalog', inputRate: 999, outputRate: 999,
  apiKey: KEY, enabled: true, callLimit: null, budgetCny: null, ...overrides });
function input(overrides = {}) {
  const session = createSession(); session.id = 'organizer-session'; session.story = '散步很开心。';
  return { requestId: 'organizer-request', revision: 1, configVersion: PUBLIC_CONFIG_VERSION, consentVersion: CONSENT_VERSION,
    sourceMode: 'default', providerId: 'bailian', modelId: 'qwen3.8-flash', defaultRevision: 1, stage: 'reflect', allowNextStep: false, session, ...overrides };
}

test('organizer signer issues only fixed priced or explicitly unpriced server routes', () => {
  for (const [providerId, modelId] of [['deepseek', 'deepseek-flash'], ['kimi', 'kimi-k3.1-pro'], ['glm', 'glm-4.7-flash'], ['openai', 'gpt-6-luna'], ['bailian', 'qwen3.8-flash']]) {
    const route = getOrganizerRoute({ providerId, modelId, pricingMode: 'catalog', revision: 1, endpoint: 'https://attacker.invalid' });
    assert.equal(isTrustedRoute(route), true);
    assert.equal(isTrustedRoute({ ...route }), false);
    assert.ok(route.reserveMicros >= 50000);
    assert.ok(route.inputRateCnyPerMillion !== null);
    assert.notEqual(route.endpoint, 'https://attacker.invalid');
    assert.match(route.priceVersion, /organizer-1/);
  }
  assert.equal(getRoute('bailian', 'qwen3.8-flash'), null);
  assert.equal(getPersonalRoute('bailian', 'qwen3.8-flash').inputRateCnyPerMillion, null);
  const bailian = getOrganizerRoute({ providerId: 'bailian', modelId: 'qwen3.8-flash', pricingMode: 'catalog', revision: 1 });
  assert.equal(bailian.inputRateCnyPerMillion, 0.8); assert.equal(bailian.outputRateCnyPerMillion, 2.7);
  const unpriced = getOrganizerRoute({ providerId: 'bailian', modelId: 'glm-5.3', pricingMode: 'manual', inputRate: null, outputRate: null, revision: 2 });
  assert.equal(unpriced.reserveMicros, 0); assert.equal(unpriced.priceVersion, 'organizer-unpriced-r2');
  for (const rates of [[null, 1], [-1, 1], [Infinity, 1], ['1', 1]]) assert.equal(getOrganizerRoute({ providerId: 'bailian', modelId: 'glm-5.3', pricingMode: 'manual', inputRate: rates[0], outputRate: rates[1], revision: 1 }), null);
});

test('organizer status, encrypted save, same-provider key retention, CAS and authoritative clearing', async t => {
  const f = fixture(t);
  const initial = await getOrganizerStatus(f.env, { now });
  assert.equal(initial.catalog.length, 5);
  assert.equal(initial.config.callLimit, null); assert.equal(initial.config.budgetCny, null);
  assert.equal(initial.budget.remainingCalls, null); assert.equal(initial.budget.remainingBudgetCny, null);
  assert.equal(initial.budget.usedCalls, 2); assert.equal(initial.budget.reservedCny, 0.1);
  const saved = await saveOrganizerConfig(f.env, settings(), { now });
  assert.deepEqual(saved, { ok: true, status: 200, body: { saved: true, revision: 1 } });
  const row = f.sqlite.prepare('SELECT * FROM organizer_config').get();
  assert.notEqual(row.encrypted_key, KEY); assert.equal(await decryptKey(row, f.env.LIUBAI_SECRET_KEY), KEY);
  assert.doesNotMatch(JSON.stringify(await getOrganizerStatus(f.env, { now })), /fake-organizer|encrypted_key|"iv"/);
  assert.equal((await saveOrganizerConfig(f.env, settings({ expectedRevision: 1, providerId: 'openai', modelId: 'gpt-6-luna', apiKey: '' }), { now })).body.reason, 'invalid_key');
  const custom = await saveOrganizerConfig(f.env, settings({ expectedRevision: 1, modelId: 'glm-5.3', pricingMode: 'manual', inputRate: null, outputRate: null, apiKey: '' }), { now });
  assert.equal(custom.body.revision, 2);
  assert.equal(f.sqlite.prepare('SELECT encrypted_key FROM organizer_config').get().encrypted_key, row.encrypted_key);
  const competing = await Promise.all([false, true].map(enabled => setOrganizerEnabled(f.env, { expectedRevision: 2, enabled }, { now })));
  assert.equal(competing.filter(result => result.ok).length, 1);
  assert.equal(competing.filter(result => result.body.reason === 'config_conflict').length, 1);
  assert.equal((await clearOrganizerKey(f.env, { expectedRevision: 3 }, { now })).body.revision, 4);
  const cleared = await resolveOrganizerSource(f.env, { now });
  assert.equal(cleared.present, true); assert.equal(cleared.source, null);
  assert.equal((await f.api(null, undefined, '/api/ai/status')).body.defaultAvailable, false);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, 2);
});

test('unknown-price default stays monitor-only and continues after historical legacy allowance', async t => {
  const f = fixture(t, 18);
  assert.equal((await saveOrganizerConfig(f.env, settings({ modelId: 'glm-5.3', pricingMode: 'manual', inputRate: null, outputRate: null, budgetCny: 1 }), { now })).body.reason, 'invalid_pricing');
  await saveOrganizerConfig(f.env, settings({ modelId: 'glm-5.3', pricingMode: 'manual', inputRate: null, outputRate: null }), { now });
  const status = (await f.api(null, undefined, '/api/ai/status')).body;
  assert.equal(status.defaultProfile.defaultRevision, 1); assert.equal(status.defaultEnabled, true);
  assert.equal(status.remainingCalls, null); assert.equal(status.remainingBudgetCny, null);
  const stale = await f.api(input({ modelId: 'glm-5.3', defaultRevision: 0 }));
  assert.equal(stale.body.reason, 'consent_changed'); assert.equal(f.calls(), 0);
  const body = input({ modelId: 'glm-5.3', inputRate: 99999, outputRate: 99999 });
  let calls = 0;
  const fakeFetch = async (url, request) => {
    calls++; assert.equal(url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(request.headers.Authorization, `Bearer ${KEY}`);
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, 'glm-5.3'); assert.equal(payload.messages[0].role, 'system'); assert.match(payload.messages[0].content, /留白/);
    assert.equal(payload.max_completion_tokens, 2000); assert.equal(payload.enable_thinking, undefined);
    return complete();
  };
  const result = await f.api(body, fakeFetch);
  assert.equal(result.body.status, 'candidate'); assert.deepEqual(result.body.candidate, CANDIDATE);
  assert.equal(result.body.route.defaultRevision, 1);
  assert.equal((await f.api(body, fakeFetch)).body.reason, 'duplicate_request'); assert.equal(calls, 1);
  const row = f.sqlite.prepare('SELECT * FROM pilot_requests WHERE request_id=?').get(body.requestId);
  assert.equal(row.reserved_micros, 0); assert.equal(row.price_version, 'organizer-unpriced-r1');
  const monitored = await getOrganizerStatus(f.env, { now });
  assert.equal(monitored.budget.usedCalls, 19); assert.equal(monitored.budget.reservedCny, 0.9);
  assert.equal(monitored.budget.sharedPromptTokens, 100); assert.equal(monitored.budget.sharedCompletionTokens, 30);
});

test('optional organizer limits apply atomically to cumulative history and can be removed without a reset', async t => {
  const f = fixture(t);
  await saveOrganizerConfig(f.env, settings({ callLimit: 3, budgetCny: 0.15 }), { now });
  assert.equal((await f.api(input())).body.status, 'candidate');
  assert.equal((await f.api(input({ requestId: 'organizer-over-limit' }))).body.reason, 'budget_exhausted');
  const limited = await getOrganizerStatus(f.env, { now });
  assert.equal(limited.budget.usedCalls, 3); assert.equal(limited.budget.remainingCalls, 0);
  assert.equal(limited.budget.remainingBudgetCny, 0);
  await saveOrganizerConfig(f.env, settings({ expectedRevision: 1, apiKey: '' }), { now });
  assert.equal((await f.api(input({ requestId: 'organizer-after-unlimit', defaultRevision: 2 }))).body.status, 'candidate');
  const monitored = await getOrganizerStatus(f.env, { now });
  assert.equal(monitored.budget.usedCalls, 4); assert.equal(monitored.budget.reservedCny, 0.2);
  assert.equal(monitored.budget.remainingCalls, null); assert.equal(monitored.budget.remainingBudgetCny, null);
  assert.equal((await createLedger(f.env.DB).stats({ now: DATE })).remainingCalls, 14);
});

test('organizer changes before reserve or before dispatch stop the old version without model calls', async t => {
  for (const boundary of ['before-reserve', 'before-dispatch']) {
    const f = fixture(t); await saveOrganizerConfig(f.env, settings(), { now });
    if (boundary === 'before-reserve') {
      let reads = 0;
      f.onRead(sql => { if (sql.includes('FROM organizer_config') && ++reads === 1) f.sqlite.exec('UPDATE organizer_config SET enabled=0, revision=revision+1'); });
    } else {
      f.onRun(sql => { if (sql.startsWith('INSERT INTO pilot_requests')) f.sqlite.exec('UPDATE organizer_config SET enabled=0, revision=revision+1'); });
    }
    const result = await f.api(input());
    assert.equal(result.body.reason, 'config_changed'); assert.equal(f.calls(), 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n, boundary === 'before-reserve' ? 2 : 3);
  }
});

test('in-flight organizer candidates are withheld after key, pricing or enabled revision changes', async t => {
  const f = fixture(t); await saveOrganizerConfig(f.env, settings(), { now });
  const result = await f.api(input(), async () => {
    await setOrganizerEnabled(f.env, { expectedRevision: 1, enabled: false }, { now });
    return complete();
  });
  assert.equal(result.status, 409); assert.equal(result.body.reason, 'config_changed'); assert.equal(result.body.candidate, undefined);
  assert.equal(f.sqlite.prepare('SELECT reserved_micros FROM pilot_requests WHERE request_id=?').get('organizer-request').reserved_micros, 50000);
  assert.equal((await f.api(null, undefined, '/api/ai/status')).body.defaultAvailable, false);
  assert.equal((await f.api(input({ providerId: 'deepseek', modelId: 'deepseek-flash' }))).body.reason, 'default_unavailable');
});

test('corrupt organizer credentials remain authoritative and unknown price cannot bypass a configured money limit', async t => {
  const f = fixture(t); await saveOrganizerConfig(f.env, settings(), { now });
  f.sqlite.exec("UPDATE organizer_config SET encrypted_key='broken'");
  assert.deepEqual((await resolveOrganizerSource(f.env, { now })).source, null);
  assert.equal((await f.api(input())).body.reason, 'default_unavailable'); assert.equal(f.calls(), 0);
  const ledger = createLedger(f.env.DB, { sharedLimits: { totalCalls: null, sharedBudgetMicros: 1000000 } });
  await assert.rejects(() => ledger.reserve({ requestId: 'forged-unpriced', sessionId: 'session', digest: 'a'.repeat(64), configVersion: 'test', now: DATE,
    providerId: 'bailian', modelId: 'future', priceVersion: 'organizer-unpriced-r1', reservedMicros: 0 }), /invalid_reservation/);
});

test('monitor-only ledger still keeps atomic concurrency, session and optional single-limit checks', async t => {
  const f = fixture(t);
  const ledger = createLedger(f.env.DB, { sharedLimits: { totalCalls: null, sharedBudgetMicros: null } });
  const reserve = index => ledger.reserve({ requestId: `monitor-${index}`, sessionId: 'monitor-session', digest: 'a'.repeat(64), configVersion: 'test', now: DATE,
    providerId: 'bailian', modelId: 'future', priceVersion: 'organizer-unpriced-r1', reservedMicros: 0 });
  const concurrent = await Promise.all([0, 1, 2].map(reserve));
  assert.equal(concurrent.filter(result => result.ok).length, 2);
  assert.equal(concurrent.filter(result => result.reason === 'concurrency_limit').length, 1);
  for (const index of [0, 1]) await ledger.finish(`monitor-${index}`, { outcome: 'candidate', now: DATE });
  for (const index of [3, 4, 5]) { assert.equal((await reserve(index)).ok, true); await ledger.finish(`monitor-${index}`, { outcome: 'candidate', now: DATE }); }
  assert.equal((await reserve(6)).reason, 'session_limit');
  const usedCalls = (await ledger.stats({ now: DATE })).usedCalls;
  for (const limits of [{ totalCalls: usedCalls, sharedBudgetMicros: null }, { totalCalls: null, sharedBudgetMicros: 100000 }]) {
    const limited = createLedger(f.env.DB, { sharedLimits: limits });
    assert.equal((await limited.reserve({ requestId: 'limited-one-boundary', sessionId: 'different-session', digest: 'b'.repeat(64), configVersion: 'test', now: DATE,
      providerId: 'bailian', modelId: 'qwen3.8-flash', priceVersion: 'organizer-1-catalog', reservedMicros: 50000 })).reason, 'budget_exhausted');
  }
});

test('organizer and personal models outlive the old trial date while the untouched legacy default retains it', async t => {
  const expired = () => Date.parse('2026-11-07T12:00:00+08:00');
  const f = fixture(t); await saveOrganizerConfig(f.env, settings(), { now });
  const managed = await getOrganizerStatus(f.env, { now: expired });
  assert.equal(managed.availability.enabled, true); assert.equal(managed.limits.priceValidUntil, null);
  const status = (await f.api(null, undefined, '/api/ai/status', expired)).body;
  assert.equal(status.enabled, true); assert.equal(status.defaultEnabled, true); assert.equal(status.reason, null);
  assert.equal((await f.api(input(), undefined, '/api/ai/generate', expired)).body.status, 'candidate');
  const personal = await f.api(input({ requestId: 'personal-after-old-date', sourceMode: 'personal', personalApiKey: 'fake-personal-after-old-date-key', modelId: 'glm-5.3' }), undefined, '/api/ai/generate', expired);
  assert.equal(personal.body.status, 'candidate'); assert.equal(personal.body.route.defaultRevision, undefined);
  const legacy = fixture(t);
  const oldStatus = (await legacy.api(null, undefined, '/api/ai/status', expired)).body;
  assert.equal(oldStatus.enabled, true); assert.equal(oldStatus.defaultEnabled, false); assert.equal(oldStatus.defaultReason, 'pricing_expired');
  assert.equal((await legacy.api(input({ providerId: 'deepseek', modelId: 'deepseek-flash' }), undefined, '/api/ai/generate', expired)).body.reason, 'pricing_expired');
  assert.equal(legacy.calls(), 0);
});
