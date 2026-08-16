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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

async function verifyPassword(password, saltHex, expectedHash) {
  const { hash } = await hashPassword(password, saltHex);
  return hash === expectedHash;
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
  return m ? m[1] : null;
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
  if (password.length < 6) return json({ error: 'password_too_short' }, 400);
  if (await getUserByEmail(db, email)) return json({ error: 'email_exists' }, 409);
  const { salt, hash } = await hashPassword(password);
  const { meta } = await db
    .prepare('INSERT INTO users (email, password_hash, password_salt, quota_chars) VALUES (?, ?, ?, ?)')
    .bind(email, hash, salt, FREE_QUOTA_CHARS)
    .run();
  const userId = meta.last_row_id;
  return json({ ok: true, userId });
}

async function handleLogin(request, db, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await getUserByEmail(db, email);
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    return json({ error: 'invalid_credentials' }, 401);
  }
  if (user.status === 'disabled') return json({ error: 'account_disabled' }, 403);
  const token = await signJwt({ uid: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 }, env.JWT_SECRET);
  return json({ ok: true, token, user: { id: user.id, email: user.email } });
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
  if (!PLANS[plan]) return json({ error: 'invalid_plan' }, 400);
  const p = PLANS[plan];
  // 已有该套餐的 pending 订单则复用，避免重复下单
  const { results } = await db
    .prepare(`SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`)
    .bind(user.id, plan)
    .all();
  if (results[0]) return json({ ok: true, order: results[0], reuse: true });
  const { meta } = await db
    .prepare('INSERT INTO orders (user_id, plan, amount, currency) VALUES (?, ?, ?, ?)')
    .bind(user.id, plan, p.priceUsd, 'USD')
    .run();
  const { results: created } = await db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .bind(meta.last_row_id)
    .all();
  return json({ ok: true, order: created[0], reuse: false });
}

async function handleMyOrders(user, db) {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .bind(user.id)
    .all();
  return json({ ok: true, orders: results });
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

  const chars = PLANS[order.plan]?.chars || 0;
  await db.prepare('UPDATE users SET quota_chars = quota_chars + ? WHERE id = ?').bind(chars, user.id).run();
  await db.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).bind(order.id).run();
  const row = await db.prepare('SELECT quota_chars FROM users WHERE id = ?').bind(user.id).first();

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
  return json({ ok: true, userId: id, delta: Math.floor(delta), remaining_chars: row.quota_chars });
}

// 管理：取消订单（客户没付款/退款）
async function handleAdminCancelOrder(db, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2];
  const { meta } = await db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).bind(id).run();
  if (meta.changes === 0) return json({ error: 'order_not_found_or_processed' }, 400);
  return json({ ok: true, cancelled: true });
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
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0d10; color: #e8eaed; min-height: 100vh; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px 60px; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
  .sub { color: #8a919c; font-size: 13px; margin-bottom: 24px; }
  .card { background: #14171c; border: 1px solid #23272f; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .stat { background: #14171c; border: 1px solid #23272f; border-radius: 12px; padding: 16px; }
  .stat .n { font-size: 26px; font-weight: 700; }
  .stat .l { font-size: 12px; color: #8a919c; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #8a919c; font-weight: 500; padding: 8px; border-bottom: 1px solid #23272f; }
  td { padding: 8px; border-bottom: 1px solid #1a1e24; vertical-align: middle; }
  tr:hover td { background: #171b21; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 500; }
  .b-active { background: #0f2e1c; color: #4ade80; }
  .b-disabled { background: #331414; color: #f87171; }
  .b-pending { background: #2d2408; color: #fbbf24; }
  .b-paid { background: #0f2e1c; color: #4ade80; }
  .b-cancelled { background: #23272f; color: #8a919c; }
  button { background: #23272f; color: #e8eaed; border: 1px solid #2f3540; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
  button:hover { background: #2c313b; }
  button.primary { background: #16a34a; border-color: #16a34a; color: #fff; }
  button.primary:hover { background: #15803d; }
  button.danger { background: #7f1d1d; border-color: #7f1d1d; color: #fff; }
  button.danger:hover { background: #991b1b; }
  input[type=email], input[type=password], input[type=search] { background: #0e1116; border: 1px solid #2f3540; border-radius: 8px; padding: 9px 12px; color: #e8eaed; font-size: 14px; width: 100%; outline: none; }
  input:focus { border-color: #16a34a; }
  .login-box { max-width: 360px; margin: 120px auto; }
  .login-box h2 { margin-bottom: 16px; font-size: 18px; }
  .login-box input { margin-bottom: 12px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .muted { color: #8a919c; font-size: 12px; }
  .err { color: #f87171; font-size: 13px; margin-top: 8px; }
  .ok { color: #4ade80; font-size: 13px; margin-top: 8px; }
  .toolbar { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; }
  .toolbar input { max-width: 260px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tab { padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; background: #14171c; border: 1px solid #23272f; color: #8a919c; }
  .tab.on { background: #16a34a; border-color: #16a34a; color: #fff; }
  .logout { float: right; }
</style>
</head>
<body>
<div class="wrap" id="loginView" style="display:none">
  <div class="login-box card">
    <h2>极客订阅管理后台</h2>
    <input type="password" id="adminPass" placeholder="管理员密码">
    <button class="primary" style="width:100%; padding:10px" onclick="login()">登录</button>
    <div id="loginErr" class="err"></div>
  </div>
</div>

<div class="wrap" id="panelView" style="display:none">
  <div class="row" style="justify-content:space-between">
    <div>
      <h1>极客运营后台</h1>
      <div class="sub">付费体系 · 用户 · 订单 · 字符管理</div>
    </div>
    <button onclick="logout()" class="logout">退出</button>
  </div>

  <div class="stats" id="stats"></div>

  <div class="tabs">
    <div class="tab on" data-tab="users" onclick="switchTab('users')">用户</div>
    <div class="tab" data-tab="orders" onclick="switchTab('orders')">订单</div>
  </div>

  <div id="usersView">
    <div class="toolbar">
      <input type="search" id="searchQ" placeholder="搜索邮箱…" onkeydown="if(event.key==='Enter')loadUsers()">
      <button onclick="loadUsers()">搜索</button>
      <button onclick="loadStats()">刷新统计</button>
    </div>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr><th>ID</th><th>邮箱</th><th>状态</th><th>剩余字符</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody id="usersBody"></tbody>
      </table>
    </div>
  </div>

  <div id="ordersView" style="display:none">
    <div class="card" style="overflow-x:auto">
      <table>
        <thead><tr><th>ID</th><th>用户</th><th>套餐</th><th>金额(USD)</th><th>状态</th><th>下单时间</th><th>操作</th></tr></thead>
        <tbody id="ordersBody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
const TOKEN_KEY = 'geek_admin_token';
let token = localStorage.getItem(TOKEN_KEY) || '';

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function showLogin() { document.getElementById('loginView').style.display = 'block'; document.getElementById('panelView').style.display = 'none'; }
function showPanel() { document.getElementById('loginView').style.display = 'none'; document.getElementById('panelView').style.display = 'block'; }

async function login() {
  const pass = document.getElementById('adminPass').value;
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pass }) });
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    document.getElementById('loginErr').textContent = '';
    showPanel();
    init();
  } catch (e) {
    document.getElementById('loginErr').textContent = '密码错误或登录失败：' + e.message;
  }
}

function logout() { localStorage.removeItem(TOKEN_KEY); token = ''; showLogin(); }

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  document.getElementById('usersView').style.display = name === 'users' ? 'block' : 'none';
  document.getElementById('ordersView').style.display = name === 'orders' ? 'block' : 'none';
  if (name === 'orders') loadOrders();
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function loadStats() {
  try {
    const data = await api('/api/admin/stats');
    const s = data.stats;
    document.getElementById('stats').innerHTML = [
      ['用户总数', s.users],
      ['剩余字符总量', (s.totalChars || 0).toLocaleString()],
      ['累计收入', '$' + s.revenueUsd],
      ['待确认订单', s.pendingOrders],
    ].map(([l, n]) => '<div class="stat"><div class="n">' + esc(n) + '</div><div class="l">' + l + '</div></div>').join('');
  } catch (e) { console.error(e); }
}

async function loadUsers() {
  const q = document.getElementById('searchQ').value.trim();
  try {
    const data = await api('/api/admin/users?q=' + encodeURIComponent(q));
    document.getElementById('usersBody').innerHTML = (data.users || []).map((u) => {
      return '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td><span class="badge ' + (u.status === 'disabled' ? 'b-disabled' : 'b-active') + '">' + (u.status === 'disabled' ? '封禁' : '正常') + '</span></td>' +
        '<td>' + (u.quota_chars != null ? u.quota_chars.toLocaleString() + ' 字符' : '—') + '</td>' +
        '<td class="muted">' + esc((u.created_at || '').slice(0, 10)) + '</td>' +
        '<td class="row">' +
          '<button onclick="adjustChars(' + u.id + ', \'' + esc(u.email) + '\')">加字符</button>' +
          (u.status === 'disabled'
            ? '<button onclick="setUser(' + u.id + ', true)">解封</button>'
            : '<button class="danger" onclick="setUser(' + u.id + ', false)">封禁</button>') +
        '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">暂无用户</td></tr>';
  } catch (e) { console.error(e); }
}

async function setUser(id, enabled) {
  const act = enabled ? 'enable' : 'disable';
  if (!enabled && !confirm('确认封禁该用户？封禁后无法登录。')) return;
  try {
    await api('/api/admin/users/' + id + '/' + act, { method: 'POST' });
    loadUsers(); loadStats();
  } catch (e) { alert('操作失败：' + e.message); }
}

// 手动加/减字符（客户直接转账或赠送/扣回）
async function adjustChars(id, email) {
  const delta = prompt('用户：' + email + '\n输入字符数（加用正数，扣回用负数）\n例如：1000000 或 -500000');
  if (delta === null || delta === '') return;
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) { alert('请输入有效数字'); return; }
  const reason = prompt('备注原因（可选）', n > 0 ? '客户转账' : '扣回');
  try {
    const data = await api('/api/admin/users/' + id + '/adjust', { method: 'POST', body: JSON.stringify({ delta: n, reason: reason || '' }) });
    alert('已调整 ' + (n > 0 ? '+' : '') + n.toLocaleString() + ' 字符，当前剩余 ' + (data.remaining_chars || 0).toLocaleString());
    loadUsers(); loadStats();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function loadOrders() {
  try {
    const data = await api('/api/admin/orders');
    document.getElementById('ordersBody').innerHTML = (data.orders || []).map((o) => {
      const p = PLAN_NAMES[o.plan] || o.plan;
      return '<tr>' +
        '<td>' + o.id + '</td>' +
        '<td>' + esc(o.email || ('用户#' + o.user_id)) + '</td>' +
        '<td>' + p + '</td>' +
        '<td>$' + o.amount + '</td>' +
        '<td><span class="badge ' + (o.status === 'paid' ? 'b-paid' : o.status === 'cancelled' ? 'b-cancelled' : 'b-pending') + '">' + (o.status === 'paid' ? '已收款' : o.status === 'cancelled' ? '已取消' : '待确认') + '</span></td>' +
        '<td class="muted">' + esc((o.created_at || '').slice(0, 16)) + '</td>' +
        '<td>' + (o.status === 'pending' ? '<button class="primary" onclick="confirmOrder(' + o.id + ')">确认收款·加字符</button> <button onclick="cancelOrder(' + o.id + ')">取消</button>' : '<span class="muted">' + esc(o.status === 'paid' ? '已收款 ' + (o.paid_at || '').slice(0, 16) : '已取消') + '</span>') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7" class="muted">暂无订单</td></tr>';
  } catch (e) { console.error(e); }
}

async function confirmOrder(id) {
  if (!confirm('确认已收到该笔款项并给用户加字符？')) return;
  try {
    const data = await api('/api/admin/orders/' + id + '/confirm', { method: 'POST' });
    alert('已加字符：' + (data.charsAdded || 0).toLocaleString() + '，当前剩余 ' + (data.remaining_chars || 0).toLocaleString());
    loadOrders(); loadStats(); loadUsers();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function cancelOrder(id) {
  if (!confirm('确认取消该订单？')) return;
  try {
    await api('/api/admin/orders/' + id + '/cancel', { method: 'POST' });
    loadOrders();
  } catch (e) { alert('操作失败：' + e.message); }
}

const PLAN_NAMES = { basic: '基础包', standard: '标准包', pro: '大包' };

async function init() {
  await Promise.all([loadStats(), loadUsers()]);
}

(async () => {
  if (token) {
    try { await api('/api/admin/stats'); showPanel(); init(); }
    catch (e) { showLogin(); }
  } else { showLogin(); }
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
  const token = await signJwt({ admin: true, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
  return json({ ok: true, token });
}

// 管理员鉴权
async function requireAdmin(request, env) {
  const token = authToken(request);
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
  if (user.status === 'disabled') return { error: json({ error: 'account_disabled' }, 403) };
  return { user };
}

// ========== 入口 ==========
export default {
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
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // ---- 公开接口 ----
    if (request.method === 'POST' && path === '/api/register') return handleRegister(request, db);
    if (request.method === 'POST' && path === '/api/login') return handleLogin(request, db, env);

    // ---- 管理接口 ----
    if (path.startsWith('/api/admin')) {
      if (request.method === 'POST' && path === '/api/admin/login') return handleAdminLogin(request, env);
      const admin = await requireAdmin(request, env);
      if (!admin) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'GET' && path === '/api/admin/users') return handleAdminUsers(db, request);
      if (request.method === 'GET' && path === '/api/admin/orders') return handleAdminOrders(db);
      if (request.method === 'GET' && path === '/api/admin/stats') return handleAdminStats(db);
      if (request.method === 'POST' && /^\/api\/admin\/orders\/\d+\/confirm$/.test(path)) return handleAdminConfirmOrder(request, db, url);
      if (request.method === 'POST' && /^\/api\/admin\/orders\/\d+\/cancel$/.test(path)) return handleAdminCancelOrder(db, url);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/adjust$/.test(path)) return handleAdminAdjustChars(request, db, url);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/disable$/.test(path)) return handleAdminSetUserStatus(db, url, false);
      if (request.method === 'POST' && /^\/api\/admin\/users\/\d+\/enable$/.test(path)) return handleAdminSetUserStatus(db, url, true);
      return json({ error: 'not_found' }, 404);
    }

    // ---- 用户接口 ----
    const auth = await requireUser(request, db, env);
    if (auth.error) return auth.error;
    const user = auth.user;

    if (request.method === 'GET' && path === '/api/me') return handleMe(user, db);
    if (request.method === 'GET' && path === '/api/status') return handleStatus(user, db);
    if (request.method === 'GET' && path === '/api/quota') return handleQuota(user, db);
    if (request.method === 'POST' && path === '/api/usage') return handleUsage(user, db, request);
    if (request.method === 'POST' && path === '/api/orders') return handleCreateOrder(user, db, request);
    if (request.method === 'GET' && path === '/api/orders') return handleMyOrders(user, db);

    return json({ error: 'not_found' }, 404);
  },
};
