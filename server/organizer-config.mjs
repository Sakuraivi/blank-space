import { getOrganizerRoute, publicProviders, validPersonalModelId } from '../ai/providers.mjs';
import { createLedger, PILOT_LIMITS } from '../ai/ledger.mjs';
import { encryptKey, decryptKey } from './secrets.mjs';

const keyIsValid = value => typeof value === 'string' && /^[\x21-\x7E]{16,256}$/.test(value);
const revisionIsValid = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const readConfig = db => db.prepare("SELECT * FROM organizer_config WHERE id = 'main'").first();
const fail = (reason, status = 400) => ({ ok: false, status, body: { reason } });
const success = body => ({ ok: true, status: 200, body });
const timeFor = now => {
  const time = now();
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('invalid_time');
  return time;
};
const emptyConfig = () => ({ provider_id: 'deepseek', model_id: 'deepseek-flash', pricing_mode: 'catalog', input_rate: 2, output_rate: 8,
  call_limit: null, shared_budget_micros: null, encrypted_key: null, iv: null, enabled: 0, revision: 0, updated_at_ms: null });
const routeFor = row => getOrganizerRoute({ providerId: row.provider_id, modelId: row.model_id, pricingMode: row.pricing_mode,
  inputRate: row.input_rate, outputRate: row.output_rate, revision: row.revision });
const encryptedPresent = row => typeof row.encrypted_key === 'string' && !!row.encrypted_key && typeof row.iv === 'string' && !!row.iv;
const optionalLimit = value => value === null || Number.isSafeInteger(value) && value >= 0;
const limitsFor = row => optionalLimit(row.call_limit) && optionalLimit(row.shared_budget_micros)
  ? { totalCalls: row.call_limit, sharedBudgetMicros: row.shared_budget_micros } : null;
const validPricing = (row, route) => !!route && !!limitsFor(row) && !(route.inputRateCnyPerMillion === null && row.shared_budget_micros !== null);

async function usableKey(row, env) {
  if (!encryptedPresent(row)) return false;
  try { return keyIsValid(await decryptKey(row, env.LIUBAI_SECRET_KEY)); }
  catch { return false; }
}

// A row is authoritative even when disabled or invalid. Never fall back to a
// different payer after the organizer has explicitly saved a configuration.
export async function resolveOrganizerSource(env, { now = Date.now } = {}) {
  timeFor(now);
  const row = await readConfig(env.DB);
  if (!row) return { present: false, source: null };
  const route = routeFor(row);
  const sharedLimits = limitsFor(row) ?? { totalCalls: 0, sharedBudgetMicros: 0 };
  if (row.enabled !== 1 || !validPricing(row, route) || !await usableKey(row, env)) return { present: true, source: null, sharedLimits };
  return { present: true, sharedLimits, source: { type: 'organizer', revision: row.revision, route, encrypted_key: row.encrypted_key, iv: row.iv, sharedLimits } };
}

function organizerCatalog() {
  return publicProviders().map(provider => ({ ...provider, models: provider.models.map(model => {
    const route = getOrganizerRoute({ providerId: provider.id, modelId: model.id, pricingMode: 'catalog', revision: 1 });
    return { ...model, inputRate: route.inputRateCnyPerMillion, outputRate: route.outputRateCnyPerMillion, reserveCny: route.reserveMicros / 1000000 };
  }) }));
}

async function sharedSafetyStopped(db) {
  return !!await db.prepare(`SELECT 1 AS stopped FROM pilot_requests WHERE source_mode = 'default' AND
    (outcome = 'error' OR (price_version IS NULL AND (prompt_tokens > 13000 OR completion_tokens > 1000
      OR prompt_tokens * 2 + completion_tokens * 8 > 50000))) LIMIT 1`).first();
}

export async function getOrganizerStatus(env, { now = Date.now } = {}) {
  const time = timeFor(now), stored = await readConfig(env.DB), row = stored ?? emptyConfig();
  const route = stored ? routeFor(row) : getOrganizerRoute({ providerId: row.provider_id, modelId: row.model_id, pricingMode: row.pricing_mode, revision: 1 });
  const sharedLimits = limitsFor(row) ?? { totalCalls: 0, sharedBudgetMicros: 0 };
  const stats = await createLedger(env.DB, { sharedLimits }).stats({ now: time });
  const hasKey = encryptedPresent(row);
  const reason = env.LIUBAI_MAINTENANCE === '1' ? 'maintenance' :
    !stored ? 'not_configured' : row.enabled !== 1 ? 'disabled' : !validPricing(row, route) || !await usableKey(row, env) ? 'invalid_config' :
    await sharedSafetyStopped(env.DB) ? 'usage_out_of_bounds' :
      stats.remainingCalls !== null && stats.remainingCalls <= 0 || stats.remainingBudgetMicros !== null && stats.remainingBudgetMicros < route.reserveMicros ? 'budget_exhausted' : null;
  return {
    catalog: organizerCatalog(),
    config: { revision: row.revision, providerId: row.provider_id, modelId: row.model_id, pricingMode: row.pricing_mode,
      inputRate: route?.inputRateCnyPerMillion ?? row.input_rate, outputRate: route?.outputRateCnyPerMillion ?? row.output_rate,
      callLimit: row.call_limit, budgetCny: row.shared_budget_micros === null ? null : row.shared_budget_micros / 1000000,
      enabled: row.enabled === 1, hasKey, updatedAt: row.updated_at_ms },
    budget: { remainingCalls: stats.remainingCalls, remainingBudgetCny: stats.remainingBudgetMicros === null ? null : stats.remainingBudgetMicros / 1000000,
      totalCalls: sharedLimits.totalCalls, budgetCny: sharedLimits.sharedBudgetMicros === null ? null : sharedLimits.sharedBudgetMicros / 1000000, currency: 'CNY',
      usedCalls: stats.usedCalls, sharedPromptTokens: stats.sharedPromptTokens, sharedCompletionTokens: stats.sharedCompletionTokens, reservedCny: stats.reservedMicros / 1000000 },
    availability: { enabled: reason === null, reason },
    limits: { sessionCalls: PILOT_LIMITS.sessionCalls, concurrentCalls: PILOT_LIMITS.concurrentCalls, callLimit: row.call_limit,
      budgetCny: row.shared_budget_micros === null ? null : row.shared_budget_micros / 1000000, priceValidUntil: null },
  };
}

async function persist(env, row, expectedRevision) {
  const values = [row.provider_id, row.model_id, row.pricing_mode, row.input_rate, row.output_rate,
    row.call_limit, row.shared_budget_micros, row.encrypted_key, row.iv, row.enabled, expectedRevision + 1, row.updated_at_ms];
  const result = expectedRevision === 0
    ? await env.DB.prepare(`INSERT INTO organizer_config
      (id, provider_id, model_id, pricing_mode, input_rate, output_rate, call_limit, shared_budget_micros, encrypted_key, iv, enabled, revision, updated_at_ms)
      VALUES ('main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(...values).run()
    : await env.DB.prepare(`UPDATE organizer_config SET provider_id = ?, model_id = ?, pricing_mode = ?, input_rate = ?, output_rate = ?,
      call_limit = ?, shared_budget_micros = ?, encrypted_key = ?, iv = ?, enabled = ?, revision = ?, updated_at_ms = ? WHERE id = 'main' AND revision = ?`).bind(...values, expectedRevision).run();
  if (result?.success === false) throw new Error('config_write_failed');
  return Number(result?.meta?.changes ?? 0) === 1;
}

async function currentForWrite(env, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !revisionIsValid(body.expectedRevision)) return { error: fail('invalid_config') };
  const stored = await readConfig(env.DB);
  if ((stored?.revision ?? 0) !== body.expectedRevision) return { error: fail('config_conflict', 409) };
  return { row: stored ?? emptyConfig() };
}

export async function saveOrganizerConfig(env, body, { now = Date.now } = {}) {
  const current = await currentForWrite(env, body);
  if (current.error) return current.error;
  if (typeof body.enabled !== 'boolean' || typeof body.apiKey !== 'string' ||
      !publicProviders().some(provider => provider.id === body.providerId) || !validPersonalModelId(body.modelId) ||
      !['catalog', 'manual'].includes(body.pricingMode) || ['endpoint', 'baseUrl', 'apiUrl'].some(key => body[key] !== undefined)) return fail('invalid_config');
  const callLimit = body.callLimit ?? null, budgetCny = body.budgetCny ?? null;
  const sharedBudgetMicros = budgetCny === null ? null : typeof budgetCny === 'number' && Number.isFinite(budgetCny) && budgetCny >= 0 ? Math.round(budgetCny * 1000000) : NaN;
  if (!optionalLimit(callLimit) || !optionalLimit(sharedBudgetMicros)) return fail('invalid_config');
  const route = getOrganizerRoute({ ...body, inputRate: body.inputRate ?? null, outputRate: body.outputRate ?? null, revision: body.expectedRevision + 1 });
  if (!route) return fail(body.pricingMode === 'manual' ? 'invalid_pricing' : 'invalid_config');
  if (route.inputRateCnyPerMillion === null && sharedBudgetMicros !== null) return fail('invalid_pricing');
  const apiKey = body.apiKey.trim();
  if ((apiKey && !keyIsValid(apiKey)) || (!apiKey && (current.row.provider_id !== body.providerId || !await usableKey(current.row, env)))) return fail('invalid_key');
  const encrypted = apiKey ? await encryptKey(apiKey, env.LIUBAI_SECRET_KEY) : { encrypted_key: current.row.encrypted_key, iv: current.row.iv };
  const row = { provider_id: body.providerId, model_id: body.modelId, pricing_mode: body.pricingMode,
    input_rate: route.inputRateCnyPerMillion, output_rate: route.outputRateCnyPerMillion, call_limit: callLimit, shared_budget_micros: sharedBudgetMicros, ...encrypted,
    enabled: body.enabled ? 1 : 0, updated_at_ms: timeFor(now) };
  if (!await persist(env, row, body.expectedRevision)) return fail('config_conflict', 409);
  return success({ saved: true, revision: body.expectedRevision + 1 });
}

export async function setOrganizerEnabled(env, body, { now = Date.now } = {}) {
  const current = await currentForWrite(env, body);
  if (current.error) return current.error;
  if (typeof body.enabled !== 'boolean') return fail('invalid_config');
  const row = { ...current.row, revision: body.expectedRevision + 1 };
  if (body.enabled && !validPricing(row, routeFor(row))) return fail('invalid_pricing');
  if (body.enabled && !await usableKey(row, env)) return fail('invalid_key');
  if (!await persist(env, { ...row, enabled: body.enabled ? 1 : 0, updated_at_ms: timeFor(now) }, body.expectedRevision)) return fail('config_conflict', 409);
  return success({ saved: true, revision: body.expectedRevision + 1 });
}

export async function clearOrganizerKey(env, body, { now = Date.now } = {}) {
  const current = await currentForWrite(env, body);
  if (current.error) return current.error;
  if (!await persist(env, { ...current.row, encrypted_key: null, iv: null, enabled: 0, updated_at_ms: timeFor(now) }, body.expectedRevision)) return fail('config_conflict', 409);
  return success({ deleted: true, revision: body.expectedRevision + 1 });
}
