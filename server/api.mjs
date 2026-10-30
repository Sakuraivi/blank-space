import { buildContext, buildModelRequest } from '../ai/contract.mjs';
import { runCandidate } from '../ai/runtime.mjs';
import { getRoute, publicProviders, PRICE_VALID_UNTIL } from '../ai/providers.mjs';
import { createProviderAdapter, prepareProviderRequest } from '../ai/provider-transport.mjs';
import { createLedger } from '../ai/ledger.mjs';
import { encryptKey, decryptKey, digest } from './secrets.mjs';
import { recordAiResult } from './diagnostics.mjs';

export const CONSENT_VERSION = 'multi-provider-v1';
// Version the public routing/consent contract, never a credential or its hash.
export const PUBLIC_CONFIG_VERSION = 'multi-v1';
export { PRICE_VALID_UNTIL };
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const fallback = (reason, status = 400) => response({ status: 'fallback', reason }, status);
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(x);
const configVersion = c => `deepseek-${c?.revision ?? 0}`;
const configRow = db => db.prepare("SELECT * FROM pilot_config WHERE id = 'main'").first();
const isConfigured = (c, env) => !!(c?.encrypted_key && c?.iv && c?.invite_hash && env.LIUBAI_SECRET_KEY);
const validKey = value => typeof value === 'string' && /^[\x21-\x7E]{16,256}$/.test(value);
const unsafeUsage = (usage, route) => !!usage && (usage.promptTokens > route.maxPromptTokens || usage.completionTokens > route.maxOutputTokens || usage.promptTokens * route.inputRateCnyPerMillion + usage.completionTokens * route.outputRateCnyPerMillion > route.reserveMicros);
const SAFE_PROVIDER_REASONS = new Set(['provider_auth_failed', 'provider_balance_low', 'provider_rate_limited', 'provider_access_denied', 'provider_model_unavailable', 'provider_request_rejected', 'provider_unavailable', 'provider_redirect_rejected', 'provider_response_failed', 'response_too_large', 'invalid_response', 'usage_out_of_bounds', 'incomplete_response']);

const publicProfile = route => route ? { providerId: route.providerId, modelId: route.modelId, providerLabel: route.providerLabel, modelLabel: route.modelLabel } : null;

function defaultSource(config, env) {
  const providerId = typeof env.LIUBAI_DEFAULT_PROVIDER === 'string' && env.LIUBAI_DEFAULT_PROVIDER.trim() ? env.LIUBAI_DEFAULT_PROVIDER.trim() : 'deepseek';
  const provider = publicProviders().find(p => p.id === providerId);
  if (!provider) return null;
  const modelId = typeof env.LIUBAI_DEFAULT_MODEL === 'string' && env.LIUBAI_DEFAULT_MODEL.trim() ? env.LIUBAI_DEFAULT_MODEL.trim() : provider.defaultModelId;
  const route = getRoute(providerId, modelId);
  if (!route) return null;
  const value = env[`LIUBAI_DEFAULT_${providerId.toUpperCase()}_KEY`];
  const key = typeof value === 'string' ? value.trim() : '';
  // A configured but malformed environment key must not silently select a different payer.
  if (key) return validKey(key) ? { type: 'environment', key, route } : null;
  if (providerId === 'deepseek' && config?.enabled && config.encrypted_key && config.iv && env.LIUBAI_SECRET_KEY) {
    return { type: 'legacy', encrypted_key: config.encrypted_key, iv: config.iv, route };
  }
  return null;
}

function sameSource(a, b) {
  return !!a && !!b && a.type === b.type && a.route.providerId === b.route.providerId && a.route.modelId === b.route.modelId && (a.type === 'environment' ? a.key === b.key : a.encrypted_key === b.encrypted_key && a.iv === b.iv);
}

async function safetyStopped(db) {
  // outcome=error persists an unsafe usage report even when its numbers exceed
  // the ledger's storage bounds. Environment keys and BYOK cannot reset it.
  return !!await db.prepare(`SELECT 1 AS stopped FROM pilot_requests
    WHERE outcome = 'error' OR (price_version IS NULL AND source_mode = 'default' AND
      (prompt_tokens > 13000 OR completion_tokens > 1000
      OR prompt_tokens * 2 + completion_tokens * 8 > 50000)) LIMIT 1`).first();
}

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
      const source = defaultSource(config, env), defaultAvailable = !!source;
      const reason = now() >= PRICE_VALID_UNTIL ? 'pricing_expired' : await safetyStopped(env.DB) ? 'usage_out_of_bounds' : null;
      const defaultReason = reason || (!source ? 'default_unavailable' : stats.remainingCalls <= 0 || stats.remainingBudgetMicros < source.route.reserveMicros ? 'budget_exhausted' : null);
      return response({ enabled: reason === null, configVersion: PUBLIC_CONFIG_VERSION, consentVersion: CONSENT_VERSION,
        providers: publicProviders(), defaultProfile: publicProfile(source?.route), personalKeySupported: true, defaultAvailable,
        defaultEnabled: defaultReason === null, defaultReason, remainingCalls: stats.remainingCalls,
        remainingBudgetCny: stats.remainingBudgetMicros / 1000000, inviteRequired: false, reason });
    }
    if (path !== '/api/ai/generate' || request.method !== 'POST') return fallback('not_found', 404);
    const body = await readJson(request);
    if (now() >= PRICE_VALID_UNTIL) return fallback('pricing_expired', 503);
    if (await safetyStopped(env.DB)) return fallback('usage_out_of_bounds', 503);
    if (body.configVersion !== PUBLIC_CONFIG_VERSION || body.consentVersion !== CONSENT_VERSION) return fallback('consent_changed', 409);
    if (!['default', 'personal'].includes(body.sourceMode)) return fallback('invalid_source');
    if (['baseUrl', 'endpoint', 'apiUrl'].some(key => body[key] !== undefined)) return fallback('invalid_request');
    if (!publicProviders().some(p => p.id === body.providerId)) return fallback('unsupported_provider');
    const route = getRoute(body.providerId, body.modelId);
    if (!route) return fallback('unsupported_model');
    if (body.personalApiKey !== undefined && typeof body.personalApiKey !== 'string') return fallback('invalid_personal_key');
    const personalApiKey = body.personalApiKey?.trim() ?? '';
    if (body.sourceMode === 'personal' && !personalApiKey) return fallback('missing_personal_key');
    if (body.sourceMode === 'personal' && !validKey(personalApiKey)) return fallback('invalid_personal_key');
    if (body.sourceMode === 'default' && personalApiKey) return fallback('invalid_source');
    const source = body.sourceMode === 'personal' ? null : defaultSource(await configRow(env.DB), env);
    if (body.sourceMode === 'default' && !source) return fallback('default_unavailable', 503);
    if (source && (source.route.providerId !== route.providerId || source.route.modelId !== route.modelId)) return fallback('consent_changed', 409);
    if (!validId(body.requestId) || !validId(body.session?.id) || !['reflect', 'review'].includes(body.stage) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.allowNextStep !== 'boolean') return fallback('invalid_request');
    let context, requestData;
    try {
      context = buildContext({ session: body.session, revision: body.revision, stage: body.stage, questionsAsked: body.session.turns?.length ?? 0, allowNextStep: body.allowNextStep });
      requestData = buildModelRequest(context, route.profile);
      prepareProviderRequest(requestData, route);
    } catch { return fallback('input_too_large_or_invalid'); }
    if (request.signal.aborted) return fallback('inactive', 409);
    const apiKey = personalApiKey || (source.type === 'environment' ? source.key : await decryptKey(source, env.LIUBAI_SECRET_KEY));
    if (!validKey(apiKey)) return fallback('default_unavailable', 503);
    const ledger = createLedger(env.DB);
    const responseRoute = { sourceMode: body.sourceMode, providerId: route.providerId, modelId: route.modelId };
    const reservation = await ledger.reserve({ requestId: body.requestId, sessionId: body.session.id,
      digest: await digest(JSON.stringify({ context, version: body.configVersion, route: responseRoute })), configVersion: body.configVersion,
      sourceMode: body.sourceMode, providerId: route.providerId, modelId: route.modelId, priceVersion: route.priceVersion,
      reservedMicros: body.sourceMode === 'default' ? route.reserveMicros : 0, now: now() });
    if (!reservation.ok) return fallback(reservation.reason, 429);
    let usage = null, result, providerReason = null;
    try {
      const transport = createProviderAdapter({ route, apiKey, fetchImpl, onUsage: value => { usage = value; } });
      const adapter = { profile: transport.profile, async generate(...args) {
        const response = await transport.generate(...args);
        if (response.status === 'failed' && SAFE_PROVIDER_REASONS.has(response.reason)) providerReason = response.reason;
        return response;
      } };
      result = await runCandidate({ context,
        adapter,
        signal: request.signal, isCurrent: () => !request.signal.aborted, timeoutMs: 45000 });
      if (result.status === 'fallback' && result.reason === 'incomplete_response' && providerReason) result = { ...result, reason: providerReason };
    } catch { result = { status: 'fallback', reason: 'generation_failed', candidate: null }; }
    // Already dispatched inference may be billed even after cancellation.
    await ledger.finish(body.requestId, { outcome: unsafeUsage(usage, route) || result.reason === 'usage_out_of_bounds' ? 'error' : result.status, usage, now: now() });
    if (await safetyStopped(env.DB)) {
      recordAiResult({ requestId: body.requestId, stage: body.stage, status: 'fallback', reason: 'usage_out_of_bounds', ...responseRoute });
      return fallback('usage_out_of_bounds', 503);
    }
    if (!personalApiKey && !sameSource(source, defaultSource(await configRow(env.DB), env))) {
      recordAiResult({ requestId: body.requestId, stage: body.stage, status: 'fallback', reason: 'config_changed', ...responseRoute });
      return fallback('config_changed', 409);
    }
    recordAiResult({ requestId: body.requestId, stage: body.stage, status: result.status, reason: result.reason, ...responseRoute });
    return response({ ...result, requestId: body.requestId, revision: body.revision, route: responseRoute });
  } catch (error) {
    if (['input_too_large', 'invalid_content_type', 'invalid_body'].includes(error?.message) || error instanceof SyntaxError) return fallback('invalid_body', 400);
    return fallback('service_unavailable', 503);
  }
}
