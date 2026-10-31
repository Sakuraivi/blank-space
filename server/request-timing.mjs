// Operational durations only. Never accept names, descriptions, or arbitrary
// metadata from a request or provider in the Server-Timing header or logs.
const FIELDS = ['prepareMs', 'modelMs', 'finalizeMs', 'totalMs'];
const MAX_TIMING_MS = 600000;

export function sanitizedRequestTimings(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = {};
    for (const field of FIELDS) {
      const duration = value[field];
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > MAX_TIMING_MS) return undefined;
      result[field] = Math.round(duration * 10) / 10;
    }
    return result;
  } catch { return undefined; }
}

export function serverTimingHeader(value) {
  const timings = sanitizedRequestTimings(value);
  return timings ? FIELDS.map(field => `${field.slice(0, -2)};dur=${timings[field]}`).join(', ') : '';
}

export function createRequestTiming(clock = () => performance.now()) {
  let failed = false, previous = 0;
  const read = () => {
    try {
      const current = clock();
      if (typeof current !== 'number' || !Number.isFinite(current) || current < previous) failed = true;
      previous = current;
      return current;
    } catch { failed = true; return 0; }
  };
  const started = read();
  let modelStarted, modelEnded;
  return Object.freeze({
    startModel() { modelStarted ??= read(); },
    endModel() { modelEnded ??= read(); },
    finish() {
      const finished = read();
      if (failed) return undefined;
      return sanitizedRequestTimings({
        prepareMs: (modelStarted ?? finished) - started,
        modelMs: modelStarted === undefined ? 0 : (modelEnded ?? finished) - modelStarted,
        finalizeMs: modelEnded === undefined ? 0 : finished - modelEnded,
        totalMs: finished - started,
      });
    },
  });
}
