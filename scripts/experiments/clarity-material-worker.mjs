// Isolated edge-preview entry only. No production import, UI, auth or fallback.
// The fixed synthetic run expires after 20 minutes; the real request ledger
// protects each deterministic case requestId against repeated paid execution.
import { handleApi, PUBLIC_CONFIG_VERSION, CONSENT_VERSION } from '../../server/api.mjs';
import { prepareConcernMaterialRun } from '../../ai/experiments/clarity-materials.mjs';
import { getPersonalRoute } from '../../ai/providers.mjs';
import { prepareProviderRequest, MAX_RESPONSE_BYTES } from '../../ai/provider-transport.mjs';
import { wireSession } from '../../public/clarity-state.mjs';
import {
  createMaterialReviewCase, MATERIAL_LIVE_CASE_IDS, MATERIAL_LIVE_LABEL, MATERIAL_LIVE_ROUTE,
  MATERIAL_LIVE_TTL_MS, validMaterialRunId,
} from './clarity-material-fixtures.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const failure = (reason, status) => json({ synthetic: true, status: 'rejected', reason }, status);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const route = getPersonalRoute(MATERIAL_LIVE_ROUTE.providerId, MATERIAL_LIVE_ROUTE.modelId);
const EMPTY_BODY_TIMEOUT_MS = 250;
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
const knownUsage = usage => {
  if (!usage || typeof usage !== 'object') return null;
  return Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']
    .filter(key => tokenCount(usage[key])).map(key => [key, usage[key]]));
};

async function hasStrictlyEmptyBody(request) {
  if (request.signal.aborted) return false;
  if (request.body === null) return true;
  let reader, timer, abort;
  try {
    reader = request.body.getReader();
    const interrupted = new Promise(resolve => {
      abort = () => resolve({ interrupted: true });
      request.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, EMPTY_BODY_TIMEOUT_MS);
    });
    // A proxy can represent a bodyless POST as an already-closed stream. Read
    // only once: a non-final chunk (including an empty chunk) is not accepted.
    // Content-Length is deliberately not consulted and no bytes are retained.
    const first = reader.read().then(value => ({ value }), () => ({ interrupted: true }));
    const result = await Promise.race([first, interrupted]);
    return !request.signal.aborted && !result.interrupted && result.value?.done === true &&
      (result.value.value === undefined || result.value.value?.byteLength === 0);
  } catch { return false; }
  finally {
    clearTimeout(timer); if (abort) request.signal.removeEventListener('abort', abort);
    // A hostile/tee stream's cancel promise may never settle. Do not let it
    // delay rejection; reader.read already has an explicit rejection handler.
    if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

async function captureSuccessfulBody(response) {
  // Never capture provider error prose, headers or reasoning fields. Bound the
  // successful content capture independently of the adapter's body reader.
  if (!response.ok) return null;
  const copy = response.clone(), reader = copy.body?.getReader();
  if (!reader) return null;
  let bytes = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return null;
      chunks.push(value);
    }
    const all = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    return { choices: Array.isArray(value.choices) ? value.choices.map(choice => ({
      finish_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      message: { content: typeof choice?.message?.content === 'string' ? choice.message.content : null },
    })) : [], usage: knownUsage(value.usage) };
  } catch { return null; }
  // A cloned response is a tee. Awaiting its cancellation can wait for the
  // adapter's original branch, which cannot start until this function returns.
  finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function runWindow(env, now) {
  const runId = env.LIUBAI_MATERIAL_EVAL_RUN_ID, startedAt = Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT);
  if (!validMaterialRunId(runId) || !Number.isSafeInteger(startedAt) || startedAt <= 0) return null;
  const expiresAt = startedAt + MATERIAL_LIVE_TTL_MS;
  if (now < startedAt || now >= expiresAt) return null;
  return { runId, startedAt, expiresAt };
}

export function createMaterialEvaluationWorker({ handleApiImpl = handleApi, prepareRun = prepareConcernMaterialRun,
  fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return Object.freeze({ async fetch(request, env) {
    const url = new URL(request.url);
    if (url.search || url.hash || ['authorization', 'cookie', 'x-api-key', 'api-key'].some(key => request.headers.has(key)) ||
      !await hasStrictlyEmptyBody(request)) return failure('invalid_preview_request', 400);
    if (url.pathname === '/health' && request.method === 'GET') {
      const active = runWindow(env, now());
      return active ? json({ label: MATERIAL_LIVE_LABEL, ...active }) : failure('preview_expired_or_unconfigured', 410);
    }
    const caseId = url.pathname.startsWith('/evaluate/') ? url.pathname.slice('/evaluate/'.length) : null;
    if (request.method !== 'POST' || !MATERIAL_LIVE_CASE_IDS.includes(caseId)) return failure('not_found', 404);
    const active = runWindow(env, now());
    if (!active) return failure('preview_expired_or_unconfigured', 410);
    // Bind each attempt too: a hot reload between health and POST must not
    // dispatch a different run before the client notices the changed evidence.
    if (request.headers.get('X-Liubai-Evaluation-Run') !== active.runId) return failure('preview_run_mismatch', 409);
    if (env.LIUBAI_DATA_MIGRATION_STATE !== 'verified') return failure('migration_unverified', 503);
    const { session, ticket, context } = createMaterialReviewCase(caseId, active.runId);
    let transport = { dispatches: 0, request: null, response: null, httpStatus: null, elapsedMs: null };
    const current = () => !request.signal.aborted && runWindow(env, now())?.runId === active.runId;
    const internal = (path, options = {}) => new Request(new URL(path, url.origin), { ...options, signal: request.signal });
    try {
      // Only this internal same-origin request reaches the unmodified API guard.
      const preflightResponse = await handleApiImpl(internal('/api/ai/status'), env, { now });
      const status = await preflightResponse.json();
      if (preflightResponse.status !== 200 || !status.enabled || !status.defaultAvailable || status.defaultEnabled === false ||
        status.configVersion !== PUBLIC_CONFIG_VERSION || status.consentVersion !== CONSENT_VERSION ||
        status.defaultProfile?.providerId !== MATERIAL_LIVE_ROUTE.providerId || status.defaultProfile?.modelId !== MATERIAL_LIVE_ROUTE.modelId ||
        status.defaultProfile?.defaultRevision !== MATERIAL_LIVE_ROUTE.defaultRevision) return failure('default_route_mismatch', 409);
      if (!current()) return failure('inactive_preview', 409);
      const prepared = await prepareRun(context, route.profile);
      const expected = prepareProviderRequest(prepared.requestData, route);
      transport.request = JSON.parse(expected.body);
      const guardedFetch = async (endpoint, options) => {
        // Do not read, copy or serialize options.headers (they contain a Key).
        if (!current() || options?.signal?.aborted || endpoint !== route.endpoint || options?.method !== 'POST' ||
          options?.redirect !== 'manual' || options?.body !== expected.body || transport.dispatches !== 0) throw new Error('evaluation_transport_boundary');
        transport.dispatches = 1; const started = now();
        try {
          const response = await fetchImpl(endpoint, options);
          transport.httpStatus = response.status;
          transport.response = await captureSuccessfulBody(response);
          return response;
        } finally { transport.elapsedMs = Math.max(0, now() - started); }
      };
      const body = { flow: 'clarity-v2', ...MATERIAL_LIVE_ROUTE, configVersion: status.configVersion, consentVersion: status.consentVersion,
        requestId: ticket.requestId, revision: ticket.revision, stage: 'review', allowNextStep: false, session: wireSession(session) };
      const started = now();
      const apiResponse = await handleApiImpl(internal('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin }, body: JSON.stringify(body) }), env, {
        now, fetchImpl: guardedFetch,
        prepareClarityRun: async (actual, profile) => {
          if (!current() || !same(actual, context) || !same(profile, route.profile)) throw new Error('evaluation_context_boundary');
          return { requestData: prepared.requestData, run: options => prepared.run({ ...options,
            isCurrent: snapshot => current() && options.isCurrent(snapshot),
          }) };
        },
      });
      const apiResult = await apiResponse.json();
      return json({ synthetic: true, label: MATERIAL_LIVE_LABEL, kind: 'controlled_review_only', runId: active.runId, caseId,
        requestId: ticket.requestId, revision: ticket.revision, route: MATERIAL_LIVE_ROUTE, context,
        scope: '强制concern/review收尾，不代表自然场景路由、连续问答或真人体验。',
        transport, api: { httpStatus: apiResponse.status, elapsedMs: Math.max(0, now() - started), result: apiResult },
        semanticReview: 'pending_manual_review' });
    } catch { return json({ synthetic: true, label: MATERIAL_LIVE_LABEL, kind: 'controlled_review_only', runId: active.runId, caseId,
      requestId: ticket.requestId, revision: ticket.revision, route: MATERIAL_LIVE_ROUTE, context, transport,
      api: { httpStatus: null, result: { status: 'fallback', reason: 'evaluation_failed' } }, semanticReview: 'not_evaluated' }); }
  } });
}

export default createMaterialEvaluationWorker();
