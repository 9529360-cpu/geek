import baseWorker from './geek-subscription-worker.js';
import { ensureAccountNo, insertWithAccountNo } from './account-number.mjs';

// Production auth entrypoint for the Workers Free 10 ms CPU budget.
// PBKDF2 at 100k/310k iterations is too expensive on the Free plan and caused
// real register/login requests to terminate with HTTP 500. v4 uses a
// purpose-separated HMAC-SHA-256 password verifier keyed by the existing
// server-only JWT_SECRET. This keeps database-only leaks resistant to offline
// guessing while staying within the runtime budget. Older PBKDF2 rows fail
// closed into password reset instead of recomputing an expensive KDF.
const enc = new TextEncoder();
const HASH_PREFIX = 'v4$';
const PASSWORD_DOMAIN = 'geek-password-v4\0';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bytesToB64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex, expectedBytes) {
  const value = String(hex || '');
  if (!new RegExp(`^[0-9a-f]{${expectedBytes * 2}}$`, 'i').test(value)) return null;
  const out = new Uint8Array(expectedBytes);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function passwordKey(secret) {
  if (!secret) throw new Error('JWT_SECRET missing');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function hashPassword(password, saltHex, secret) {
  const existingSalt = saltHex ? hexToBytes(saltHex, 16) : null;
  if (saltHex && !existingSalt) return null;
  const salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
  const saltValue = bytesToHex(salt);
  const key = await passwordKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${PASSWORD_DOMAIN}${saltValue}\0${String(password)}`)
  );
  return { salt: saltValue, hash: bytesToHex(new Uint8Array(sig)) };
}

function constantTimeEqualHex(left, right) {
  const a = hexToBytes(left, 32);
  const b = hexToBytes(right, 32);
  if (!a || !b) return false;
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password, saltHex, expectedHash, secret) {
  const storedValue = String(expectedHash || '');

  // v2/v3 and legacy unprefixed rows require PBKDF2. Never recompute those on
  // Workers Free; direct them to the reset path instead. There are currently
  // no production users that require transparent legacy migration.
  if (!storedValue.startsWith(HASH_PREFIX)) {
    const looksLegacy = /^(?:v2\$|v3\$)?[0-9a-f]{64}$/i.test(storedValue);
    return { ok: false, resetRequired: looksLegacy };
  }

  const stored = storedValue.slice(HASH_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(stored)) return { ok: false, resetRequired: false };
  const derived = await hashPassword(password, saltHex, secret);
  return {
    ok: Boolean(derived && constantTimeEqualHex(derived.hash, stored)),
    resetRequired: false,
  };
}

async function signJwt(payload, secret) {
  if (!secret) throw new Error('JWT_SECRET missing');
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) => bytesToB64Url(enc.encode(JSON.stringify(obj)));
  const data = `${b64(header)}.${b64(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${bytesToB64Url(new Uint8Array(sig))}`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value || '')));
  return bytesToHex(new Uint8Array(digest));
}

function authCookie(name, token, maxAge) {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, headers });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function rateLimited(db, bucket, limit, windowSec) {
  const now = Date.now();
  const stamp = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  const cutoff = new Date(now - windowSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.prepare('DELETE FROM rate_limits WHERE updated_at < ?').bind(cutoff).run();
  const row = await db.prepare('SELECT count FROM rate_limits WHERE bucket = ?').bind(bucket).first();
  if (!row) {
    await db.prepare('INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?)').bind(bucket, stamp).run();
    return false;
  }
  if (Number(row.count) >= limit) return true;
  await db.prepare('UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?').bind(stamp, bucket).run();
  return false;
}

async function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

async function handleRegister(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'password_length_invalid' }, 400);
  if (await getUserByEmail(db, email)) return json({ error: 'email_exists' }, 409);

  const next = await hashPassword(password, null, env.JWT_SECRET);
  if (!next) return json({ error: 'password_hash_failed' }, 500);
  const { accountNo, result } = await insertWithAccountNo((candidate) => db.prepare(
    'INSERT INTO users (email, password_hash, password_salt, quota_chars, account_no) VALUES (?, ?, ?, ?, ?)'
  ).bind(email, `${HASH_PREFIX}${next.hash}`, next.salt, 20000, candidate).run());
  return json({ ok: true, userId: result.meta.last_row_id, account_no: accountNo });
}

async function handleLogin(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  let user = await getUserByEmail(db, email);
  if (!user) return json({ error: 'invalid_credentials' }, 401);

  const verification = await verifyPassword(password, user.password_salt, user.password_hash, env.JWT_SECRET);
  if (verification.resetRequired) return json({ error: 'password_reset_required' }, 409);
  if (!verification.ok) return json({ error: 'invalid_credentials' }, 401);
  if (user.status === 'disabled') return json({ error: 'account_disabled' }, 403);
  user = await ensureAccountNo(db, user);

  const maxAge = 60 * 60 * 24 * 30;
  const token = await signJwt({
    uid: user.id,
    email: user.email,
    kind: 'user',
    ver: user.token_version || 0,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  }, env.JWT_SECRET);
  return withCookie(
    json({ ok: true, token, user: { id: user.id, email: user.email, account_no: user.account_no } }),
    authCookie('geek_session', token, maxAge)
  );
}

async function handlePasswordResetComplete(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ error: 'invalid_or_expired_token' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'password_length_invalid' }, 400);

  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(
    "SELECT id, user_id FROM password_reset_requests WHERE token_hash = ? AND status = 'issued' AND expires_at > datetime('now')"
  ).bind(tokenHash).first();
  if (!row) return json({ error: 'invalid_or_expired_token' }, 400);

  const next = await hashPassword(password, null, env.JWT_SECRET);
  if (!next) throw new Error('password_hash_failed');

  const results = await db.batch([
    db.prepare(
      "UPDATE password_reset_requests SET status = 'processing' WHERE id = ? AND user_id = ? AND token_hash = ? AND status = 'issued' AND expires_at > datetime('now')"
    ).bind(row.id, row.user_id, tokenHash),
    db.prepare(`UPDATE users
      SET password_hash = ?, password_salt = ?, token_version = token_version + 1
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM password_reset_requests
        WHERE id = ? AND user_id = ? AND token_hash = ? AND status = 'processing'
      )`
    ).bind(`${HASH_PREFIX}${next.hash}`, next.salt, row.user_id, row.id, row.user_id, tokenHash),
    db.prepare(
      "UPDATE password_reset_requests SET status = 'used', used_at = datetime('now') WHERE id = ? AND user_id = ? AND token_hash = ? AND status = 'processing'"
    ).bind(row.id, row.user_id, tokenHash),
  ]);

  if (results.some((result) => Number(result?.meta?.changes || 0) !== 1)) {
    return json({ error: 'invalid_or_expired_token' }, 400);
  }
  return withCookie(json({ ok: true }), authCookie('geek_session', '', 0));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.geek_subscriptions;

    if (request.method === 'POST' && path === '/api/register') {
      const ip = clientIp(request);
      if (await rateLimited(db, `reg:${ip}`, 5, 60)) return json({ error: 'rate_limited' }, 429);
      return handleRegister(request, db, env);
    }

    if (request.method === 'POST' && path === '/api/login') {
      const ip = clientIp(request);
      if (await rateLimited(db, `login:${ip}`, 10, 60)) return json({ error: 'rate_limited' }, 429);
      return handleLogin(request, db, env);
    }

    if (request.method === 'POST' && path === '/api/password-reset/complete') {
      const ip = clientIp(request);
      if (await rateLimited(db, `reset-complete:${ip}`, 10, 3600)) return json({ error: 'rate_limited' }, 429);
      return handlePasswordResetComplete(request, db, env);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, env, ctx);
    }
  },
};
