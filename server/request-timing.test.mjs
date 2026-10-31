import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestTiming, sanitizedRequestTimings, serverTimingHeader } from './request-timing.mjs';

test('request stages measure monotonic intervals and emit fixed duration names', () => {
  const values = [100, 102, 205, 210];
  const timing = createRequestTiming(() => values.shift());
  timing.startModel(); timing.endModel();
  const result = timing.finish();
  assert.deepEqual(result, { prepareMs: 2, modelMs: 103, finalizeMs: 5, totalMs: 110 });
  assert.equal(serverTimingHeader(result), 'prepare;dur=2, model;dur=103, finalize;dur=5, total;dur=110');
});

test('diagnostics omit invalid clocks without throwing or falling back to wall time', () => {
  for (const broken of [() => { throw Error('private clock failure'); }, () => NaN, () => Infinity, () => '123']) {
    const timing = createRequestTiming(broken);
    assert.doesNotThrow(() => { timing.startModel(); timing.endModel(); });
    assert.equal(timing.finish(), undefined);
  }
  const backwards = [100, 99, 103, 104];
  const timing = createRequestTiming(() => backwards.shift());
  timing.startModel(); timing.endModel();
  assert.equal(timing.finish(), undefined);
});

test('timing fields reject nonfinite, negative, unbounded, missing and private values', () => {
  const valid = { prepareMs: 1.236, modelMs: 100, finalizeMs: 0, totalMs: 101.236, PRIVATE: 'fake-secret' };
  assert.deepEqual(sanitizedRequestTimings(valid), { prepareMs: 1.2, modelMs: 100, finalizeMs: 0, totalMs: 101.2 });
  assert.doesNotMatch(serverTimingHeader(valid), /PRIVATE|secret/);
  for (const value of [NaN, Infinity, -1, 600001, 'fake-secret', null, undefined]) {
    assert.equal(sanitizedRequestTimings({ ...valid, modelMs: value }), undefined);
    assert.equal(serverTimingHeader({ ...valid, modelMs: value }), '');
  }
  assert.equal(sanitizedRequestTimings({ prepareMs: 1 }), undefined);
  assert.equal(serverTimingHeader({ get prepareMs() { throw Error('fake-secret'); } }), '');
});
