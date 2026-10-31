export const ORGANIZER_COOKIE = '__Host-liubai_admin';
export const ORGANIZER_SESSION_MS = 8 * 60 * 60 * 1000;
export const ORGANIZER_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ORGANIZER_LOGIN_LIMIT = 10;
const encoder = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}

function passwordHash(env) {
  const value = env.LIUBAI_ADMIN_PASSWORD_HASH;
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : null;
}

export const organizerAuthConfigured = env => Boolean(passwordHash(env));

function database(env) {
  if (!env.DB?.prepare) throw new Error('service_unavailable');
  return env.DB;
}

async function epoch(env) {
  const hash = passwordHash(env);
  if (!hash) throw new Error('admin_unconfigured');
  return sha256(`liubai-admin-epoch-v1:${hash}`);
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
  const bytes = value => Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
  const a = bytes(first), b = bytes(second);
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

export async function getOrganizerSession(request, env, { now = Date.now } = {}) {
  const db = database(env), authEpoch = await epoch(env);
  const token = sessionToken(request);
  if (!token) return { authenticated: false };
  const row = await db.prepare(`SELECT expires_at FROM organizer_sessions
    WHERE token_hash = ? AND auth_epoch = ? AND expires_at > ?`).bind(await sha256(token), authEpoch, now()).first();
  return row ? { authenticated: true, expiresAt: row.expires_at } : { authenticated: false };
}

export async function loginOrganizer(request, env, password, { now = Date.now } = {}) {
  const db = database(env), authEpoch = await epoch(env), timestamp = now();
  // Only Cloudflare's edge-provided address is used. Never accept forwarded-IP
  // aliases, and never persist the plaintext address or the password hash.
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bucket = await sha256(`liubai-admin-login-v1:${authEpoch}:${address}`);
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
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 ||
      !await equalHash(await sha256(password), passwordHash(env))) return { ok: false, status: 401, body: { reason: 'invalid_password' } };
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenHash = await sha256(token), expiresAt = timestamp + ORGANIZER_SESSION_MS;
  await db.prepare('DELETE FROM organizer_sessions WHERE expires_at <= ?').bind(timestamp).run();
  await db.prepare('INSERT INTO organizer_sessions (token_hash, auth_epoch, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, authEpoch, timestamp, expiresAt).run();
  const previous = sessionToken(request);
  if (previous) await db.prepare('DELETE FROM organizer_sessions WHERE token_hash = ?').bind(await sha256(previous)).run();
  return { ok: true, status: 200, body: { authenticated: true, expiresAt }, cookie: organizerCookie(token, ORGANIZER_SESSION_MS / 1000) };
}

export async function logoutOrganizer(request, env) {
  const db = database(env);
  await epoch(env);
  const token = sessionToken(request);
  if (token) await db.prepare('DELETE FROM organizer_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return { ok: true, status: 200, body: { authenticated: false }, cookie: organizerCookie() };
}
