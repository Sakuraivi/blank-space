export const CLARITY_SLOW_AFTER_MS = 10000;
export const CLARITY_WAIT_TIMEOUT_MS = 60000;

export class ClarityWaitError extends Error {
  constructor(reason) { super(reason); this.name = 'ClarityWaitError'; this.reason = reason; }
}

// Bound the complete request, including reading the response body. Aborting
// fetch alone is insufficient when a transport or response body ignores abort.
export async function waitForClarityRequest(run, {
  controller = new AbortController(), onSlow, slowMs = CLARITY_SLOW_AFTER_MS,
  timeoutMs = CLARITY_WAIT_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const { signal } = controller;
  if (signal.aborted) throw new ClarityWaitError('inactive');
  let deadlineReached = false, slowTimer, timeoutTimer, rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new ClarityWaitError(deadlineReached ? 'timeout' : 'inactive'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (onSlow && slowMs > 0 && slowMs < timeoutMs) {
      slowTimer = setTimer(() => { if (!signal.aborted) { try { onSlow(); } catch {} } }, slowMs);
    }
    timeoutTimer = setTimer(() => { deadlineReached = true; controller.abort(); }, timeoutMs);
    const work = Promise.resolve().then(() => {
      if (signal.aborted) throw new ClarityWaitError('inactive');
      return run(signal);
    });
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimer(slowTimer); clearTimer(timeoutTimer);
    signal.removeEventListener('abort', onAbort);
  }
}
