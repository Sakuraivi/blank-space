import { buildModelRequest, validateCandidate } from './contract.mjs';
import { isClaimValidationDetail } from '../public/clarity-contract.mjs';

// No network, credential, rendering or persistence ownership in this module.
// Adapter supplies transport. Caller owns revision and lifecycle checks.
export async function runCandidate({ context, adapter, signal, isCurrent, timeoutMs = 15000, contract = { buildModelRequest, validateCandidate }, onValidationFailure }) {
  if (typeof isCurrent !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid_runtime_options');
  const snapshot = structuredClone(context);
  const request = contract.buildModelRequest(snapshot, adapter?.profile);
  if (typeof adapter?.generate !== 'function') throw new TypeError('invalid_adapter');
  const current = () => {
    if (signal?.aborted) return false;
    try {
      const active = isCurrent(structuredClone(snapshot));
      // Async/throwing lifecycle checks are caller bugs; fail closed.
      if (active && typeof active.then === 'function') Promise.resolve(active).catch(() => {});
      return active === true;
    } catch { return false; }
  };
  if (!current()) return { status: 'discarded', reason: 'inactive', candidate: null };
  const controller = new AbortController();
  let timer, abortHandler;
  const interrupted = new Promise(resolve => {
    abortHandler = () => { controller.abort(); resolve({ type: 'aborted' }); };
    signal?.addEventListener('abort', abortHandler, { once: true });
    timer = setTimeout(() => { controller.abort(); resolve({ type: 'timeout' }); }, timeoutMs);
  });
  try {
    const generation = Promise.resolve().then(() => {
      if (controller.signal.aborted) return { type: 'aborted' };
      return adapter.generate(request, { signal: controller.signal });
    }).then(value => ({ type: 'response', value }), () => ({ type: 'error' }));
    const result = await Promise.race([generation, interrupted]);
    if (!current() || result.type === 'aborted') return { status: 'discarded', reason: 'inactive', candidate: null };
    if (result.type !== 'response') return { status: 'fallback', reason: result.type, candidate: null };
    if (result.value?.status !== 'completed') return { status: 'fallback', reason: 'incomplete_response', candidate: null };
    const checked = contract.validateCandidate(result.value.output, snapshot);
    if (!checked.ok) {
      if (checked.reason === 'invalid_claim' && isClaimValidationDetail(checked.detail) && typeof onValidationFailure === 'function') {
        // A diagnostic sink cannot replace the result, delay it, or trigger a
        // second generation. Never pass the candidate or arbitrary detail.
        try {
          const notified = onValidationFailure(checked.detail);
          if (notified && typeof notified.then === 'function') Promise.resolve(notified).catch(() => {});
        } catch {}
      }
      return { status: 'fallback', reason: checked.reason, candidate: null };
    }
    return { status: 'candidate', candidate: checked.candidate, policyVersion: request.policyVersion, schemaVersion: request.schemaVersion };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortHandler);
    controller.abort();
  }
}
