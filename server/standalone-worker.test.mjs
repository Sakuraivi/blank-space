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

test('standalone has no Sites OAuth endpoints', async () => {
  const worker = createStandaloneWorker();
  for (const path of ['/signin-with-chatgpt', '/signout-with-chatgpt/', '/callback']) {
    assert.equal((await worker.fetch(request(path), {})).status, 404);
  }
});

test('organizer page serves the canonical asset for GET and HEAD with protective headers', async () => {
  const worker = createStandaloneWorker();
  const observed = [];
  const configuration = { ASSETS: { fetch: async r => {
    observed.push(r);
    return new Response('<main>Organizer sign-in</main>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=86400' } });
  } } };
  for (const path of ['/admin', '/admin/', '/admin.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(request(path, { method, headers: identity }), configuration);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Content-Type'), 'text/html');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
      assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
      assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(await response.text(), method === 'HEAD' ? '' : '<main>Organizer sign-in</main>');
      const forwarded = observed.at(-1);
      assert.equal(new URL(forwarded.url).pathname, '/admin');
      assert.equal(forwarded.method, method);
      for (const name of Object.keys(identity)) assert.equal(forwarded.headers.get(name), null);
    }
  }
  assert.equal(observed.length, 6);
});

test('organizer page fails clearly without assets and rejects non-read methods', async () => {
  const worker = createStandaloneWorker();
  const missing = await worker.fetch(request('/admin'), {});
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).reason, 'assets_unconfigured');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const rejected = await worker.fetch(request('/admin', { method }), {});
    assert.equal(rejected.status, 405);
    assert.equal((await rejected.json()).reason, 'method_not_allowed');
  }
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

test('the stable clarity URL serves the real v3 pilot asset without redirect or cache mixing',async()=>{
  const worker=createStandaloneWorker(),seen=[];
  const configuration={ASSETS:{fetch:async r=>{seen.push(r);return new Response('<script src="/clarity-v3-app.mjs"></script>',{headers:{'Content-Type':'text/html','Cache-Control':'public, max-age=86400'}});}}};
  for(const path of ['/clarity','/clarity/','/clarity.html'])for(const method of ['GET','HEAD']){
    const r=await worker.fetch(request(path,{method,headers:identity}),configuration);
    assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Location'),null);
    assert.equal(new URL(seen.at(-1).url).pathname,'/clarity-v3');
    assert.equal(await r.text(),method==='HEAD'?'':'<script src="/clarity-v3-app.mjs"></script>');
    for(const name of Object.keys(identity))assert.equal(seen.at(-1).headers.get(name),null);
  }
  assert.equal((await worker.fetch(request('/clarity'),{})).status,503);
  assert.equal((await worker.fetch(request('/clarity',{method:'POST'}),configuration)).status,405);
});
test('pilot script and style responses cannot stay on an old policy after the entry changes',async()=>{
  const worker=createStandaloneWorker(),configuration={ASSETS:{fetch:async()=>new Response('asset',{headers:{'Cache-Control':'public, max-age=86400'}})}};
  for(const path of ['/clarity-v3-app.mjs','/clarity-v3-intent.mjs','/clarity-v3.css']){
    const r=await worker.fetch(request(path),configuration);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(await r.text(),'asset');
  }
  assert.equal((await worker.fetch(request('/font.css'),configuration)).headers.get('Cache-Control'),'public, max-age=86400');
});
