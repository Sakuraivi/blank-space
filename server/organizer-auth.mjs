export const ORGANIZER_COOKIE = '__Host-liubai_admin';
export const ORGANIZER_SESSION_MS = 8 * 60 * 60 * 1000;
export const ORGANIZER_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ORGANIZER_LOGIN_LIMIT = 10;
export const ORGANIZER_PASSWORD_ITERATIONS = 100000;
const encoder = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HEX = /^[a-f0-9]{64}$/;
const PASSWORD_ALGORITHM = 'pbkdf2-sha256-v1';
const bytesFromHex = value => Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
const hexFromBytes = value => [...new Uint8Array(value)].map(n => n.toString(16).padStart(2, '0')).join('');
const randomHex = () => hexFromBytes(crypto.getRandomValues(new Uint8Array(32)));

async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}

function passwordHash(env) {
  const value = env.LIUBAI_ADMIN_PASSWORD_HASH;
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : null;
}

export async function organizerAuthConfigured(env) {
  try { await credential(env); return true; }
  catch (error) { if (error?.message === 'admin_unconfigured') return false; throw error; }
}

function database(env) {
  if (!env.DB?.prepare) throw new Error('service_unavailable');
  return env.DB;
}

async function credential(env) {
  const row = await database(env).prepare("SELECT * FROM organizer_credentials WHERE id = 'main'").first();
  // The migration seeds an explicit bootstrap row. Missing or damaged rows
  // never resurrect an old Cloudflare bootstrap password.
  if (!row) throw new Error('service_unavailable');
  if (row.algorithm === 'bootstrap' && row.revision === 0 &&
      row.salt === null && row.password_hash === null && row.iterations === null && row.auth_epoch === null) {
    const hash = passwordHash(env);
    if (!hash) throw new Error('admin_unconfigured');
    return { ...row, hash, epoch: await sha256(`liubai-admin-epoch-v1:${hash}`) };
  }
  if (row.algorithm !== PASSWORD_ALGORITHM || row.iterations !== ORGANIZER_PASSWORD_ITERATIONS ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER ||
      !HEX.test(row.salt ?? '') || !HEX.test(row.password_hash ?? '') || !HEX.test(row.auth_epoch ?? '') ||
      !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) throw new Error('service_unavailable');
  return { ...row, hash: row.password_hash, epoch: row.auth_epoch };
}

function sessionToken(request) {
  const cookie = request.headers.get('cookie') ?? '';
  if (cookie.length > 4096) return null;
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${ORGANIZER_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(ORGANIZER_COOKIE.length + 1);
  return TOKEN.test(value) ? value : null;
}

export function organizerCookie(token = '', maxAge = 0) {
  return `${ORGANIZER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function equalHash(first, second) {
  const a = bytesFromHex(first), b = bytesFromHex(second);
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  // Standard Web Crypto fallback for local hosts: verify equal-length MACs
  // rather than comparing secret-derived strings with a short-circuit operator.
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const signingKey = await crypto.subtle.importKey('raw', a, algorithm, false, ['sign']);
  const verifyingKey = await crypto.subtle.importKey('raw', b, algorithm, false, ['verify']);
  const message = encoder.encode('liubai-admin-password-equality-v1');
  const signature = await crypto.subtle.sign('HMAC', signingKey, message);
  return crypto.subtle.verify('HMAC', verifyingKey, signature, message);
}

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hexFromBytes(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
    salt: bytesFromHex(salt), iterations: ORGANIZER_PASSWORD_ITERATIONS }, key, 256));
}

async function verifyPassword(value, current) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return false;
  return equalHash(current.algorithm === 'bootstrap' ? await sha256(value) : await derivePassword(value, current.salt), current.hash);
}

async function sessionForCredential(request, env, current, timestamp) {
  const db = database(env);
  const token = sessionToken(request);
  if (!token) return { authenticated: false };
  const row = await db.prepare(`SELECT expires_at FROM organizer_sessions
    WHERE token_hash = ? AND auth_epoch = ? AND expires_at > ?
      AND EXISTS (SELECT 1 FROM organizer_credentials WHERE id = 'main' AND algorithm = ? AND revision = ? AND auth_epoch IS ?)`)
    .bind(await sha256(token), current.epoch, timestamp, current.algorithm, current.revision, current.auth_epoch).first();
  return row ? { authenticated: true, expiresAt: row.expires_at } : { authenticated: false };
}

export async function getOrganizerSession(request, env, { now = Date.now } = {}) {
  return sessionForCredential(request, env, await credential(env), now());
}

async function claimAttempt(env, current, scope, timestamp) {
  const db = database(env);
  const bucket = await sha256(`liubai-admin-attempt-v2:${current.epoch}:${scope}`);
  await db.prepare('DELETE FROM organizer_login_limits WHERE updated_at < ?').bind(timestamp - 2 * ORGANIZER_LOGIN_WINDOW_MS).run();
  const attempt = await db.prepare(`INSERT INTO organizer_login_limits
    (bucket_hash, window_started_at, attempts, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(bucket_hash) DO UPDATE SET
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE MIN(attempts + 1, 11) END,
      updated_at = excluded.updated_at
    RETURNING attempts, window_started_at`).bind(bucket, timestamp, timestamp,
      timestamp - ORGANIZER_LOGIN_WINDOW_MS, timestamp - ORGANIZER_LOGIN_WINDOW_MS).first();
  if (!attempt || !Number.isSafeInteger(attempt.attempts)) throw new Error('service_unavailable');
  if (attempt.attempts > ORGANIZER_LOGIN_LIMIT) return {
    ok: false, status: 429, body: { reason: 'rate_limited' },
    retryAfter: Math.max(1, Math.ceil((attempt.window_started_at + ORGANIZER_LOGIN_WINDOW_MS - timestamp) / 1000)),
  };
  return null;
}

export async function loginOrganizer(request, env, password, { now = Date.now } = {}) {
  const db = database(env), current = await credential(env), timestamp = now();
  // Cloudflare's edge-provided IP, never user-supplied forwarded-IP aliases.
  const limited = await claimAttempt(env, current, `login:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`, timestamp);
  if (limited) return limited;
  if (!await verifyPassword(password, current)) return { ok: false, status: 401, body: { reason: 'invalid_password' } };
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenHash = await sha256(token), expiresAt = timestamp + ORGANIZER_SESSION_MS;
  await db.prepare('DELETE FROM organizer_sessions WHERE expires_at <= ?').bind(timestamp).run();
  // The credential may change during the KDF. This same-statement fence is the
  // authority to issue a session; a prior read cannot authorize an old password.
  const inserted = await db.prepare(`INSERT INTO organizer_sessions (token_hash, auth_epoch, created_at, expires_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM organizer_credentials
      WHERE id = 'main' AND algorithm = ? AND revision = ? AND auth_epoch IS ?)`)
    .bind(tokenHash, current.epoch, timestamp, expiresAt, current.algorithm, current.revision, current.auth_epoch).run();
  if (inserted?.success === false) throw new Error('service_unavailable');
  if (Number(inserted?.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, body: { reason: 'credentials_conflict' }, cookie: organizerCookie() };
  const previous = sessionToken(request);
  if (previous) await db.prepare('DELETE FROM organizer_sessions WHERE token_hash = ?').bind(await sha256(previous)).run();
  return { ok: true, status: 200, body: { authenticated: true, expiresAt }, cookie: organizerCookie(token, ORGANIZER_SESSION_MS / 1000) };
}

export async function logoutOrganizer(request, env) {
  const db = database(env);
  await credential(env);
  const token = sessionToken(request);
  if (token) await db.prepare('DELETE FROM organizer_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return { ok: true, status: 200, body: { authenticated: false }, cookie: organizerCookie() };
}

export async function changeOrganizerPassword(request, env, body, { now = Date.now } = {}) {
  const db = database(env), current = await credential(env), timestamp = now();
  if (!(await sessionForCredential(request, env, current, timestamp)).authenticated) return { ok: false, status: 401, body: { reason: 'auth_required' } };
  // Changing IP must not bypass current-password reauthentication limits.
  const limited = await claimAttempt(env, current, 'change-password:main', timestamp);
  if (limited) return limited;
  if (!await verifyPassword(body?.currentPassword, current)) return { ok: false, status: 401, body: { reason: 'current_password_invalid' } };
  const next = body?.newPassword;
  const encoded = typeof next === 'string' ? encoder.encode(next) : null;
  if (!encoded || [...next].length < 15 || [...next].length > 128 || encoded.byteLength > 512 ||
      new TextDecoder('utf-8', { fatal: true }).decode(encoded) !== next) return { ok: false, status: 400, body: { reason: 'invalid_password' } };
  if (next !== body.confirmPassword) return { ok: false, status: 400, body: { reason: 'password_mismatch' } };
  if (next === body.currentPassword) return { ok: false, status: 400, body: { reason: 'password_unchanged' } };
  const salt = randomHex(), hash = await derivePassword(next, salt), nextEpoch = randomHex();
  const saved = await db.prepare(`UPDATE organizer_credentials SET algorithm = ?, salt = ?, password_hash = ?, iterations = ?,
    revision = ?, auth_epoch = ?, updated_at = ?
    WHERE id = 'main' AND algorithm = ? AND revision = ? AND auth_epoch IS ?`)
    .bind(PASSWORD_ALGORITHM, salt, hash, ORGANIZER_PASSWORD_ITERATIONS, current.revision + 1, nextEpoch, timestamp,
      current.algorithm, current.revision, current.auth_epoch).run();
  if (saved?.success === false) throw new Error('service_unavailable');
  if (Number(saved?.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, body: { reason: 'credentials_conflict' }, cookie: organizerCookie() };
  // The committed epoch invalidates every old session, even if cleanup fails.
  // Cleanup may run after another rotation. Delete only this change's former
  // epoch, never any session belonging to this or a later credential revision.
  try { await db.prepare('DELETE FROM organizer_sessions WHERE auth_epoch = ?').bind(current.epoch).run(); } catch {}
  return { ok: true, status: 200, body: { changed: true, authenticated: false }, cookie: organizerCookie() };
}
