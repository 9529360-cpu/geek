import baseWorker from './geek-subscription-worker.js';

// Hotfix entrypoint for Cloudflare Workers Free CPU budget.
// The previous 310k-iteration PBKDF2 path caused real login/register requests
// to hit HTTP 500 while /health and nonexistent-user login stayed healthy.
// Keep auth KDF work to one 100k PBKDF2 operation per request until auth is
// moved to a runtime/plan with a larger CPU budget.
const enc = new TextEncoder();
const PASSWORD_ITERATIONS = 100000;
const HASH_PREFIX = 'v3$';

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

function b64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const value = String(hex || '');
  if (!/^[0-9a-f]{32}$/i.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hashPassword(password, saltHex) {
  const existingSalt = saltHex ? hexToBytes(saltHex) : null;
  if (saltHex && !existingSalt) return null;
  const salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

async function verifyPassword(password, saltHex, expectedHash) {
  const storedValue = String(expectedHash || '');

  // v2 hashes were produced with 310k iterations. Recomputing them can exceed
  // the Free Worker request CPU budget, so require a password reset instead of
  // crashing the Worker. This deployment currently has no production users;
  // these rows are disposable test accounts.
  if (storedValue.startsWith('v2$')) {
    return { ok: false, resetRequired: true };
  }

  const stored = storedValue.startsWith(HASH_PREFIX)
    ? storedValue.slice(HASH_PREFIX.length)
    : storedValue; // legacy unprefixed rows used 100k iterations.
  if (!/^[0-9a-f]{64}$/i.test(stored)) return { ok: false, resetRequired: false };
  const derived = await hashPassword(password, saltHex);
  return { ok: Boolean(derived && derived.hash === stored), resetRequired: false };
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

async function handleRegister(request, db) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'password_length_invalid' }, 400);
  if (await getUserByEmail(db, email)) return json({ error: 'email_exists' }, 409);

  const next = await hashPassword(password);
  if (!next) return json({ error: 'password_hash_failed' }, 500);
  const result = await db.prepare(
    'INSERT INTO users (email, password_hash, password_salt, quota_chars) VALUES (?, ?, ?, ?)'
  ).bind(email, `${HASH_PREFIX}${next.hash}`, next.salt, 20000).run();
  return json({ ok: true, userId: result.meta.last_row_id });
}

async function handleLogin(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await getUserByEmail(db, email);
  if (!user) return json({ error: 'invalid_credentials' }, 401);

  const verification = await verifyPassword(password, user.password_salt, user.password_hash);
  if (verification.resetRequired) return json({ error: 'password_reset_required' }, 409);
  if (!verification.ok) return json({ error: 'invalid_credentials' }, 401);
  if (user.status === 'disabled') return json({ error: 'account_disabled' }, 403);

  const maxAge = 60 * 60 * 24 * 30;
  const token = await signJwt({
    uid: user.id,
    email: user.email,
    kind: 'user',
    ver: user.token_version || 0,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  }, env.JWT_SECRET);
  return withCookie(
    json({ ok: true, token, user: { id: user.id, email: user.email } }),
    authCookie('geek_session', token, maxAge)
  );
}

async function handlePasswordResetComplete(request, db) {
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

  const claim = await db.prepare(
    "UPDATE password_reset_requests SET status = 'processing' WHERE id = ? AND status = 'issued'"
  ).bind(row.id).run();
  if (claim.meta.changes !== 1) return json({ error: 'invalid_or_expired_token' }, 400);

  try {
    const next = await hashPassword(password);
    if (!next) throw new Error('password_hash_failed');
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, token_version = token_version + 1 WHERE id = ?')
        .bind(`${HASH_PREFIX}${next.hash}`, next.salt, row.user_id),
      db.prepare("UPDATE password_reset_requests SET status = 'used', used_at = datetime('now') WHERE id = ? AND status = 'processing'")
        .bind(row.id),
    ]);
    return withCookie(json({ ok: true }), authCookie('geek_session', '', 0));
  } catch (error) {
    await db.prepare(
      "UPDATE password_reset_requests SET status = 'issued' WHERE id = ? AND status = 'processing'"
    ).bind(row.id).run().catch(() => {});
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.geek_subscriptions;

    if (request.method === 'POST' && path === '/api/register') {
      const ip = clientIp(request);
      if (await rateLimited(db, `reg:${ip}`, 5, 60)) return json({ error: 'rate_limited' }, 429);
      return handleRegister(request, db);
    }

    if (request.method === 'POST' && path === '/api/login') {
      const ip = clientIp(request);
      if (await rateLimited(db, `login:${ip}`, 10, 60)) return json({ error: 'rate_limited' }, 429);
      return handleLogin(request, db, env);
    }

    if (request.method === 'POST' && path === '/api/password-reset/complete') {
      const ip = clientIp(request);
      if (await rateLimited(db, `reset-complete:${ip}`, 10, 3600)) return json({ error: 'rate_limited' }, 429);
      return handlePasswordResetComplete(request, db);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, env, ctx);
    }
  },
};
