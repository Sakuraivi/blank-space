import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandaloneWorker } from './standalone-worker.mjs';

const identity = { 'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': 'fake@example.test', 'oai-sites-authorization': 'forged-site-token' };
const request = (path, options) => new Request(`https://draft.example.test${path}`, options);
const env = changes => ({
  LIUBAI_DATA_MIGRATION_STATE: 'verified',
  DB: { prepare: () => ({ first: async () => ({ default_calls: 2, reserved_micros: 100000 }) }) },
  ...changes,
});

test('standalone rejects all legacy admin paths before any API dispatch, even with forged identity', async () => {
  let calls = 0;
  const worker = createStandaloneWorker({ handleApiImpl() { calls++; throw Error('must not dispatch'); } });
  for (const path of ['/api/admin', '/api/admin/', '/api/admin/status', '/api/admin/config']) {
    const result = await worker.fetch(request(path, { headers: identity }), env());
    assert.equal(result.status, 404);
  }
  assert.equal(calls, 0);
});

test('standalone has no Sites OAuth endpoints and legacy UI routes only redirect to public settings', async () => {
  const worker = createStandaloneWorker();
  for (const path of ['/signin-with-chatgpt', '/signout-with-chatgpt/', '/callback']) {
    assert.equal((await worker.fetch(request(path), {})).status, 404);
  }
  const redirect = await worker.fetch(request('/admin'), {});
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('Location'), 'https://draft.example.test/?settings=ai');
});

test('pending migration or missing D1 fails closed before any inference path', async () => {
  let calls = 0;
  const worker = createStandaloneWorker({ handleApiImpl() { calls++; } });
  for (const configuration of [env({ LIUBAI_DATA_MIGRATION_STATE: 'pending' }), env({ DB: undefined }), {}]) {
    const response = await worker.fetch(request('/api/ai/generate', { method: 'POST' }), configuration);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, 'service_unconfigured');
  }
  assert.equal(calls, 0);
});

test('an empty or partially imported database cannot reset the existing shared budget', async () => {
  let calls = 0;
  const worker = createStandaloneWorker({ handleApiImpl() { calls++; } });
  for (const row of [{ default_calls: 0, reserved_micros: 0 }, { default_calls: 2, reserved_micros: 50000 }, { default_calls: 1, reserved_micros: 100000 }, { default_calls: 2, reserved_micros: 'broken' }]) {
    const configuration = env({ DB: { prepare: () => ({ first: async () => row }) } });
    assert.equal((await worker.fetch(request('/api/ai/status'), configuration)).status, 503);
  }
  assert.equal(calls, 0);
});

test('verified data dispatches public API with original body/origin but without platform identity', async () => {
  let observed;
  const worker = createStandaloneWorker({ handleApiImpl: async r => { observed = r; return Response.json({ ok: true }); } });
  const original = request('/api/ai/generate', { method: 'POST', headers: { ...identity, origin: 'https://draft.example.test', 'content-type': 'application/json' }, body: '{"synthetic":true}' });
  assert.equal((await worker.fetch(original, env())).status, 200);
  assert.equal(observed.headers.get('origin'), 'https://draft.example.test');
  assert.equal(await observed.text(), '{"synthetic":true}');
  for (const name of Object.keys(identity)) assert.equal(observed.headers.get(name), null);
  assert.equal(original.headers.get('oai-authenticated-user-id'), 'forged-owner');
});

test('static frontend remains usable before migration, without an external fallback origin', async () => {
  let observed;
  const worker = createStandaloneWorker();
  const response = await worker.fetch(request('/', { headers: identity }), { ASSETS: { fetch: async r => { observed = r; return new Response('<main>synthetic local asset</main>', { headers: { 'Content-Type': 'text/html' } }); } } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /synthetic local asset/);
  for (const name of Object.keys(identity)) assert.equal(observed.headers.get(name), null);
  assert.equal((await worker.fetch(request('/', { method: 'POST' }), {})).status, 405);
});
