// Production callers must supply a persistent D1 binding. There is no memory fallback.
export const PILOT_LIMITS = Object.freeze({ totalCalls: 18, sessionCalls: 5, concurrentCalls: 2, activeTtlMs: 120000, reservedMicrosPerCall: 50000 });
const OUTCOMES = new Set(['candidate', 'fallback', 'discarded', 'error', 'timeout', 'cancelled', 'completed']);
const idIsValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const timeIsValid = value => Number.isSafeInteger(value) && value >= 0;
const tokenIsValid = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;

function validateReservation({ requestId, sessionId, digest, configVersion, now }) {
  if (!idIsValid(requestId) || !idIsValid(sessionId) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest) || typeof configVersion !== 'string' || !configVersion.trim() || configVersion.length > 200 || !timeIsValid(now)) throw new TypeError('invalid_reservation');
}

function readUsage(usage) {
  if (!usage || !tokenIsValid(usage.promptTokens) || !tokenIsValid(usage.completionTokens) || !tokenIsValid(usage.totalTokens) || usage.totalTokens !== usage.promptTokens + usage.completionTokens) return null;
  return { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens };
}

export function createLedger(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('persistent_ledger_required');
  async function stats({ now = Date.now() } = {}) {
    if (!timeIsValid(now)) throw new TypeError('invalid_ledger_time');
    const row = await db.prepare(`SELECT COUNT(*) AS used_calls,
      COALESCE(SUM(CASE WHEN state = 'started' AND created_at_ms > ? THEN 1 ELSE 0 END), 0) AS active_calls,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens
      FROM pilot_requests`).bind(now - PILOT_LIMITS.activeTtlMs).first();
    const usedCalls = Number(row?.used_calls ?? 0);
    if (!Number.isSafeInteger(usedCalls) || usedCalls < 0) throw new Error('invalid_ledger_state');
    return {
      usedCalls, remainingCalls: Math.max(0, PILOT_LIMITS.totalCalls - usedCalls),
      activeCalls: Number(row?.active_calls ?? 0),
      reservedMicros: usedCalls * PILOT_LIMITS.reservedMicrosPerCall,
      currency: 'CNY', promptTokens: Number(row?.prompt_tokens ?? 0), completionTokens: Number(row?.completion_tokens ?? 0),
    };
  }

  async function reserve({ requestId, sessionId, digest, configVersion, now = Date.now() }) {
    validateReservation({ requestId, sessionId, digest, configVersion, now });
    // All eligibility checks and the insertion happen in one SQLite statement.
    // D1 serializes writes; no prior read or process-local lock grants capacity.
    const result = await db.prepare(`INSERT INTO pilot_requests
      (request_id, session_id, digest, config_version, state, created_at_ms)
      SELECT ?, ?, ?, ?, 'started', ?
      WHERE (SELECT COUNT(*) FROM pilot_requests) < ?
        AND (SELECT COUNT(*) FROM pilot_requests WHERE session_id = ?) < ?
        AND (SELECT COUNT(*) FROM pilot_requests WHERE state = 'started' AND created_at_ms > ?) < ?
      ON CONFLICT(request_id) DO NOTHING`).bind(
      requestId, sessionId, digest.toLowerCase(), configVersion, now,
      PILOT_LIMITS.totalCalls, sessionId, PILOT_LIMITS.sessionCalls,
      now - PILOT_LIMITS.activeTtlMs, PILOT_LIMITS.concurrentCalls,
    ).run();
    if (result?.success === false) throw new Error('ledger_write_failed');
    if (Number(result?.meta?.changes ?? 0) === 1) return { ok: true };
    // These reads diagnose a denied atomic write; they never authorize a call.
    const existing = await db.prepare('SELECT session_id, digest, config_version FROM pilot_requests WHERE request_id = ?').bind(requestId).first();
    if (existing) return { ok: false, reason: existing.session_id === sessionId && existing.digest === digest.toLowerCase() && existing.config_version === configVersion ? 'duplicate_request' : 'request_conflict' };
    const totals = await stats({ now });
    if (totals.usedCalls >= PILOT_LIMITS.totalCalls) return { ok: false, reason: 'budget_exhausted' };
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
