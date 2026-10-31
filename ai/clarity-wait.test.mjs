import test from 'node:test';
import assert from 'node:assert/strict';
import { ClarityWaitError, waitForClarityRequest } from '../public/clarity-wait.mjs';
import { c01Candidate } from './fixtures/clarity-c01.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock() {
  let now = 0, next = 0; const jobs = new Map();
  return {
    setTimer(fn, delay) { const id = ++next; jobs.set(id, { fn, at: now + delay }); return id; },
    clearTimer(id) { jobs.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        jobs.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
    get size() { return jobs.size; },
  };
}

test('a completed request clears both clocks and never produces a slow notice later', async () => {
  const time = clock(), body = deferred(); let calls = 0, slow = 0;
  const pending = waitForClarityRequest(() => { calls++; return body.promise; }, { ...time, onSlow: () => slow++ });
  await flush(); time.advance(9999); assert.equal(slow, 0);
  body.resolve({ ready: true }); assert.deepEqual(await pending, { ready: true });
  time.advance(100000); assert.equal(slow, 0); assert.equal(calls, 1); assert.equal(time.size, 0);
});

test('the deadline also bounds a hung response body that ignores abort', async () => {
  const time = clock(), controller = new AbortController(), body = deferred(); let slow = 0, headersRead = false;
  const pending = waitForClarityRequest(async () => { headersRead = true; return body.promise; }, { ...time, controller, onSlow: () => slow++ });
  const rejected = assert.rejects(pending, error => error instanceof ClarityWaitError && error.reason === 'timeout');
  await flush(); assert.equal(headersRead, true);
  time.advance(9999); assert.equal(slow, 0); time.advance(1); assert.equal(slow, 1);
  time.advance(50000); await rejected; assert.equal(controller.signal.aborted, true); assert.equal(time.size, 0);
  body.resolve({ late: true }); await flush(); assert.equal(slow, 1);
});

test('manual abort settles immediately and clears notices even if work ignores the signal', async () => {
  const time = clock(), controller = new AbortController(); let slow = 0;
  const pending = waitForClarityRequest(() => new Promise(() => {}), { ...time, controller, onSlow: () => slow++ });
  const rejected = assert.rejects(pending, error => error instanceof ClarityWaitError && error.reason === 'inactive');
  await flush(); controller.abort(); await rejected;
  assert.equal(time.size, 0); time.advance(100000); assert.equal(slow, 0);
  let called = false;
  await assert.rejects(waitForClarityRequest(() => { called = true; }, { ...time, controller }), /inactive/);
  assert.equal(called, false); assert.equal(time.size, 0);
});

// Execute the actual front-end module against a minimal DOM and a fake network.
// This verifies event/request wiring, not browser rendering, focus or storage.
const publicStatus = {
  configVersion: 'multi-flex-v1', consentVersion: 'multi-provider-v1', enabled: true,
  defaultAvailable: true, defaultEnabled: true, personalKeySupported: true,
  defaultProfile: { providerId: 'deepseek', modelId: 'deepseek-chat', defaultRevision: 1 },
  providers: [{ id: 'deepseek', label: 'Test service', defaultModelId: 'deepseek-chat', models: [{ id: 'deepseek-chat', label: 'Test model' }] }],
};
let moduleVersion = 0;
async function appHarness(t, { statusBody } = {}) {
  const time = clock(), listeners = new Map(), calls = [], statusCalls = [], waitNode = { textContent: '' };
  let html = '', renders = 0, focusCalls = 0;
  const main = {
    set innerHTML(value) { html = value; renders++; waitNode.textContent = /data-wait-status>([^<]*)/.exec(value)?.[1] ?? ''; },
    get innerHTML() { return html; }, focus() { focusCalls++; }, replaceChildren() { html = ''; },
  };
  const modal = { open: false, dataset: {}, addEventListener() {}, close() { this.open = false; }, showModal() { this.open = true; } };
  const nodes = { '#main': main, '#modal': modal, '#modal-body': { innerHTML: '', replaceChildren() {} }, '#modal-title': { textContent: '' }, '#notice': { textContent: '' } };
  const replacements = {
    setTimeout: time.setTimer, clearTimeout: time.clearTimer,
    location: new URL('https://example.test/clarity'),
    window: { addEventListener() {}, scrollTo() {} },
    document: {
      querySelector(selector) { return selector === '[data-wait-status]' ? html.includes('data-wait-status') ? waitNode : null : nodes[selector] ?? null; },
      querySelectorAll() { return []; }, activeElement: null,
      addEventListener(type, listener) { listeners.set(type, listener); },
    },
    fetch: async (url, options) => {
      if (url === '/api/ai/status') { statusCalls.push(options); return { json: () => statusBody ? statusBody() : Promise.resolve(publicStatus) }; }
      assert.equal(url, '/api/ai/generate');
      const body = deferred(), payload = JSON.parse(options.body);
      calls.push({ payload, signal: options.signal, body });
      return { json: () => body.promise };
    },
  };
  const before = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  await import(`../public/clarity-app.mjs?wait-test=${++moduleVersion}`); await flush();
  return {
    time, calls, statusCalls, main, waitNode, get renders() { return renders; }, get focusCalls() { return focusCalls; },
    submit(text) {
      listeners.get('input')({ target: { id: 'expression', value: text } });
      return listeners.get('submit')({ preventDefault() {}, target: { id: 'expression-form' } });
    },
    click(action) { return listeners.get('click')({ target: { closest: () => ({ dataset: { action } }) } }); },
  };
}

function candidateEnvelope(call) {
  const p = call.payload;
  const context = { ...p.session, stage: p.stage, revision: p.revision, allowNextStep: p.allowNextStep };
  return { flow: 'clarity-v2', requestId: p.requestId, revision: p.revision, status: 'candidate',
    route: { sourceMode: p.sourceMode, providerId: p.providerId, modelId: p.modelId, defaultRevision: p.defaultRevision }, candidate: c01Candidate(context) };
}

test('the app shows waiting immediately, updates only the status after 10s, and preserves input at 60s', async t => {
  const app = await appHarness(t), input = '我专门空出了周六，朋友却临时取消了见面。';
  const submitted = app.submit(input); await flush();
  assert.equal(app.calls.length, 1); assert.match(app.main.innerHTML, /正在等待回复/); assert.match(app.main.innerHTML, /我专门空出了周六/);
  const renders = app.renders, focused = app.focusCalls;
  app.time.advance(10000); assert.match(app.waitNode.textContent, /回复有些慢/);
  assert.equal(app.renders, renders); assert.equal(app.focusCalls, focused);
  app.time.advance(50000); await submitted;
  assert.equal(app.calls[0].signal.aborted, true); assert.match(app.main.innerHTML, /已停止等待/);
  assert.match(app.main.innerHTML, /我专门空出了周六/); assert.match(app.main.innerHTML, /data-action="retry"/);
  assert.doesNotMatch(app.main.innerHTML, /data-wait-status/); assert.equal(app.calls.length, 1); assert.equal(app.time.size, 0);
  const html = app.main.innerHTML; app.calls[0].body.resolve(candidateEnvelope(app.calls[0])); await flush();
  assert.equal(app.main.innerHTML, html); assert.equal(app.calls.length, 1);
});

test('cancel then explicit retry isolates old replies and timers from the new request', async t => {
  const app = await appHarness(t);
  const first = app.submit('我空出了两个周六，朋友都临时取消了约定。'); await flush();
  await app.click('cancel'); await first; assert.equal(app.time.size, 0);
  const retry = app.click('retry'); await flush(); assert.equal(app.calls.length, 2);
  const renders = app.renders, focused = app.focusCalls;
  app.calls[0].body.resolve(candidateEnvelope(app.calls[0])); await flush();
  assert.equal(app.renders, renders); assert.equal(app.focusCalls, focused); assert.match(app.main.innerHTML, /data-wait-status/);
  app.time.advance(10000); assert.match(app.waitNode.textContent, /回复有些慢/);
  app.calls[1].body.resolve(candidateEnvelope(app.calls[1])); await retry;
  assert.doesNotMatch(app.main.innerHTML, /这次没有收到可用的回复/); assert.doesNotMatch(app.main.innerHTML, /data-wait-status/);
  const html = app.main.innerHTML; app.time.advance(100000);
  assert.equal(app.main.innerHTML, html); assert.equal(app.time.size, 0); assert.equal(app.calls.length, 2);
});

test('early local review cancels waiting and retains the original without accepting a late reply', async t => {
  const app = await appHarness(t), submitted = app.submit('我特意空出周六，朋友临时取消了。'); await flush();
  await app.click('review'); await submitted;
  assert.match(app.main.innerHTML, /确认并保存/); assert.match(app.main.innerHTML, /我特意空出周六/);
  const html = app.main.innerHTML; app.calls[0].body.resolve(candidateEnvelope(app.calls[0])); await flush(); app.time.advance(100000);
  assert.equal(app.main.innerHTML, html); assert.equal(app.time.size, 0); assert.equal(app.calls.length, 1);
});

test('a hanging initial status response stops disabling the entry after 10s', async t => {
  const app = await appHarness(t, { statusBody: () => new Promise(() => {}) });
  assert.match(app.main.innerHTML, /正在准备陪伴服务/);
  app.time.advance(10000); await flush();
  assert.doesNotMatch(app.main.innerHTML, /正在准备陪伴服务/); assert.match(app.main.innerHTML, /只记下来/);
  assert.equal(app.calls.length, 0); assert.equal(app.time.size, 0);
});

test('ending the conversation clears waiting without accepting late response into the new entry', async t => {
  const app = await appHarness(t), submitted = app.submit('朋友周六取消约定，我不太开心。'); await flush();
  await app.click('end'); await app.click('confirm'); await submitted;
  assert.match(app.main.innerHTML, /最近，/); assert.equal(app.calls[0].signal.aborted, true);
  const html = app.main.innerHTML; app.calls[0].body.resolve(candidateEnvelope(app.calls[0])); await flush(); app.time.advance(100000);
  assert.equal(app.main.innerHTML, html); assert.equal(app.time.size, 0); assert.equal(app.calls.length, 1);
});

test('opening locked settings while generating does not refresh or invalidate the current service', async t => {
  const app = await appHarness(t), submitted = app.submit('我空出了周六，朋友取消了约定。'); await flush();
  assert.equal(app.statusCalls.length, 1); await app.click('settings'); assert.equal(app.statusCalls.length, 1);
  assert.equal(app.calls[0].signal.aborted, false);
  app.calls[0].body.resolve(candidateEnvelope(app.calls[0])); await submitted;
  assert.doesNotMatch(app.main.innerHTML, /这次没有收到可用的回复|已失效/); assert.equal(app.time.size, 0);
});
