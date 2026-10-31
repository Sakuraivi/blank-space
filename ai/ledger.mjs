// Production callers must supply a persistent D1 binding. There is no memory fallback.
export const PILOT_LIMITS = Object.freeze({ totalCalls: 18, sessionCalls: 5, concurrentCalls: 2, activeTtlMs: 120000, reservedMicrosPerCall: 50000, sharedBudgetMicros: 900000 });
const OUTCOMES = new Set(['candidate', 'fallback', 'discarded', 'error', 'timeout', 'cancelled', 'completed']);
const idIsValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const timeIsValid = value => Number.isSafeInteger(value) && value >= 0;
const tokenIsValid = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const routePartIsValid = value => value === null || (typeof value === 'string' && /^[a-zA-Z0-9._/-]{1,100}$/.test(value));
const modelPartIsValid = value => value === null || (typeof value === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_./:-]{0,99}$/.test(value) && !value.includes('://'));

function validateReservation({ requestId, sessionId, digest, configVersion, now, sourceMode, providerId, modelId, priceVersion, reservedMicros }) {
  if (!idIsValid(requestId) || !idIsValid(sessionId) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest) || typeof configVersion !== 'string' || !configVersion.trim() || configVersion.length > 200 || !timeIsValid(now) ||
      !['default', 'personal'].includes(sourceMode) || ![providerId, priceVersion].every(routePartIsValid) || !modelPartIsValid(modelId) || (providerId === null) !== (modelId === null) ||
      !Number.isSafeInteger(reservedMicros) || (sourceMode === 'personal' ? reservedMicros !== 0 : reservedMicros < PILOT_LIMITS.reservedMicrosPerCall || reservedMicros > PILOT_LIMITS.sharedBudgetMicros)) throw new TypeError('invalid_reservation');
}

function readUsage(usage) {
  if (!usage || !tokenIsValid(usage.promptTokens) || !tokenIsValid(usage.completionTokens) || !tokenIsValid(usage.totalTokens) || usage.totalTokens !== usage.promptTokens + usage.completionTokens) return null;
  return { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens };
}

export function createLedger(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('persistent_ledger_required');
  async function stats({ now = Date.now() } = {}) {
    if (!timeIsValid(now)) throw new TypeError('invalid_ledger_time');
    const row = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN source_mode = 'default' THEN 1 ELSE 0 END), 0) AS used_calls,
      COALESCE(SUM(CASE WHEN source_mode = 'personal' THEN 1 ELSE 0 END), 0) AS personal_calls,
      COALESCE(SUM(CASE WHEN source_mode = 'default' THEN reserved_micros ELSE 0 END), 0) AS reserved_micros,
      COALESCE(SUM(CASE WHEN state = 'started' AND created_at_ms > ? THEN 1 ELSE 0 END), 0) AS active_calls,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(CASE WHEN source_mode = 'default' THEN prompt_tokens ELSE 0 END), 0) AS shared_prompt_tokens,
      COALESCE(SUM(CASE WHEN source_mode = 'default' THEN completion_tokens ELSE 0 END), 0) AS shared_completion_tokens,
      COALESCE(SUM(CASE WHEN source_mode = 'personal' THEN prompt_tokens ELSE 0 END), 0) AS personal_prompt_tokens,
      COALESCE(SUM(CASE WHEN source_mode = 'personal' THEN completion_tokens ELSE 0 END), 0) AS personal_completion_tokens
      FROM pilot_requests`).bind(now - PILOT_LIMITS.activeTtlMs).first();
    const usedCalls = Number(row?.used_calls ?? 0);
    const personalCalls = Number(row?.personal_calls ?? 0);
    const reservedMicros = Number(row?.reserved_micros ?? 0);
    if ([usedCalls, personalCalls, reservedMicros].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('invalid_ledger_state');
    return {
      usedCalls, remainingCalls: Math.max(0, PILOT_LIMITS.totalCalls - usedCalls),
      personalCalls,
      activeCalls: Number(row?.active_calls ?? 0),
      reservedMicros, remainingBudgetMicros: Math.max(0, PILOT_LIMITS.sharedBudgetMicros - reservedMicros),
      // Total token observations span both payers; they are not shared spend.
      currency: 'CNY', promptTokens: Number(row?.prompt_tokens ?? 0), completionTokens: Number(row?.completion_tokens ?? 0),
      sharedPromptTokens: Number(row?.shared_prompt_tokens ?? 0), sharedCompletionTokens: Number(row?.shared_completion_tokens ?? 0),
      personalPromptTokens: Number(row?.personal_prompt_tokens ?? 0), personalCompletionTokens: Number(row?.personal_completion_tokens ?? 0),
    };
  }

  async function reserve({ requestId, sessionId, digest, configVersion, now = Date.now(), sourceMode = 'default', providerId = null, modelId = null, priceVersion = null, reservedMicros = sourceMode === 'personal' ? 0 : PILOT_LIMITS.reservedMicrosPerCall }) {
    validateReservation({ requestId, sessionId, digest, configVersion, now, sourceMode, providerId, modelId, priceVersion, reservedMicros });
    // All eligibility checks and the insertion happen in one SQLite statement.
    // D1 serializes writes; no prior read or process-local lock grants capacity.
    const result = await db.prepare(`INSERT INTO pilot_requests
      (request_id, session_id, digest, config_version, state, created_at_ms,
       source_mode, provider_id, model_id, price_version, reserved_micros)
      SELECT ?, ?, ?, ?, 'started', ?, ?, ?, ?, ?, ?
      WHERE (? = 'personal' OR (
          (SELECT COUNT(*) FROM pilot_requests WHERE source_mode = 'default') < ?
          AND (SELECT COALESCE(SUM(reserved_micros), 0) FROM pilot_requests WHERE source_mode = 'default') + ? <= ?
        ))
        AND (SELECT COUNT(*) FROM pilot_requests WHERE session_id = ?) < ?
        AND (SELECT COUNT(*) FROM pilot_requests WHERE state = 'started' AND created_at_ms > ?) < ?
      ON CONFLICT(request_id) DO NOTHING`).bind(
      requestId, sessionId, digest.toLowerCase(), configVersion, now,
      sourceMode, providerId, modelId, priceVersion, reservedMicros,
      sourceMode, PILOT_LIMITS.totalCalls, reservedMicros, PILOT_LIMITS.sharedBudgetMicros, sessionId, PILOT_LIMITS.sessionCalls,
      now - PILOT_LIMITS.activeTtlMs, PILOT_LIMITS.concurrentCalls,
    ).run();
    if (result?.success === false) throw new Error('ledger_write_failed');
    if (Number(result?.meta?.changes ?? 0) === 1) return { ok: true };
    // These reads diagnose a denied atomic write; they never authorize a call.
    const existing = await db.prepare('SELECT session_id, digest, config_version, source_mode, provider_id, model_id, price_version, reserved_micros FROM pilot_requests WHERE request_id = ?').bind(requestId).first();
    if (existing) return { ok: false, reason: existing.session_id === sessionId && existing.digest === digest.toLowerCase() && existing.config_version === configVersion &&
      existing.source_mode === sourceMode && existing.provider_id === providerId && existing.model_id === modelId && existing.price_version === priceVersion && existing.reserved_micros === reservedMicros ? 'duplicate_request' : 'request_conflict' };
    const totals = await stats({ now });
    if (sourceMode === 'default' && (totals.usedCalls >= PILOT_LIMITS.totalCalls || totals.reservedMicros + reservedMicros > PILOT_LIMITS.sharedBudgetMicros)) return { ok: false, reason: 'budget_exhausted' };
    const session = await db.prepare('SELECT COUNT(*) AS calls FROM pilot_requests WHERE session_id = ?').bind(sessionId).first();
    if (Number(session?.calls ?? 0) >= PILOT_LIMITS.sessionCalls) return { ok: false, reason: 'session_limit' };
    return { ok: false, reason: 'concurrency_limit' };
  }

  async function finish(requestId, { outcome, usage, now = Date.now() } = {}) {
    if (!idIsValid(requestId) || !OUTCOMES.has(outcome) || !timeIsValid(now)) throw new TypeError('invalid_completion');
    const safeUsage = readUsage(usage);
    const result = await db.prepare(`UPDATE pilot_requests SET state = 'finished', outcome = ?, finished_at_ms = ?,
      prompt_tokens = ?, completion_tokens = ?, total_tokens = ?
      WHERE request_id = ? AND state = 'started'`).bind(
      outcome, now, safeUsage?.promptTokens ?? null, safeUsage?.completionTokens ?? null,
      safeUsage?.totalTokens ?? null, requestId,
    ).run();
    if (result?.success === false) throw new Error('ledger_write_failed');
    return { ok: Number(result?.meta?.changes ?? 0) === 1 };
  }
  return Object.freeze({ reserve, finish, stats });
}
