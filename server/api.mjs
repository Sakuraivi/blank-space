import { buildContext, buildModelRequest } from '../ai/contract.mjs';
import { runCandidate } from '../ai/runtime.mjs';
import { createDeepseekAdapter, prepareDeepseekRequest, DEEPSEEK_PROFILE } from '../ai/deepseek.mjs';
import { createLedger } from '../ai/ledger.mjs';
import { encryptKey, decryptKey, digest } from './secrets.mjs';

export const CONSENT_VERSION = 'deepseek-v1';
export const PRICE_VALID_UNTIL = Date.parse('2026-11-06T00:00:00+08:00');
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const fallback = (reason, status = 400) => response({ status: 'fallback', reason }, status);
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(x);
const configVersion = c => `deepseek-${c?.revision ?? 0}`;
const configRow = db => db.prepare("SELECT * FROM pilot_config WHERE id = 'main'").first();
const isConfigured = (c, env) => !!(c?.encrypted_key && c?.iv && c?.invite_hash && env.LIUBAI_SECRET_KEY);

async function readJson(request, maxBytes = 24000) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('invalid_content_type');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_body');
  let size = 0; const parts = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('input_too_large'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
    return body;
  } finally { reader.releaseLock(); }
}

async function authorizeAdmin(request, env) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id || !email) return null;
  let config = await configRow(env.DB);
  if (config?.admin_user_id) return config.admin_user_id === id ? { id, config } : null;
  // Bootstrap only the configured Site owner's platform-authenticated account;
  // after binding, the Site-scoped stable ID is the authorization identity.
  if (!env.LIUBAI_BOOTSTRAP_EMAIL || email.toLowerCase() !== env.LIUBAI_BOOTSTRAP_EMAIL.toLowerCase()) return null;
  await env.DB.prepare("INSERT INTO pilot_config (id, admin_user_id, enabled, revision) VALUES ('main', ?, 0, 0) ON CONFLICT(id) DO NOTHING").bind(id).run();
  await env.DB.prepare("UPDATE pilot_config SET admin_user_id = ? WHERE id = 'main' AND admin_user_id IS NULL").bind(id).run();
  config = await configRow(env.DB);
  return config?.admin_user_id === id ? { id, config } : null;
}

export async function handleApi(request, env, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  try {
    if (!env.DB) return fallback('service_unconfigured', 503);
    const url = new URL(request.url), path = url.pathname;
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) return fallback('method_not_allowed', 405);
    if (request.method !== 'GET' && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) return fallback('origin_rejected', 403);
    if (path.startsWith('/api/admin/')) {
      const admin = await authorizeAdmin(request, env);
      if (!admin) return fallback('admin_required', 403);
      if (path === '/api/admin/status' && request.method === 'GET') {
        const stats = await createLedger(env.DB).stats();
        return response({ configured: isConfigured(admin.config, env), enabled: !!admin.config.enabled, configVersion: configVersion(admin.config), ...stats,
          provider: 'DeepSeek', model: 'deepseek-flash', budgetCny: 1, reservePerCallCny: 0.05, priceValidUntil: new Date(PRICE_VALID_UNTIL).toISOString(), expired: now() >= PRICE_VALID_UNTIL });
      }
      if (path === '/api/admin/config' && request.method === 'POST') {
        const body = await readJson(request, 5000);
        if (typeof body.enabled !== 'boolean' || typeof body.apiKey !== 'string' || typeof body.inviteCode !== 'string') return fallback('invalid_config');
        const apiKey = body.apiKey.trim(), inviteCode = body.inviteCode.trim();
        if (apiKey && !/^[\x21-\x7E]{16,256}$/.test(apiKey)) return fallback('invalid_key');
        if (inviteCode && !/^[a-zA-Z0-9-]{8,64}$/.test(inviteCode)) return fallback('invalid_invite');
        if (!env.LIUBAI_SECRET_KEY) return fallback('secret_unconfigured', 503);
        const encrypted = apiKey ? await encryptKey(apiKey, env.LIUBAI_SECRET_KEY) : { encrypted_key: admin.config.encrypted_key, iv: admin.config.iv };
        const inviteHash = inviteCode ? await digest(`liubai-invite:${inviteCode}`) : admin.config.invite_hash;
        if (body.enabled && (!encrypted.encrypted_key || !inviteHash || now() >= PRICE_VALID_UNTIL)) return fallback('activation_unavailable');
        await env.DB.prepare("UPDATE pilot_config SET encrypted_key = ?, iv = ?, invite_hash = ?, enabled = ?, revision = revision + 1 WHERE id = 'main' AND admin_user_id = ?")
          .bind(encrypted.encrypted_key ?? null, encrypted.iv ?? null, inviteHash ?? null, body.enabled ? 1 : 0, admin.id).run();
        return response({ saved: true, message: '已保存配置；尚不代表已通过真实模型验证。' });
      }
      if (path === '/api/admin/config' && request.method === 'DELETE') {
        await env.DB.prepare("UPDATE pilot_config SET encrypted_key = NULL, iv = NULL, invite_hash = NULL, enabled = 0, revision = revision + 1 WHERE id = 'main' AND admin_user_id = ?").bind(admin.id).run();
        return response({ deleted: true });
      }
      return fallback('not_found', 404);
    }
    if (path === '/api/ai/status' && request.method === 'GET') {
      const config = await configRow(env.DB), stats = await createLedger(env.DB).stats();
      const enabled = !!config?.enabled && isConfigured(config, env) && stats.remainingCalls > 0 && now() < PRICE_VALID_UNTIL;
      return response({ enabled, provider: 'DeepSeek', model: 'deepseek-flash', configVersion: configVersion(config), consentVersion: CONSENT_VERSION,
        remainingCalls: stats.remainingCalls, inviteRequired: true, reason: enabled ? null : now() >= PRICE_VALID_UNTIL ? 'pricing_expired' : stats.remainingCalls <= 0 ? 'budget_exhausted' : 'not_configured' });
    }
    if (path !== '/api/ai/generate' || request.method !== 'POST') return fallback('not_found', 404);
    const body = await readJson(request);
    const config = await configRow(env.DB);
    if (!config?.enabled || !isConfigured(config, env)) return fallback('not_configured', 503);
    if (now() >= PRICE_VALID_UNTIL) return fallback('pricing_expired', 503);
    if (body.configVersion !== configVersion(config) || body.consentVersion !== CONSENT_VERSION) return fallback('consent_changed', 409);
    if (typeof body.inviteCode !== 'string' || body.inviteCode.length > 64 || await digest(`liubai-invite:${body.inviteCode.trim()}`) !== config.invite_hash) return fallback('invite_required', 403);
    if (!validId(body.requestId) || !validId(body.session?.id) || !['reflect', 'review'].includes(body.stage) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.allowNextStep !== 'boolean') return fallback('invalid_request');
    let context, requestData;
    try {
      context = buildContext({ session: body.session, revision: body.revision, stage: body.stage, questionsAsked: body.session.turns?.length ?? 0, allowNextStep: body.allowNextStep });
      requestData = buildModelRequest(context, DEEPSEEK_PROFILE);
      prepareDeepseekRequest(requestData);
    } catch { return fallback('input_too_large_or_invalid'); }
    if (request.signal.aborted) return fallback('inactive', 409);
    const apiKey = await decryptKey(config, env.LIUBAI_SECRET_KEY);
    const ledger = createLedger(env.DB);
    const reservation = await ledger.reserve({ requestId: body.requestId, sessionId: body.session.id,
      digest: await digest(JSON.stringify({ context, version: body.configVersion })), configVersion: body.configVersion, now: now() });
    if (!reservation.ok) return fallback(reservation.reason, 429);
    let usage = null, result;
    try {
      result = await runCandidate({ context,
        adapter: createDeepseekAdapter({ apiKey, fetchImpl, onUsage: value => { usage = value; } }),
        signal: request.signal, isCurrent: () => !request.signal.aborted, timeoutMs: 45000 });
    } catch { result = { status: 'fallback', reason: 'generation_failed', candidate: null }; }
    // Already dispatched inference may be billed even after cancellation.
    await ledger.finish(body.requestId, { outcome: result.status, usage, now: now() });
    if (usage && (usage.promptTokens > 13000 || usage.completionTokens > 1000 || usage.promptTokens * 2 + usage.completionTokens * 8 > 50000)) {
      await env.DB.prepare("UPDATE pilot_config SET enabled = 0, revision = revision + 1 WHERE id = 'main'").run();
    }
    const latest = await configRow(env.DB);
    if (!latest?.enabled || configVersion(latest) !== body.configVersion) return fallback('config_changed', 409);
    return response({ ...result, requestId: body.requestId, revision: body.revision });
  } catch (error) {
    if (['input_too_large', 'invalid_content_type', 'invalid_body'].includes(error?.message) || error instanceof SyntaxError) return fallback('invalid_body', 400);
    return fallback('service_unavailable', 503);
  }
}
