import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loginOrganizer, getOrganizerSession, changeOrganizerPassword, organizerAuthConfigured,
  ORGANIZER_COOKIE, ORGANIZER_LOGIN_WINDOW_MS, ORGANIZER_PASSWORD_ITERATIONS } from './organizer-auth.mjs';

const BOOTSTRAP = 'synthetic-bootstrap-password-never-production';
const NEXT = 'synthetic-new-management-password-2026';
const SCHEMA = ['0003_organizer_auth.sql', '0004_organizer_credentials.sql']
  .map(name => readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')).join('\n');
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const request = (cookie, ip = '192.0.2.1') => new Request('https://organizer.test/api/organizer/password', {
  method: 'POST', headers: { Origin: 'https://organizer.test', 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}) },
});
const body = (newPassword = NEXT, currentPassword = BOOTSTRAP) => ({ currentPassword, newPassword, confirmPassword: newPassword });
const cookieFor = result => result.cookie.split(';')[0];

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  t.after(() => sqlite.close());
  let beforeRun = null, time = 1800000000000;
  const env = { LIUBAI_ADMIN_PASSWORD_HASH: await hash(BOOTSTRAP), DB: { prepare(sql) {
    let parameters = [];
    return {
      bind(...values) { parameters = values; return this; },
      async first() { return sqlite.prepare(sql).get(...parameters) ?? null; },
      async run() {
        if (beforeRun) await beforeRun(sql, parameters);
        const result = sqlite.prepare(sql).run(...parameters);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  } } };
  const options = { now: () => time };
  const login = (password = BOOTSTRAP, ip) => loginOrganizer(request(null, ip), env, password, options);
  return { sqlite, env, options, login, advance: n => { time += n; }, hook: fn => { beforeRun = fn; } };
}

test('password change persists a salted KDF, rejects the bootstrap password and revokes all old sessions without needing the old secret', async t => {
  const f = await fixture(t);
  assert.equal(await organizerAuthConfigured(f.env), true);
  const first = await f.login(), second = await f.login();
  const oldEpoch = f.sqlite.prepare('SELECT auth_epoch FROM organizer_sessions').get().auth_epoch;
  const changed = await changeOrganizerPassword(request(cookieFor(first)), f.env, body(), f.options);
  assert.deepEqual(changed.body, { changed: true, authenticated: false });
  assert.equal(changed.status, 200);
  assert.match(changed.cookie, /Max-Age=0/);
  const row = f.sqlite.prepare('SELECT * FROM organizer_credentials').get();
  assert.equal(row.algorithm, 'pbkdf2-sha256-v1');
  assert.equal(row.iterations, ORGANIZER_PASSWORD_ITERATIONS);
  assert.equal(row.revision, 1);
  for (const field of ['salt', 'password_hash', 'auth_epoch']) assert.match(row[field], /^[a-f0-9]{64}$/);
  assert.notEqual(row.auth_epoch, oldEpoch);
  assert.notEqual(row.password_hash, await hash(NEXT));
  assert.doesNotMatch(JSON.stringify(row), /synthetic-/);
  assert.deepEqual(await getOrganizerSession(request(cookieFor(first)), f.env, f.options), { authenticated: false });
  assert.deepEqual(await getOrganizerSession(request(cookieFor(second)), f.env, f.options), { authenticated: false });
  assert.equal((await f.login()).body.reason, 'invalid_password');
  // A fresh environment object simulates a new isolate/restart. D1, not a
  // process variable or the old Cloudflare secret, owns the new password.
  const restarted = { DB: f.env.DB };
  assert.equal(await organizerAuthConfigured(restarted), true);
  const fresh = await loginOrganizer(request(), restarted, NEXT, f.options);
  assert.equal(fresh.status, 200);
  assert.equal((await getOrganizerSession(request(cookieFor(fresh)), restarted, f.options)).authenticated, true);
});

test('new-password validation uses exact Unicode characters, confirmation and a bounded UTF-8 encoding without trimming', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  for (const [values, reason] of [
    [body('short-password'), 'invalid_password'],
    [body('a'.repeat(129)), 'invalid_password'],
    [body('😀'.repeat(129)), 'invalid_password'],
    [body('a'.repeat(15) + '\ud800'), 'invalid_password'],
    [{ ...body(), confirmPassword: NEXT + ' ' }, 'password_mismatch'],
    [body(BOOTSTRAP), 'password_unchanged'],
  ]) {
    const result = await changeOrganizerPassword(request(cookie), f.env, values, f.options);
    assert.equal(result.status, 400);
    assert.equal(result.body.reason, reason);
    assert.equal(f.sqlite.prepare('SELECT revision FROM organizer_credentials').get().revision, 0);
  }
  const exact = '  abcdefghijklmno  ';
  assert.equal((await changeOrganizerPassword(request(cookie), f.env, body(exact), f.options)).status, 200);
  assert.equal((await f.login(exact.trim())).body.reason, 'invalid_password');
  assert.equal((await f.login(exact)).status, 200);
  const nextCookie = cookieFor(await f.login(exact));
  const maximum = '😀'.repeat(128); // 128 code points, 256 UTF-16 units, 512 bytes.
  assert.equal((await changeOrganizerPassword(request(nextCookie), f.env, body(maximum, exact), f.options)).status, 200);
  assert.equal((await f.login(maximum)).status, 200);
});

test('current-password reauthentication is session-protected and persistently limited per account/epoch across IP changes', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  assert.deepEqual((await changeOrganizerPassword(request(), f.env, body(), f.options)).body, { reason: 'auth_required' });
  assert.deepEqual((await changeOrganizerPassword(request(`${ORGANIZER_COOKIE}=${'x'.repeat(43)}`), f.env, body(), f.options)).body, { reason: 'auth_required' });
  for (let i = 0; i < 10; i++) {
    const result = await changeOrganizerPassword(request(cookie, `192.0.2.${i + 10}`), f.env, body(NEXT, 'wrong-current-password'), f.options);
    assert.equal(result.status, 401);
    assert.equal(result.body.reason, 'current_password_invalid');
  }
  const limited = await changeOrganizerPassword(request(cookie, '192.0.2.99'), f.env, body(), f.options);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.reason, 'rate_limited');
  assert.equal(f.sqlite.prepare('SELECT revision FROM organizer_credentials').get().revision, 0);
  f.advance(ORGANIZER_LOGIN_WINDOW_MS);
  assert.equal((await changeOrganizerPassword(request(cookie), f.env, body(), f.options)).status, 200);
});

test('concurrent password changes commit exactly one credential revision and reject the stale CAS', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  let waiting = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  f.hook(async sql => {
    if (!sql.startsWith('UPDATE organizer_credentials SET')) return;
    if (++waiting === 2) release();
    await gate;
  });
  const results = await Promise.all([
    changeOrganizerPassword(request(cookie), f.env, body('first-new-concurrent-password'), f.options),
    changeOrganizerPassword(request(cookie), f.env, body('second-new-concurrent-password'), f.options),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).body.reason, 'credentials_conflict');
  assert.equal(f.sqlite.prepare('SELECT revision FROM organizer_credentials').get().revision, 1);
  f.hook(null);
  const logins = await Promise.all([f.login('first-new-concurrent-password'), f.login('second-new-concurrent-password')]);
  assert.deepEqual(logins.map(result => result.status).sort(), [200, 401]);
});

test('a password change during login cannot issue a successful cookie for the obsolete credential', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  let changed = false;
  f.hook(async sql => {
    if (!sql.startsWith('INSERT INTO organizer_sessions') || changed) return;
    changed = true;
    assert.equal((await changeOrganizerPassword(request(cookie), f.env, body(), f.options)).status, 200);
  });
  const raced = await f.login();
  assert.equal(raced.status, 409);
  assert.equal(raced.body.reason, 'credentials_conflict');
  assert.match(raced.cookie, /Max-Age=0/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_sessions').get().n, 0);
  f.hook(null);
  assert.equal((await f.login(NEXT)).status, 200);
});

test('committed credential epoch rejects old cookies even when session cleanup fails', async t => {
  const f = await fixture(t), first = await f.login(), second = await f.login();
  f.hook(async sql => { if (sql.startsWith('DELETE FROM organizer_sessions WHERE auth_epoch')) throw Error('synthetic cleanup failure'); });
  assert.equal((await changeOrganizerPassword(request(cookieFor(first)), f.env, body(), f.options)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_sessions').get().n, 2);
  assert.equal((await getOrganizerSession(request(cookieFor(first)), f.env, f.options)).authenticated, false);
  assert.equal((await getOrganizerSession(request(cookieFor(second)), f.env, f.options)).authenticated, false);
  f.hook(null);
  assert.equal((await f.login(NEXT)).status, 200);
});

test('cleanup removes only obsolete epochs and preserves a session issued with the new password', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  let fresh;
  f.hook(async sql => {
    if (!sql.startsWith('DELETE FROM organizer_sessions WHERE auth_epoch')) return;
    fresh = await f.login(NEXT);
    assert.equal(fresh.status, 200);
  });
  assert.equal((await changeOrganizerPassword(request(cookie), f.env, body(), f.options)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_sessions').get().n, 1);
  assert.equal((await getOrganizerSession(request(cookieFor(fresh)), f.env, f.options)).authenticated, true);
});

test('delayed cleanup from an earlier rotation cannot delete a session issued after a second rotation', async t => {
  const f = await fixture(t), initialCookie = cookieFor(await f.login());
  const latestPassword = 'synthetic-password-after-second-rotation';
  let intercepted = false, latest;
  f.hook(async sql => {
    if (!sql.startsWith('DELETE FROM organizer_sessions WHERE auth_epoch') || intercepted) return;
    intercepted = true;
    // First rotation has committed, but its cleanup has not executed. Complete
    // a second rotation and login before allowing that older cleanup to resume.
    const middle = await f.login(NEXT);
    assert.equal(middle.status, 200);
    const second = await changeOrganizerPassword(request(cookieFor(middle)), f.env, body(latestPassword, NEXT), f.options);
    assert.equal(second.status, 200);
    latest = await f.login(latestPassword);
    assert.equal(latest.status, 200);
  });
  assert.equal((await changeOrganizerPassword(request(initialCookie), f.env, body(), f.options)).status, 200);
  assert.equal(f.sqlite.prepare('SELECT revision FROM organizer_credentials').get().revision, 2);
  assert.equal((await getOrganizerSession(request(cookieFor(latest)), f.env, f.options)).authenticated, true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM organizer_sessions').get().n, 1);
});

test('missing or damaged persistent credentials fail closed and cannot reactivate the bootstrap password', async t => {
  const f = await fixture(t), cookie = cookieFor(await f.login());
  f.sqlite.prepare("DELETE FROM organizer_credentials WHERE id = 'main'").run();
  for (const action of [() => f.login(), () => organizerAuthConfigured(f.env), () => getOrganizerSession(request(cookie), f.env, f.options)]) {
    await assert.rejects(action, /service_unavailable/);
  }
  f.sqlite.exec("PRAGMA ignore_check_constraints=ON; INSERT INTO organizer_credentials (id,algorithm,revision,updated_at) VALUES ('main','unsupported-kdf',1,0)");
  await assert.rejects(() => f.login(), /service_unavailable/);
  await assert.rejects(() => getOrganizerSession(request(cookie), f.env, f.options), /service_unavailable/);
  f.sqlite.exec("UPDATE organizer_credentials SET algorithm='pbkdf2-sha256-v1',salt='broken',password_hash='broken',iterations=1,auth_epoch='broken'");
  await assert.rejects(() => f.login(), /service_unavailable/);
});
