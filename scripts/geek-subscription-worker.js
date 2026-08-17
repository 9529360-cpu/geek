// geek-subscription Worker —— 极客付费订阅体系（Cloudflare D1 零成本方案）
// 路由：
//   公开：GET /health、POST /api/register、POST /api/login
//   用户(带 token)：GET /api/me、POST /api/orders、GET /api/orders、GET /api/status
//   管理(带 admin token)：POST /api/admin/login、GET /api/admin/users、GET /api/admin/orders、
//        POST /api/admin/orders/:id/confirm、POST /api/admin/users/:id/disable、POST /api/admin/users/:id/enable、
//        GET /api/admin/stats
//   UI：GET /admin（管理后台页面）
// 环境变量：JWT_SECRET（JWT 签名密钥）、ADMIN_PASSWORD（管理员密码）

// ========== 套餐配置（改这里即可调整定价；美元字符包，买断不限时） ==========
// 对齐原版 Hello-GPT 定价体系：字符包模式，购买后直接加到字符余额，无到期时间
const PLANS = {
  basic:    { name: '基础包',   priceUsd: 25,  chars: 1000000 },  // $25 / 100万字符
  standard: { name: '标准包',   priceUsd: 48,  chars: 1500000 },  // $48 / 150万字符（对齐原版高级版）
  pro:      { name: '大包',     priceUsd: 128, chars: 4500000 },  // $128 / 450万字符（对齐原版高级大包）
};
// 注册赠送免费翻译字符额度（Freemium：注册即用，用完引导开通）
const FREE_QUOTA_CHARS = 20000;

// 字符换算（国际标准，对齐原版规则）：一个英文字母=1字符，一个汉字/非ASCII字符=2字符
function countChars(text) {
  let n = 0;
  for (const ch of String(text || '')) {
    n += ch.codePointAt(0) > 255 ? 2 : 1;
  }
  return n;
}

// ========== 工具 ==========
const enc = new TextEncoder();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
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
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const PASSWORD_ITERATIONS = 310000;

async function hashPassword(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

async function verifyPassword(password, saltHex, expectedHash) {
  const modern = String(expectedHash || '').startsWith('v2$');
  const stored = modern ? String(expectedHash).slice(3) : String(expectedHash || '');
  const { hash } = await hashPassword(password, saltHex, modern ? PASSWORD_ITERATIONS : 100000);
  return { ok: hash === stored, needsUpgrade: !modern && hash === stored };
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) => bytesToB64Url(enc.encode(JSON.stringify(obj)));
  const data = `${b64(header)}.${b64(payload)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${bytesToB64Url(new Uint8Array(sig))}`;
}

async function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64UrlToBytes(parts[2]), enc.encode(data));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// 从 Authorization: Bearer xxx 取 token
function authToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)geek_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value || '')));
  return bytesToHex(new Uint8Array(digest));
}

function randomToken() {
  return bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function adminAuthToken(request) {
  const h = request.headers.get('Authorization') || '';
  const bearer = h.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1];
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)geek_admin_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function csrfAllowed(request) {
  if (request.headers.get('Authorization')) return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

function authCookie(name, token, maxAge) {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function withCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, headers });
}

// 当前有效订阅（从 expires_at 最新的一条 active 中取）
async function currentSub(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT * FROM subs WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1`
    )
    .bind(userId)
    .all();
  return results[0] || null;
}

async function getUserByEmail(db, email) {
  const { results } = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).all();
  return results[0] || null;
}

async function getUserById(db, id) {
  const { results } = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).all();
  return results[0] || null;
}

// ========== API 处理器 ==========
async function handleRegister(request, db) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'password_length_invalid' }, 400);
  if (await getUserByEmail(db, email)) return json({ error: 'email_exists' }, 409);
  const { salt, hash } = await hashPassword(password);
  const { meta } = await db
    .prepare('INSERT INTO users (email, password_hash, password_salt, quota_chars) VALUES (?, ?, ?, ?)')
    .bind(email, `v2$${hash}`, salt, FREE_QUOTA_CHARS)
    .run();
  const userId = meta.last_row_id;
  return json({ ok: true, userId });
}

async function handleLogin(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await getUserByEmail(db, email);
  const verification = user ? await verifyPassword(password, user.password_salt, user.password_hash) : { ok: false };
  if (!user || !verification.ok) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  if (user.status === 'disabled') return json({ error: 'account_disabled' }, 403);
  if (verification.needsUpgrade) {
    const upgraded = await hashPassword(password);
    await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .bind(`v2$${upgraded.hash}`, upgraded.salt, user.id).run();
  }
  const maxAge = 60 * 60 * 24 * 30;
  const token = await signJwt({ uid: user.id, email: user.email, kind: 'user', ver: user.token_version || 0, exp: Math.floor(Date.now() / 1000) + maxAge }, env.JWT_SECRET);
  return withCookie(json({ ok: true, token, user: { id: user.id, email: user.email } }), authCookie('geek_session', token, maxAge));
}

async function handleMe(user, db) {
  return json({
    ok: true,
    user: { id: user.id, email: user.email, status: user.status, quota_chars: user.quota_chars || 0, created_at: user.created_at },
  });
}

async function handleStatus(user, db) {
  const remaining = user.quota_chars || 0;
  return json({
    ok: true,
    valid: remaining > 0,
    remaining_chars: remaining,
  });
}

// Freemium 额度查询：返回剩余字符（纯字符包，无订阅/无到期概念）
async function handleQuota(user, db) {
  return json({
    ok: true,
    email: user.email,
    remaining_chars: user.quota_chars || 0,
  });
}

async function sendResetEmail(env, email, resetUrl, requestId) {
  if (!env.RESEND_API_KEY || !env.RESET_FROM_EMAIL) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'geek-password-reset/1.0',
      'Idempotency-Key': `password-reset-${requestId}`,
    },
    body: JSON.stringify({
      from: env.RESET_FROM_EMAIL,
      to: [email],
      subject: '重置你的极客 Geek 密码',
      text: `请在 30 分钟内打开以下链接重置密码：\n\n${resetUrl}\n\n如果不是你本人操作，请忽略此邮件。`,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.warn('password reset email rejected', {
      status: response.status,
      type: String(error.type || 'unknown').slice(0, 80),
      message: String(error.message || 'unknown').slice(0, 200),
    });
  }
  return response.ok;
}

async function issuePasswordReset(db, env, row) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const claim = await db.prepare("UPDATE password_reset_requests SET status = 'issued', token_hash = ?, expires_at = ? WHERE id = ? AND status = 'requested'")
    .bind(tokenHash, expiresAt, row.id).run();
  if (claim.meta.changes !== 1) return null;
  const resetUrl = `https://geek.bbnba.com/reset-password?token=${encodeURIComponent(token)}`;
  const emailed = await sendResetEmail(env, row.email, resetUrl, row.id).catch(() => false);
  return { resetUrl, emailed, expiresAt };
}

async function handlePasswordResetRequest(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const generic = json({ ok: true, message: 'if_account_exists_reset_will_be_sent' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return generic;
  const user = await getUserByEmail(db, email);
  if (!user || user.status === 'disabled') return generic;
  await db.prepare("UPDATE password_reset_requests SET status = 'expired' WHERE user_id = ? AND status IN ('requested','issued')")
    .bind(user.id).run();
  const inserted = await db.prepare('INSERT INTO password_reset_requests (user_id, email) VALUES (?, ?)')
    .bind(user.id, user.email).run();
  const row = { id: inserted.meta.last_row_id, email: user.email };
  if (env.RESEND_API_KEY && env.RESET_FROM_EMAIL) {
    const issued = await issuePasswordReset(db, env, row);
    if (issued && !issued.emailed) {
      await db.prepare("UPDATE password_reset_requests SET status = 'requested', token_hash = NULL, expires_at = NULL WHERE id = ? AND status = 'issued'")
        .bind(row.id).run();
    }
  }
  return generic;
}

async function handlePasswordResetComplete(request, db) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ error: 'invalid_or_expired_token' }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: 'password_length_invalid' }, 400);
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare("SELECT id, user_id FROM password_reset_requests WHERE token_hash = ? AND status = 'issued' AND expires_at > datetime('now')")
    .bind(tokenHash).first();
  if (!row) return json({ error: 'invalid_or_expired_token' }, 400);
  const claim = await db.prepare("UPDATE password_reset_requests SET status = 'processing' WHERE id = ? AND status = 'issued'").bind(row.id).run();
  if (claim.meta.changes !== 1) return json({ error: 'invalid_or_expired_token' }, 400);
  try {
    const next = await hashPassword(password);
    await db.batch([
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, token_version = token_version + 1 WHERE id = ?').bind(`v2$${next.hash}`, next.salt, row.user_id),
      db.prepare("UPDATE password_reset_requests SET status = 'used', used_at = datetime('now') WHERE id = ? AND status = 'processing'").bind(row.id),
    ]);
    return withCookie(json({ ok: true }), authCookie('geek_session', '', 0));
  } catch (error) {
    await db.prepare("UPDATE password_reset_requests SET status = 'issued' WHERE id = ? AND status = 'processing'").bind(row.id).run();
    throw error;
  }
}

async function handleAdminPasswordResets(db) {
  const { results } = await db.prepare("SELECT id, email, status, expires_at, created_at, used_at FROM password_reset_requests ORDER BY id DESC LIMIT 100").all();
  return json({ ok: true, requests: results });
}

async function handleAdminIssuePasswordReset(db, env, url) {
  const id = Number(url.pathname.split('/').filter(Boolean).at(-2));
  const row = await db.prepare("SELECT id, email FROM password_reset_requests WHERE id = ? AND status = 'requested'").bind(id).first();
  if (!row) return json({ error: 'request_not_found_or_processed' }, 404);
  const issued = await issuePasswordReset(db, env, row);
  if (!issued) return json({ error: 'request_not_found_or_processed' }, 409);
  await logAction(db, 'issue_password_reset', `为 ${row.email} 生成一次性密码重置链接`);
  return json({ ok: true, reset_url: issued.resetUrl, emailed: issued.emailed, expires_at: issued.expiresAt });
}

async function handleTranslationToken(user, env) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    uid: user.id,
    aud: 'geek-translate',
    purpose: 'translate',
    iat: now,
    exp: now + 5 * 60,
  }, env.JWT_SECRET);
  return json({ ok: true, token, expires_at: now + 5 * 60 });
}

// 字符扣减：翻译成功后客户端上报原文+译文，服务端按国际标准换算扣减
// （1 英文字母=1 字符，1 汉字/非ASCII=2 字符；原子扣减防并发超扣）
async function handleUsage(user, db, request) {
  const body = await request.json().catch(() => ({}));
  const source = String(body.source || '');
  const target = String(body.target || '');
  if (!source && !target) return json({ error: 'invalid_text' }, 400);
  const used = Math.max(1, countChars(source) + countChars(target));
  await db.prepare('UPDATE users SET quota_chars = MAX(0, quota_chars - ?) WHERE id = ?').bind(used, user.id).run();
  const row = await db.prepare('SELECT quota_chars FROM users WHERE id = ?').bind(user.id).first();
  return json({ ok: true, remaining_chars: row.quota_chars, deducted: used });
}

async function handleCreateOrder(user, db, request) {
  const body = await request.json().catch(() => ({}));
  const plan = String(body.plan || '');
  const payMethod = body.pay_method === 'usdt' ? 'usdt' : 'manual';
  if (!PLANS[plan]) return json({ error: 'invalid_plan' }, 400);
  const p = PLANS[plan];
  // 已有该套餐的 pending 订单则复用，避免重复下单
  const { results } = await db
    .prepare(`SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`)
    .bind(user.id, plan)
    .all();
  if (results[0]) return json({ ok: true, order: results[0], reuse: true, pay: await payInfo(db, results[0]) });
  // USDT 订单生成唯一金额（原价 - 随机 0.01~1.00 优惠，链上识别订单用；参考成熟方案 UsdtPay）
  let amountCents = null;
  if (payMethod === 'usdt') {
    amountCents = p.priceUsd * 100 - (1 + Math.floor(Math.random() * 100)); // 减 1~100 分
    // 冲突检测：与所有待支付订单金额去重
    const { results: pendings } = await db
      .prepare("SELECT amount_cents FROM orders WHERE status = 'pending' AND pay_method = 'usdt' AND amount_cents IS NOT NULL")
      .all();
    const used = new Set(pendings.map(o => o.amount_cents));
    while (used.has(amountCents) && amountCents > 0) amountCents -= 1;
  }
  const { meta } = await db
    .prepare('INSERT INTO orders (user_id, plan, amount, currency, pay_method, amount_cents) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, plan, p.priceUsd, 'USD', payMethod, amountCents)
    .run();
  const { results: created } = await db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .bind(meta.last_row_id)
    .all();
  return json({ ok: true, order: created[0], reuse: false, pay: await payInfo(db, created[0]) });
}

// USDT 支付信息：收款地址（从 settings 读，可运营后台配置）
async function payInfo(db, order) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'usdt_address'").first();
  const address = row?.value || '';
  const amountCents = order.amount_cents || order.amount * 100;
  return {
    method: order.pay_method || 'manual',
    usdt_address: address,
    usdt_network: 'TRC20',
    usdt_amount_cents: amountCents,
    usdt_amount_display: (amountCents / 100).toFixed(2),
  };
}

async function handleMyOrders(user, db) {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .bind(user.id)
    .all();
  return json({ ok: true, orders: results });
}

// ========== USDT 自动确认（链上监控） ==========
// 收款地址（TRC20），需在运营后台设置 usdt_address
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRC20 合约

async function fetchTronUsdtTransfers(address, minTimestampMs) {
  // TronGrid 官方 API（免费，无需 key）；only_to 只查入账，min_timestamp 从最早待支付订单开始
  let url = 'https://api.trongrid.io/v1/accounts/' + address +
    '/transactions/trc20?limit=200&contract_address=' + USDT_CONTRACT +
    '&only_to=true&only_confirmed=true';
  if (minTimestampMs) url += '&min_timestamp=' + minTimestampMs;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('tron api ' + res.status);
  const data = await res.json();
  return data.data || [];
}

// 定时任务：扫描待确认的 USDT 订单，按唯一金额匹配链上到账 → 自动确认加字符
async function runUsdtSweeper(db) {
  const cfg = await db.prepare("SELECT value FROM settings WHERE key = 'usdt_address'").first();
  const address = cfg?.value?.trim();
  if (!address) return { ok: false, reason: 'no_usdt_address' };

  // 1. 过期处理：超过 15 分钟未支付的 USDT 订单标记过期
  const expired = await db.prepare(
    "UPDATE orders SET status = 'expired' WHERE status = 'pending' AND pay_method = 'usdt' AND created_at < datetime('now', '-15 minutes')"
  ).run();

  // 2. 待确认的 usdt 订单
  const { results: pendingOrders } = await db
    .prepare("SELECT * FROM orders WHERE status = 'pending' AND pay_method = 'usdt' ORDER BY id ASC")
    .all();
  if (!pendingOrders.length) return { ok: true, scanned: 0, expired: expired.meta.changes };

  // 3. 从最早待支付订单时间开始查链上入账
  const oldest = pendingOrders[0];
  const minTs = Date.parse(oldest.created_at.replace(' ', 'T') + 'Z') - 60000; // 提前 1 分钟兜底
  let transfers = [];
  try { transfers = await fetchTronUsdtTransfers(address, minTs); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }

  const confirmed = [];
  for (const order of pendingOrders) {
    // 该订单的唯一金额（USDT 6 位小数：分 * 10000）
    const targetQuant = BigInt(order.amount_cents || order.amount * 100) * 10000n;
    for (const t of transfers) {
      if (t.to === address && t.quant && BigInt(t.quant) === targetQuant) {
        // 该交易是否已被其他订单使用？（防重复确认）
        const used = await db.prepare("SELECT id FROM orders WHERE tx_id = ? AND id != ?").bind(t.transaction_id, order.id).first();
        if (used) continue;
        const claim = await db.prepare("UPDATE orders SET status = 'processing', tx_id = ? WHERE id = ? AND status = 'pending'")
          .bind(t.transaction_id, order.id).run();
        if (claim.meta.changes !== 1) continue;
        const chars = PLANS[order.plan]?.chars || 0;
        try {
          await db.batch([
            db.prepare('UPDATE users SET quota_chars = quota_chars + ? WHERE id = ?').bind(chars, order.user_id),
            db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status = 'processing'").bind(order.id),
          ]);
        } catch (error) {
          await db.prepare("UPDATE orders SET status = 'pending', tx_id = NULL WHERE id = ? AND status = 'processing'").bind(order.id).run();
          throw error;
        }
        await logAction(db, 'usdt_auto_confirm', '订单#' + order.id + ' USDT 自动确认 $' + (order.amount_cents / 100).toFixed(2) + ' tx:' + String(t.transaction_id || '').slice(0, 16));
        confirmed.push(order.id);
        break;
      }
    }
  }
  return { ok: true, scanned: pendingOrders.length, confirmed, expired: expired.meta.changes };
}

// 管理：确认收款 → 给用户加字符（字符包模式，无到期时间）
async function handleAdminConfirmOrder(request, db, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const { results } = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).all();
  const order = results[0];
  if (!order) return json({ error: 'order_not_found' }, 404);
  if (order.status !== 'pending') return json({ error: 'order_already_processed' }, 400);
  const user = await getUserById(db, order.user_id);
  if (!user) return json({ error: 'user_not_found' }, 404);

  const claim = await db.prepare("UPDATE orders SET status = 'processing' WHERE id = ? AND status = 'pending'").bind(order.id).run();
  if (claim.meta.changes !== 1) return json({ error: 'order_already_processed' }, 409);
  const chars = PLANS[order.plan]?.chars || 0;
  try {
    await db.batch([
      db.prepare('UPDATE users SET quota_chars = quota_chars + ? WHERE id = ?').bind(chars, user.id),
      db.prepare("UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status = 'processing'").bind(order.id),
    ]);
  } catch (error) {
    await db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'processing'").bind(order.id).run();
    throw error;
  }
  const row = await db.prepare('SELECT quota_chars FROM users WHERE id = ?').bind(user.id).first();
  await logAction(db, 'confirm_order', '订单#' + order.id + ' ' + user.email + ' ' + (PLANS[order.plan]?.name || '') + ' +' + chars.toLocaleString() + '字符 $' + order.amount);

  return json({ ok: true, userId: user.id, plan: order.plan, charsAdded: chars, remaining_chars: row.quota_chars });
}

async function handleAdminUsers(db, request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  let stmt = `SELECT id, email, status, quota_chars, created_at FROM users`;
  const binds = [];
  if (q) {
    stmt += ` WHERE email LIKE ?`;
    binds.push(`%${q}%`);
  }
  stmt += ` ORDER BY id DESC LIMIT 100`;
  const { results } = binds.length ? await db.prepare(stmt).bind(...binds).all() : await db.prepare(stmt).all();
  return json({ ok: true, users: results });
}

async function handleAdminOrders(db) {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.user_id, u.email, o.plan, o.amount, o.currency, o.status, o.created_at, o.paid_at
       FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 100`
    )
    .all();
  return json({ ok: true, orders: results });
}

async function handleAdminStats(db) {
  const [users, totalChars, revenue, pending] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM users').first(),
    db.prepare('SELECT COALESCE(SUM(quota_chars),0) AS c FROM users').first(),
    db.prepare(`SELECT COALESCE(SUM(amount),0) AS c FROM orders WHERE status = 'paid'`).first(),
    db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'`).first(),
  ]);
  return json({
    ok: true,
    stats: {
      users: users.c,
      totalChars: totalChars.c,
      revenueUsd: revenue.c,
      pendingOrders: pending.c,
    },
  });
}

async function handleAdminSetUserStatus(db, url, enabled) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const status = enabled ? 'active' : 'disabled';
  const { meta } = await db.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run();
  if (meta.changes === 0) return json({ error: 'user_not_found' }, 404);
  const user = await getUserById(db, id);
  await logAction(db, enabled ? 'enable_user' : 'disable_user', (user?.email || '#' + id) + (enabled ? ' 解封' : ' 封禁'));
  return json({ ok: true, status });
}

// 管理：手动加/减字符（客户直接转账未走订单，或赠送/扣回额度）
async function handleAdminAdjustChars(request, db, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const body = await request.json().catch(() => ({}));
  const delta = Number(body.delta);
  const reason = String(body.reason || '').slice(0, 200);
  if (!Number.isFinite(delta) || delta === 0) return json({ error: 'invalid_delta' }, 400);
  const user = await getUserById(db, id);
  if (!user) return json({ error: 'user_not_found' }, 404);
  if (delta > 0) {
    await db.prepare('UPDATE users SET quota_chars = quota_chars + ? WHERE id = ?').bind(Math.floor(delta), id).run();
  } else {
    await db.prepare('UPDATE users SET quota_chars = MAX(0, quota_chars - ?) WHERE id = ?').bind(Math.floor(-delta), id).run();
  }
  const row = await db.prepare('SELECT quota_chars FROM users WHERE id = ?').bind(id).first();
  await logAction(db, 'adjust_chars', user.email + ' ' + (delta > 0 ? '+' : '') + delta.toLocaleString() + '字符' + (reason ? ' · ' + reason : ''));
  return json({ ok: true, userId: id, delta: Math.floor(delta), remaining_chars: row.quota_chars });
}

// 管理：取消订单（客户没付款/退款）
async function handleAdminCancelOrder(db, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const { meta } = await db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).bind(id).run();
  if (meta.changes === 0) return json({ error: 'order_not_found_or_processed' }, 400);
  await logAction(db, 'cancel_order', '订单#' + id + ' 已取消');
  return json({ ok: true, cancelled: true });
}

// ========== 运营后台 v2 新接口 ==========

async function logAction(db, action, detail) {
  try {
    await db.prepare('INSERT INTO admin_logs (action, detail) VALUES (?, ?)').bind(action, detail).run();
  } catch (e) { /* 日志失败不影响主流程 */ }
}

// 管理：近 N 天注册/收入趋势
async function handleAdminTrends(db, url) {
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const users = await db.prepare(
    'SELECT date(created_at) AS d, COUNT(*) AS c FROM users WHERE created_at >= date(\'now\', ?) GROUP BY d'
  ).bind('-' + days + ' days').all();
  const orders = await db.prepare(
    'SELECT date(paid_at) AS d, COALESCE(SUM(amount),0) AS rev, COUNT(*) AS c FROM orders WHERE status=\'paid\' AND paid_at >= date(\'now\', ?) GROUP BY d'
  ).bind('-' + days + ' days').all();
  return json({ ok: true, days, users: users.results, orders: orders.results });
}

// 管理：设置读取
async function handleAdminGetSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of results) settings[r.key] = r.value;
  return json({ ok: true, settings });
}

// 管理：设置保存
async function handleAdminSaveSettings(request, db) {
  const body = await request.json().catch(() => ({}));
  const allowed = ['contact_tg', 'contact_whatsapp', 'contact_email', 'announcement', 'usdt_address'];
  const keys = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')')
        .bind(k, String(body[k]).slice(0, 500)).run();
      keys.push(k);
    }
  }
  await logAction(db, 'update_settings', '更新设置: ' + keys.join(', '));
  return json({ ok: true, updated: keys });
}

// 管理：操作日志
async function handleAdminLogs(db) {
  const { results } = await db.prepare('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 100').all();
  return json({ ok: true, logs: results });
}

// 管理：用户详情
async function handleAdminUserDetail(db, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const user = await db.prepare('SELECT id, email, status, quota_chars, created_at FROM users WHERE id = ?').bind(id).first();
  if (!user) return json({ error: 'user_not_found' }, 404);
  const { results: orders } = await db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(id).all();
  return json({ ok: true, user, orders });
}

// ========== 管理后台 UI ==========
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>极客 · 运营后台</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; background: #05060a; color: #f2f4f8; min-height: 100vh; display: flex; -webkit-font-smoothing: antialiased; }
  :root { --dim: #9aa3b2; --faint: #5c6470; --accent: #4f8cff; --accent2: #00e5a0; --border: rgba(255,255,255,.08); --card: rgba(255,255,255,.03); }

  /* 侧边栏 */
  .sidebar { width: 220px; min-height: 100vh; background: #0a0d14; border-right: 1px solid var(--border); padding: 24px 16px; position: fixed; top: 0; bottom: 0; left: 0; display: flex; flex-direction: column; z-index: 10; }
  .sb-brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 24px; font-weight: 700; font-size: 16px; }
  .sb-logo { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #1d2438, #0a0d16); border: 1px solid rgba(255,255,255,.12); display: flex; align-items: center; justify-content: center; }
  .sb-logo svg { width: 20px; height: 20px; }
  .sb-item { display: flex; align-items: center; gap: 11px; padding: 11px 14px; border-radius: 10px; color: var(--dim); font-size: 14px; cursor: pointer; margin-bottom: 4px; transition: all .15s; border: 1px solid transparent; }
  .sb-item:hover { background: rgba(255,255,255,.04); color: #f2f4f8; }
  .sb-item.on { background: rgba(79,140,255,.12); color: #8fb7ff; border-color: rgba(79,140,255,.25); }
  .sb-item svg { width: 18px; height: 18px; flex-shrink: 0; }
  .sb-bottom { margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border); }
  .sb-item.logout { color: #f87171; }
  .sb-item.logout:hover { background: rgba(248,113,113,.08); color: #f87171; }

  /* 主区 */
  .main { margin-left: 220px; flex: 1; padding: 28px 32px; min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 26px; }
  .topbar h1 { font-size: 22px; font-weight: 800; letter-spacing: -.3px; }
  .topbar .sub { color: var(--dim); font-size: 13px; margin-top: 4px; }

  /* 统计卡 */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; backdrop-filter: blur(8px); }
  .stat .label { color: var(--dim); font-size: 12.5px; margin-bottom: 8px; }
  .stat .value { font-size: 26px; font-weight: 800; letter-spacing: -.5px; }
  .stat .value.green { color: #4ade80; }
  .stat .value.blue { color: #8fb7ff; }
  .stat .value.yellow { color: #fbbf24; }
  .stat .value.pink { color: #f472b6; }

  /* 图表 */
  .chart-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 22px; }
  .chart-card h3 { font-size: 15px; font-weight: 700; margin-bottom: 16px; }
  .chart { display: flex; align-items: flex-end; gap: 8px; height: 160px; padding-top: 10px; }
  .bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .bar { width: 70%; max-width: 44px; border-radius: 6px 6px 2px 2px; min-height: 3px; transition: height .4s ease; }
  .bar.blue { background: linear-gradient(180deg, #4f8cff, #2d5fd0); }
  .bar.green { background: linear-gradient(180deg, #00e5a0, #00a876); }
  .bar-label { color: var(--faint); font-size: 11px; }
  .bar-val { color: var(--dim); font-size: 11px; font-weight: 600; }

  /* 卡片/表格 */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-bottom: 22px; }
  .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .card-head h3 { font-size: 15px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; color: var(--faint); font-weight: 600; font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .muted { color: var(--faint); }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11.5px; font-weight: 600; }
  .b-active { background: rgba(74,222,128,.12); color: #4ade80; }
  .b-disabled { background: rgba(248,113,113,.12); color: #f87171; }
  .b-pending { background: rgba(251,191,36,.12); color: #fbbf24; }
  .b-paid { background: rgba(74,222,128,.12); color: #4ade80; }
  .b-cancelled { background: rgba(255,255,255,.06); color: var(--faint); }
  button { background: rgba(255,255,255,.06); color: #f2f4f8; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; transition: all .15s; }
  button:hover { background: rgba(255,255,255,.1); }
  button.primary { background: linear-gradient(135deg, #4f8cff, #2d5fd0); border-color: transparent; color: #fff; font-weight: 600; }
  button.primary:hover { opacity: .9; }
  button.danger { background: rgba(248,113,113,.12); border-color: rgba(248,113,113,.3); color: #f87171; }
  button.green { background: rgba(74,222,128,.12); border-color: rgba(74,222,128,.3); color: #4ade80; }
  .row { display: flex; gap: 6px; align-items: center; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  .toolbar input { background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; color: #f2f4f8; font-size: 13px; outline: none; }
  .toolbar input:focus { border-color: rgba(79,140,255,.5); }
  .toolbar input::placeholder { color: var(--faint); }

  /* 设置表单 */
  .field { margin-bottom: 18px; }
  .field label { display: block; color: var(--dim); font-size: 13px; margin-bottom: 7px; }
  .field input, .field textarea { width: 100%; background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 10px; padding: 11px 14px; color: #f2f4f8; font-size: 14px; outline: none; }
  .field input:focus, .field textarea:focus { border-color: rgba(79,140,255,.5); }
  .field textarea { min-height: 80px; resize: vertical; }
  .hint { color: var(--faint); font-size: 12px; margin-top: 5px; }

  /* 日志时间线 */
  .log-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.04); font-size: 13.5px; }
  .log-time { color: var(--faint); font-size: 12px; white-space: nowrap; min-width: 130px; }
  .log-badge { flex-shrink: 0; }

  /* 登录页 */
  #loginView { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #05060a; z-index: 100; }
  .login-card { width: 360px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 36px 32px; text-align: center; }
  .login-card .sb-logo { margin: 0 auto 18px; width: 48px; height: 48px; border-radius: 13px; }
  .login-card h2 { font-size: 20px; margin-bottom: 6px; }
  .login-card .sub { color: var(--dim); font-size: 13px; margin-bottom: 26px; }
  .login-card input { width: 100%; background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: #f2f4f8; font-size: 14px; outline: none; margin-bottom: 16px; }
  .login-card button { width: 100%; padding: 12px; font-size: 14.5px; }
  .login-err { color: #f87171; font-size: 13px; min-height: 20px; margin-top: 10px; }

  /* 视图切换 */
  .view { display: none; }
  .view.on { display: block; }
  @media (max-width: 900px) {
    .sidebar { width: 64px; }
    .sb-brand span, .sb-item span { display: none; }
    .main { margin-left: 64px; padding: 20px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>

<!-- 登录 -->
<div id="loginView">
  <div class="login-card">
    <div class="sb-logo"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="0.55" stop-color="#00e5a0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient><linearGradient id="lw1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7db4ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient><linearGradient id="lw2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5a0"/><stop offset="1" stop-color="#00c48a"/></linearGradient></defs><rect x="31.5" y="9.5" width="20.5" height="14" rx="3.5" fill="rgba(0,229,160,0.08)" stroke="url(#lw2)" stroke-width="1.8"/><circle cx="34.8" cy="12.8" r="1.2" fill="#00e5a0"/><rect x="12.5" y="24.5" width="25.5" height="17" rx="4" fill="rgba(79,140,255,0.1)" stroke="url(#lw1)" stroke-width="1.9"/><circle cx="16" cy="28" r="1.2" fill="#7db4ff"/><path d="M39.5 42 C46 36 48 29.5 46.5 23" fill="none" stroke="url(#lg)" stroke-width="3.4" stroke-linecap="round"/><path d="M49.5 20.5 l-4.8 2.7 l1.6 -5.2 z" fill="url(#lg)"/></svg></div>
    <h2>极客运营后台</h2>
    <div class="sub">付费体系 · 用户 · 订单 · 数据</div>
    <input type="password" id="adminPass" placeholder="管理员密码" autocomplete="current-password">
    <button class="primary" onclick="login()">登 录</button>
    <div class="login-err" id="loginErr"></div>
  </div>
</div>

<!-- 主界面 -->
<div class="sidebar" id="sidebar" style="display:none">
  <div class="sb-brand">
    <div class="sb-logo"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="0.55" stop-color="#00e5a0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient><linearGradient id="lw1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7db4ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient><linearGradient id="lw2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5a0"/><stop offset="1" stop-color="#00c48a"/></linearGradient></defs><rect x="31.5" y="9.5" width="20.5" height="14" rx="3.5" fill="rgba(0,229,160,0.08)" stroke="url(#lw2)" stroke-width="1.8"/><circle cx="34.8" cy="12.8" r="1.2" fill="#00e5a0"/><rect x="12.5" y="24.5" width="25.5" height="17" rx="4" fill="rgba(79,140,255,0.1)" stroke="url(#lw1)" stroke-width="1.9"/><circle cx="16" cy="28" r="1.2" fill="#7db4ff"/><path d="M39.5 42 C46 36 48 29.5 46.5 23" fill="none" stroke="url(#lg2)" stroke-width="3.4" stroke-linecap="round"/><path d="M49.5 20.5 l-4.8 2.7 l1.6 -5.2 z" fill="url(#lg2)"/></svg></div>
    <span>极客运营</span>
  </div>
  <div class="sb-item on" data-view="overview" onclick="switchView('overview')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
    <span>总览</span>
  </div>
  <div class="sb-item" data-view="users" onclick="switchView('users')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    <span>用户</span>
  </div>
  <div class="sb-item" data-view="orders" onclick="switchView('orders')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    <span>订单</span>
  </div>
  <div class="sb-item" data-view="settings" onclick="switchView('settings')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    <span>设置</span>
  </div>
  <div class="sb-item" data-view="logs" onclick="switchView('logs')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
    <span>操作日志</span>
  </div>
  <div class="sb-bottom">
    <div class="sb-item logout" onclick="logout()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
      <span>退出登录</span>
    </div>
  </div>
</div>

<div class="main" id="panelView" style="display:none">
  <!-- 总览 -->
  <div class="view on" id="view-overview">
    <div class="topbar"><div><h1>运营总览</h1><div class="sub">实时数据一览</div></div></div>
    <div class="stats" id="stats"></div>
    <div class="chart-card">
      <h3>近 7 天注册趋势</h3>
      <div class="chart" id="users-chart"></div>
    </div>
    <div class="chart-card">
      <h3>近 7 天收入（USD）</h3>
      <div class="chart" id="revenue-chart"></div>
    </div>
  </div>

  <!-- 用户 -->
  <div class="view" id="view-users">
    <div class="topbar"><div><h1>用户管理</h1><div class="sub">查看用户、调整字符、封禁/解封</div></div></div>
    <div class="card">
      <div class="toolbar">
        <input type="search" id="searchQ" placeholder="搜索邮箱…" onkeydown="if(event.key==='Enter')loadUsers()">
        <button onclick="loadUsers()">搜索</button>
        <button onclick="loadUsers();loadStats()">刷新</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>ID</th><th>邮箱</th><th>状态</th><th>剩余字符</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody id="usersBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 订单 -->
  <div class="view" id="view-orders">
    <div class="topbar"><div><h1>订单管理</h1><div class="sub">确认收款、取消订单</div></div></div>
    <div class="card">
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>ID</th><th>用户</th><th>套餐</th><th>金额(USD)</th><th>状态</th><th>下单时间</th><th>操作</th></tr></thead>
          <tbody id="ordersBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 设置 -->
  <div class="view" id="view-settings">
    <div class="topbar"><div><h1>运营设置</h1><div class="sub">客服联系方式将展示在官网个人中心下单页</div></div></div>
    <div class="card" style="max-width:560px">
      <div class="field">
        <label>Telegram 客服</label>
        <input type="text" id="set-tg" placeholder="@your_support">
        <div class="hint">客户通过 TG 联系你付款</div>
      </div>
      <div class="field">
        <label>WhatsApp 客服</label>
        <input type="text" id="set-wa" placeholder="+1 234 567 8900">
      </div>
      <div class="field">
        <label>联系邮箱</label>
        <input type="email" id="set-email" placeholder="support@example.com">
      </div>
      <div class="field">
        <label>官网公告</label>
        <textarea id="set-ann" placeholder="例如：新用户注册送 2 万字符"></textarea>
        <div class="hint">显示在官网首页</div>
      </div>
      <div class="field">
        <label>USDT 收款地址（TRC20）</label>
        <input type="text" id="set-usdt" placeholder="T...（客户扫码转账到该地址，自动确认到账）">
        <div class="hint">客户下单后显示该地址 + 唯一金额，扫码转账自动到账加字符</div>
      </div>
      <button class="primary" onclick="saveSettings()">保存设置</button>
      <div id="settingsOk" style="color:#4ade80;font-size:13px;margin-top:12px"></div>
      <div id="settingsErr" style="color:#f87171;font-size:13px;margin-top:12px"></div>
    </div>
  </div>

  <!-- 日志 -->
  <div class="view" id="view-logs">
    <div class="topbar"><div><h1>操作日志</h1><div class="sub">管理操作记录（最近 100 条）</div></div></div>
    <div class="card" id="logsBody"></div>
  </div>
</div>

<script>
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function showLogin() { document.getElementById('loginView').style.display = 'flex'; document.getElementById('sidebar').style.display = 'none'; document.getElementById('panelView').style.display = 'none'; }
function showPanel() { document.getElementById('loginView').style.display = 'none'; document.getElementById('sidebar').style.display = 'flex'; document.getElementById('panelView').style.display = 'block'; }

async function login() {
  const pass = document.getElementById('adminPass').value;
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pass }) });
    document.getElementById('loginErr').textContent = '';
    showPanel();
    init();
  } catch (e) { document.getElementById('loginErr').textContent = '密码错误或登录失败'; }
}
document.getElementById('adminPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

async function logout() { await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/admin'; }

function switchView(name) {
  document.querySelectorAll('.sb-item[data-view]').forEach(el => el.classList.toggle('on', el.dataset.view === name));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('on'));
  const v = document.getElementById('view-' + name);
  if (v) v.classList.add('on');
  if (name === 'overview') { loadStats(); loadTrends(); }
  if (name === 'users') loadUsers();
  if (name === 'orders') loadOrders();
  if (name === 'settings') loadSettings();
  if (name === 'logs') loadLogs();
}

// ===== 总览 =====
async function loadStats() {
  try {
    const data = await api('/api/admin/stats');
    const s = data.stats;
    document.getElementById('stats').innerHTML = [
      ['用户总数', s.users, 'blue'],
      ['剩余字符总量', (s.totalChars || 0).toLocaleString(), 'green'],
      ['累计收入', '$' + (s.revenueUsd || 0), 'pink'],
      ['待确认订单', s.pendingOrders, 'yellow'],
    ].map(([label, value, cls]) => \`<div class="stat"><div class="label">\${label}</div><div class="value \${cls}">\${value}</div></div>\`).join('');
  } catch (e) { console.error(e); }
}

async function loadTrends() {
  try {
    const data = await api('/api/admin/trends?days=7');
    // 注册趋势
    const umap = {}; for (const u of data.users) umap[u.d] = u.c;
    const rmap = {}; for (const o of data.orders) rmap[o.d] = { rev: o.rev, c: o.c };
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push(d);
    }
    const usersChart = days.map(d => \`<div class="bar-wrap"><div class="bar blue" style="height:\${Math.max(3, (umap[d] || 0) * 28)}px"></div><div class="bar-val">\${umap[d] || 0}</div><div class="bar-label">\${d.slice(5)}</div></div>\`).join('');
    const maxRev = Math.max(1, ...days.map(d => rmap[d]?.rev || 0));
    const revChart = days.map(d => {
      const rev = rmap[d]?.rev || 0;
      return \`<div class="bar-wrap"><div class="bar green" style="height:\${Math.max(3, rev / maxRev * 130)}px"></div><div class="bar-val">$\${rev}</div><div class="bar-label">\${d.slice(5)}</div></div>\`;
    }).join('');
    document.getElementById('users-chart').innerHTML = usersChart;
    document.getElementById('revenue-chart').innerHTML = revChart;
  } catch (e) { console.error(e); }
}

// ===== 用户 =====
async function loadUsers() {
  try {
    const q = document.getElementById('searchQ').value.trim();
    const data = await api('/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    document.getElementById('usersBody').innerHTML = data.users.map(u => {
      const st = u.status === 'disabled' ? '<span class="badge b-disabled">已封禁</span>' : '<span class="badge b-active">正常</span>';
      return '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td>' + st + '</td>' +
        '<td>' + (u.quota_chars != null ? u.quota_chars.toLocaleString() : '—') + '</td>' +
        '<td class="muted">' + esc((u.created_at || '').slice(0, 10)) + '</td>' +
        '<td class="row">' +
          '<button onclick="viewUser(' + u.id + ')">详情</button>' +
          '<button class="green" onclick="adjustChars(' + u.id + ', &#39;' + esc(u.email) + '&#39;)">加字符</button>' +
          (u.status === 'disabled'
            ? '<button onclick="setUser(' + u.id + ', true)">解封</button>'
            : '<button class="danger" onclick="setUser(' + u.id + ', false)">封禁</button>') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">暂无用户</td></tr>';
  } catch (e) { console.error(e); }
}

async function viewUser(id) {
  try {
    const data = await api('/api/admin/users/' + id);
    const u = data.user;
    const orders = data.orders || [];
    const detail = [
      '用户 #' + u.id + ' · ' + esc(u.email),
      '状态：' + (u.status === 'disabled' ? '已封禁' : '正常'),
      '剩余字符：' + (u.quota_chars || 0).toLocaleString(),
      '注册时间：' + esc(u.created_at || ''),
      '',
      '订单记录（' + orders.length + ' 条）：',
      ...orders.map(o => '  #' + o.id + ' ' + (PLAN_NAMES[o.plan] || o.plan) + ' $' + o.amount + ' ' + (o.status === 'paid' ? '已收款' : o.status === 'cancelled' ? '已取消' : '待确认') + ' ' + esc((o.created_at || '').slice(0, 10))),
    ].join('\\n');
    alert(detail);
  } catch (e) { alert('加载失败：' + e.message); }
}

async function setUser(id, enabled) {
  const act = enabled ? 'enable' : 'disable';
  if (!enabled && !confirm('确认封禁该用户？封禁后无法登录。')) return;
  try {
    await api('/api/admin/users/' + id + '/' + act, { method: 'POST' });
    loadUsers(); loadStats(); loadLogs();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function adjustChars(id, email) {
  const delta = prompt('用户：' + email + '\\n输入字符数（加用正数，扣回用负数）\\n例如：1000000 或 -500000');
  if (delta === null || delta === '') return;
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) { alert('请输入有效数字'); return; }
  const reason = prompt('备注原因（可选）', n > 0 ? '客户转账' : '扣回');
  try {
    const data = await api('/api/admin/users/' + id + '/adjust', { method: 'POST', body: JSON.stringify({ delta: n, reason: reason || '' }) });
    alert('已调整 ' + (n > 0 ? '+' : '') + n.toLocaleString() + ' 字符，当前剩余 ' + (data.remaining_chars || 0).toLocaleString());
    loadUsers(); loadStats(); loadLogs();
  } catch (e) { alert('操作失败：' + e.message); }
}

// ===== 订单 =====
const PLAN_NAMES = { basic: '基础包 · 100万', standard: '标准包 · 150万', pro: '大包 · 450万' };
async function loadOrders() {
  try {
    const data = await api('/api/admin/orders');
    document.getElementById('ordersBody').innerHTML = data.orders.map(o => {
      const p = PLAN_NAMES[o.plan] || o.plan;
      const badge = o.status === 'paid' ? '<span class="badge b-paid">已收款</span>' : o.status === 'cancelled' ? '<span class="badge b-cancelled">已取消</span>' : '<span class="badge b-pending">待确认</span>';
      return '<tr>' +
        '<td>' + o.id + '</td>' +
        '<td>' + esc(o.email || ('用户#' + o.user_id)) + '</td>' +
        '<td>' + p + '</td>' +
        '<td>$' + o.amount + '</td>' +
        '<td>' + badge + '</td>' +
        '<td class="muted">' + esc((o.created_at || '').slice(0, 16)) + '</td>' +
        '<td>' + (o.status === 'pending' ? '<button class="primary" onclick="confirmOrder(' + o.id + ')">确认收款</button> <button onclick="cancelOrder(' + o.id + ')">取消</button>' : '<span class="muted">—</span>') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">暂无订单</td></tr>';
  } catch (e) { console.error(e); }
}

async function confirmOrder(id) {
  if (!confirm('确认已收到该笔款项并给用户加字符？')) return;
  try {
    const data = await api('/api/admin/orders/' + id + '/confirm', { method: 'POST' });
    alert('已加字符：' + (data.charsAdded || 0).toLocaleString() + '，当前剩余 ' + (data.remaining_chars || 0).toLocaleString());
    loadOrders(); loadStats(); loadUsers(); loadLogs();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function cancelOrder(id) {
  if (!confirm('确认取消该订单？')) return;
  try {
    await api('/api/admin/orders/' + id + '/cancel', { method: 'POST' });
    loadOrders(); loadLogs();
  } catch (e) { alert('操作失败：' + e.message); }
}

// ===== 设置 =====
async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    const s = data.settings || {};
    document.getElementById('set-tg').value = s.contact_tg || '';
    document.getElementById('set-wa').value = s.contact_whatsapp || '';
    document.getElementById('set-email').value = s.contact_email || '';
    document.getElementById('set-ann').value = s.announcement || '';
    document.getElementById('set-usdt').value = s.usdt_address || '';
  } catch (e) { console.error(e); }
}
async function saveSettings() {
  const ok = document.getElementById('settingsOk'); const er = document.getElementById('settingsErr');
  ok.textContent = ''; er.textContent = '';
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
      contact_tg: document.getElementById('set-tg').value.trim(),
      contact_whatsapp: document.getElementById('set-wa').value.trim(),
      contact_email: document.getElementById('set-email').value.trim(),
      announcement: document.getElementById('set-ann').value.trim(),
      usdt_address: document.getElementById('set-usdt').value.trim(),
    }) });
    ok.textContent = '✓ 设置已保存';
    loadLogs();
  } catch (e) { er.textContent = '保存失败：' + e.message; }
}

// ===== 日志 =====
async function loadLogs() {
  try {
    const data = await api('/api/admin/logs');
    const badges = {
      confirm_order: '<span class="badge b-paid">确认收款</span>',
      adjust_chars: '<span class="badge b-active">调字符</span>',
      disable_user: '<span class="badge b-disabled">封禁</span>',
      enable_user: '<span class="badge b-active">解封</span>',
      cancel_order: '<span class="badge b-cancelled">取消订单</span>',
      update_settings: '<span class="badge b-pending">设置</span>',
    };
    document.getElementById('logsBody').innerHTML = (data.logs || []).map(l =>
      '<div class="log-item"><span class="log-time">' + esc((l.created_at || '').slice(0, 16)) + '</span>' +
      (badges[l.action] || '<span class="badge">' + esc(l.action) + '</span>') +
      '<span>' + esc(l.detail || '') + '</span></div>'
    ).join('') || '<div class="muted" style="text-align:center;padding:24px">暂无操作记录</div>';
  } catch (e) { console.error(e); }
}

// ===== 初始化 =====
async function init() {
  loadStats();
  loadTrends();
}
(async () => {
  try {
    await api('/api/admin/stats');
    showPanel();
    init();
  } catch { showLogin(); }
})();
</script>
</body>
</html>`;

async function handleAdminLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  const maxAge = 60 * 60 * 12;
  const token = await signJwt({ admin: true, kind: 'admin', exp: Math.floor(Date.now() / 1000) + maxAge }, env.JWT_SECRET);
  return withCookie(json({ ok: true }), authCookie('geek_admin_session', token, maxAge));
}

// 管理员鉴权
async function requireAdmin(request, env) {
  const token = adminAuthToken(request);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  return payload && payload.admin ? payload : null;
}

// 用户鉴权
async function requireUser(request, db, env) {
  const token = authToken(request);
  if (!token) return { error: json({ error: 'unauthorized' }, 401) };
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !payload.uid) return { error: json({ error: 'unauthorized' }, 401) };
  const user = await getUserById(db, payload.uid);
  if (!user) return { error: json({ error: 'user_not_found' }, 404) };
  if ((user.token_version || 0) > 0 && payload.ver !== user.token_version) return { error: json({ error: 'session_revoked' }, 401) };
  if (user.status === 'disabled') return { error: json({ error: 'account_disabled' }, 403) };
  return { user };
}

// ========== 安全防护 ==========

// 获取客户端 IP（Cloudflare 会设置 CF-Connecting-IP）
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// 速率限制：limit 次 / windowSec 秒，超限返回 true
async function rateLimited(db, bucket, limit, windowSec) {
  const now = Date.now();
  const cutoff = new Date(now - windowSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  // 清理旧记录
  await db.prepare("DELETE FROM rate_limits WHERE updated_at < ?").bind(cutoff).run();
  const row = await db.prepare("SELECT count FROM rate_limits WHERE bucket = ?").bind(bucket).first();
  if (!row) {
    await db.prepare("INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?)").bind(bucket, new Date(now).toISOString().slice(0, 19).replace('T', ' ')).run();
    return false;
  }
  if (row.count >= limit) return true;
  await db.prepare("UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?").bind(new Date(now).toISOString().slice(0, 19).replace('T', ' '), bucket).run();
  return false;
}

// 管理后台登录防爆破：失败 5 次锁 15 分钟
async function adminLoginBlocked(db, ip) {
  const row = await db.prepare("SELECT fails, locked_until FROM admin_login_attempts WHERE ip = ?").bind(ip).first();
  if (row?.locked_until && row.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ')) return true;
  if (row?.fails >= 5) {
    await db.prepare("UPDATE admin_login_attempts SET locked_until = ?, fails = 0 WHERE ip = ?")
      .bind(new Date(Date.now() + 15 * 60000).toISOString().slice(0, 19).replace('T', ' '), ip).run();
    return true;
  }
  return false;
}

async function adminLoginFail(db, ip) {
  await db.prepare(
    "INSERT INTO admin_login_attempts (ip, fails, locked_until) VALUES (?, 1, NULL) " +
    "ON CONFLICT(ip) DO UPDATE SET fails = fails + 1"
  ).bind(ip).run();
}

async function adminLoginOk(db, ip) {
  await db.prepare("DELETE FROM admin_login_attempts WHERE ip = ?").bind(ip).run();
}

// ========== 入口 ==========
export default {
  async scheduled(event, env, ctx) {
    // 定时任务：USDT 链上监控（每分钟）
    const db = env.geek_subscriptions;
    try {
      const result = await runUsdtSweeper(db);
      console.log('usdt sweeper:', JSON.stringify(result));
    } catch (e) {
      console.error('usdt sweeper error:', String(e.message || e));
    }
    ctx.waitUntil(Promise.resolve());
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();
    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.geek_subscriptions;

    // 健康检查
    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, service: 'geek-subscription' });
    }

    // 管理后台页面
    if (request.method === 'GET' && path === '/admin') {
      return new Response(ADMIN_HTML, { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      } });
    }

    // ---- 公开接口（带速率限制防刷）----
    if (request.method === 'POST' && path === '/api/register') {
      const ip = clientIp(request);
      if (await rateLimited(db, 'reg:' + ip, 5, 60)) return json({ error: 'rate_limited' }, 429);
      return handleRegister(request, db);
    }
    if (request.method === 'POST' && path === '/api/login') {
      const ip = clientIp(request);
      if (await rateLimited(db, 'login:' + ip, 10, 60)) return json({ error: 'rate_limited' }, 429);
      return handleLogin(request, db, env);
    }
    if (request.method === 'POST' && path === '/api/password-reset/request') {
      const ip = clientIp(request);
      if (await rateLimited(db, 'reset-request:' + ip, 3, 3600)) return json({ error: 'rate_limited' }, 429);
      return handlePasswordResetRequest(request, db, env);
    }
    if (request.method === 'POST' && path === '/api/password-reset/complete') {
      const ip = clientIp(request);
      if (await rateLimited(db, 'reset-complete:' + ip, 10, 3600)) return json({ error: 'rate_limited' }, 429);
      return handlePasswordResetComplete(request, db);
    }

    // ---- 管理接口 ----
    if (path.startsWith('/api/admin')) {
      if (request.method === 'POST' && path === '/api/admin/login') {
        const ip = clientIp(request);
        if (await adminLoginBlocked(db, ip)) return json({ error: 'too_many_attempts' }, 429);
        const result = await handleAdminLogin(request, env);
        if (result && result.status === 200) await adminLoginOk(db, ip);
        else await adminLoginFail(db, ip);
        return result;
      }
      if (request.method === 'POST' && path === '/api/admin/logout') {
        return withCookie(json({ ok: true }), authCookie('geek_admin_session', '', 0));
      }
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'POST' && !csrfAllowed(request)) return json({ error: 'invalid_origin' }, 403);
      if (request.method === 'GET' && path === '/api/admin/users') return handleAdminUsers(db, request);
      if (request.method === 'GET' && path === '/api/admin/orders') return handleAdminOrders(db);
      if (request.method === 'GET' && path === '/api/admin/stats') return handleAdminStats(db);
      if (request.method === 'GET' && path === '/api/admin/trends') return handleAdminTrends(db, url);
      if (request.method === 'GET' && path === '/api/admin/settings') return handleAdminGetSettings(db);
      if (request.method === 'POST' && path === '/api/admin/settings') return handleAdminSaveSettings(request, db);
      if (request.method === 'GET' && path === '/api/admin/logs') return handleAdminLogs(db);
      if (request.method === 'GET' && path === '/api/admin/password-resets') return handleAdminPasswordResets(db);
      if (request.method === 'POST' && /^\/api\/admin\/password-resets\/\d+\/issue$/.test(path)) return handleAdminIssuePasswordReset(db, env, url);
      if (request.method === 'GET' && /^\/api\/admin\/users\/\d+$/.test(path)) return handleAdminUserDetail(db, url);
      if (request.method === 'POST' && /^\/api\/admin\/orders\/\d+\/confirm$/.test(path)) return handleAdminConfirmOrder(request, db, url);
      if (request.method === 'POST' && /^\/api\/admin\/orders\/\d+\/cancel$/.test(path)) return handleAdminCancelOrder(db, url);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/adjust$/.test(path)) return handleAdminAdjustChars(request, db, url);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/disable$/.test(path)) return handleAdminSetUserStatus(db, url, false);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/enable$/.test(path)) return handleAdminSetUserStatus(db, url, true);
      return json({ error: 'not_found' }, 404);
    }

    // ---- 用户接口 ----
    if (request.method === 'POST' && path === '/api/logout') {
      return withCookie(json({ ok: true }), authCookie('geek_session', '', 0));
    }
    const auth = await requireUser(request, db, env);
    if (auth.error) return auth.error;
    const user = auth.user;
    if (request.method === 'POST' && !csrfAllowed(request)) return json({ error: 'invalid_origin' }, 403);

    if (request.method === 'GET' && path === '/api/me') return handleMe(user, db);
    if (request.method === 'GET' && path === '/api/status') return handleStatus(user, db);
    if (request.method === 'GET' && path === '/api/quota') return handleQuota(user, db);
    if (request.method === 'POST' && path === '/api/translation-token') return handleTranslationToken(user, env);
    if (request.method === 'POST' && path === '/api/usage') return handleUsage(user, db, request);
    if (request.method === 'POST' && path === '/api/orders') return handleCreateOrder(user, db, request);
    if (request.method === 'GET' && path === '/api/orders') return handleMyOrders(user, db);

    return json({ error: 'not_found' }, 404);
  },
};
