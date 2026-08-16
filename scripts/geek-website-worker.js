// geek-website Worker —— 极客官网（营销页 + 下载 + 定价 + 登录跳转）
// 部署在 geek.bbnba.com；动态功能（登录/注册/余额/下单）调用 geek-subscription API
// 静态页面直接内嵌返回，零成本、全球 CDN

const API_BASE = 'https://geek-subscription.9529360.workers.dev';
const VERSION = '1.1.0';

const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>极客 Geek · 多平台多账号聊天客户端</title>
<meta name="description" content="极客 Geek —— WhatsApp / Telegram / LINE 多平台多账号聊天客户端，实时翻译、群发、群组工具，出海必备。">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0d10; color: #e8eaed; min-height: 100vh; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 80px; }
  nav { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 32px; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 18px; }
  .logo svg { width: 32px; height: 32px; }
  .nav-links { display: flex; gap: 24px; align-items: center; }
  .nav-links a { color: #8a919c; text-decoration: none; font-size: 14px; transition: color .15s; }
  .nav-links a:hover { color: #00d4ff; }
  .btn { display: inline-block; padding: 10px 22px; border-radius: 10px; font-size: 14px; font-weight: 500; text-decoration: none; transition: all .15s; }
  .btn-primary { background: linear-gradient(135deg, #00d4ff, #00a3cc); color: #06121a; font-weight: 600; }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,212,255,0.3); }
  .btn-ghost { border: 1px solid #232833; color: #e8eaed; }
  .btn-ghost:hover { border-color: #00d4ff; color: #00d4ff; }
  .hero { text-align: center; padding: 60px 0 40px; }
  .hero h1 { font-size: 44px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 16px; }
  .hero h1 span { background: linear-gradient(90deg, #00d4ff, #7c8cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .hero p { color: #8a919c; font-size: 17px; max-width: 640px; margin: 0 auto 32px; line-height: 1.7; }
  .hero .btns { display: flex; gap: 14px; justify-content: center; }
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 48px 0; }
  .feature { background: #14171c; border: 1px solid #23272f; border-radius: 14px; padding: 24px; }
  .feature .icon { font-size: 26px; margin-bottom: 12px; }
  .feature h3 { font-size: 16px; margin-bottom: 8px; }
  .feature p { color: #8a919c; font-size: 13.5px; line-height: 1.6; }
  .platforms { text-align: center; padding: 24px 0 40px; }
  .platforms .tags { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 16px; }
  .tag { padding: 6px 14px; border-radius: 20px; background: #14171c; border: 1px solid #23272f; font-size: 13px; color: #8a919c; }
  .pricing { text-align: center; padding: 40px 0; }
  .pricing h2 { font-size: 28px; margin-bottom: 8px; }
  .pricing .sub { color: #8a919c; font-size: 14px; margin-bottom: 32px; }
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .plan { background: #14171c; border: 1px solid #23272f; border-radius: 14px; padding: 28px 20px; text-align: center; position: relative; }
  .plan.hot { border-color: #00d4ff; }
  .plan .p-name { font-size: 16px; font-weight: 600; }
  .plan .p-price { font-size: 34px; font-weight: 700; margin: 12px 0 4px; }
  .plan .p-price span { font-size: 14px; color: #8a919c; font-weight: 400; }
  .plan .p-desc { color: #8a919c; font-size: 13px; margin-bottom: 18px; }
  .plan .badge { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #00d4ff; color: #06121a; font-size: 11px; padding: 3px 12px; border-radius: 20px; font-weight: 600; }
  .footer { text-align: center; color: #5b616b; font-size: 12.5px; padding-top: 40px; border-top: 1px solid #1a1e24; margin-top: 40px; }
  .footer a { color: #8a919c; text-decoration: none; margin: 0 10px; }
  @media (max-width: 760px) {
    .features, .plans { grid-template-columns: 1fr; }
    .hero h1 { font-size: 32px; }
    .nav-links .hide-sm { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="logo">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23252a"/><stop offset="1" stop-color="#101114"/></linearGradient></defs>
        <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#t)" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
        <rect x="31" y="12" width="21" height="14" rx="3.5" fill="none" stroke="#00d4ff" stroke-width="1.7"/>
        <circle cx="34.5" cy="15.5" r="1.4" fill="#00d4ff"/>
        <rect x="35" y="39" width="23" height="17" rx="3.5" fill="none" stroke="#00d4ff" stroke-width="1.7"/>
        <circle cx="38.5" cy="42.5" r="1.4" fill="#00d4ff"/>
        <path d="M18 38 A14.5 14.5 0 1 1 44 29" fill="none" stroke="#b9c0c9" stroke-width="9.5" stroke-linecap="round"/>
        <path d="M45.5 23 l-2.5 9 l8.5 -4.2 z" fill="#b9c0c9"/>
      </svg>
      极客 Geek
    </div>
    <div class="nav-links">
      <a href="/#features">功能</a>
      <a href="/#pricing">定价</a>
      <a href="/#download">下载</a>
      <a href="/login" class="hide-sm">登录</a>
      <a href="/login" class="btn btn-primary">开始使用</a>
    </div>
  </nav>

  <section class="hero">
    <h1>多平台多账号<br><span>实时翻译聊天客户端</span></h1>
    <p>WhatsApp · Telegram · LINE 多账号同时在线，消息实时翻译、群发群管、沙箱隔离。跨境电商与出海业务的最佳选择。</p>
    <div class="btns">
      <a href="/login" class="btn btn-primary">免费注册 · 送 2 万字符</a>
      <a href="/#download" class="btn btn-ghost">下载客户端</a>
    </div>
  </section>

  <section class="features" id="features">
    <div class="feature"><div class="icon">🌐</div><h3>多平台多开</h3><p>WhatsApp / Telegram / LINE 任意组合，一个客户端同时挂多个账号，沙箱隔离互不干扰。</p></div>
    <div class="feature"><div class="icon">⚡</div><h3>实时翻译</h3><p>收到消息即时翻译，支持 200+ 语种，双向互译，历史消息缓存不重复扣字符。</p></div>
    <div class="feature"><div class="icon">📣</div><h3>群发群管</h3><p>文字/图片/文件群发，定时任务，随机间隔防封，群组工具一应俱全。</p></div>
    <div class="feature"><div class="icon">🔒</div><h3>数据隔离</h3><p>每个账号独立会话环境与代理，账号数据完全隔离，删除账号不留痕迹。</p></div>
    <div class="feature"><div class="icon">🔄</div><h3>自动恢复</h3><p>重启自动恢复登录状态，崩溃自动重启，长时间挂机不丢消息。</p></div>
    <div class="feature"><div class="icon">💬</div><h3>智能回复</h3><p>AI 辅助沟通，贴近母语习惯，让聊天更自然真实。</p></div>
  </section>

  <section class="platforms">
    <div class="tags">
      <span class="tag">WhatsApp</span><span class="tag">Telegram</span><span class="tag">LINE</span>
      <span class="tag">多开</span><span class="tag">实时翻译</span><span class="tag">群发</span><span class="tag">群组工具</span>
    </div>
  </section>

  <section class="pricing" id="pricing">
    <h2>字符套餐 · 买断不限时</h2>
    <div class="sub">注册即送 2 万字符，用完再买，没有时间限制</div>
    <div class="plans">
      <div class="plan">
        <div class="p-name">基础包</div>
        <div class="p-price">$25<span> / 100万字符</span></div>
        <div class="p-desc">轻量入门，适合少量翻译</div>
        <a href="/login" class="btn btn-primary" style="width:100%">选择</a>
      </div>
      <div class="plan hot">
        <div class="badge">推荐</div>
        <div class="p-name">标准包</div>
        <div class="p-price">$48<span> / 150万字符</span></div>
        <div class="p-desc">主流选择，日常翻译够用</div>
        <a href="/login" class="btn btn-primary" style="width:100%">选择</a>
      </div>
      <div class="plan">
        <div class="p-name">大包</div>
        <div class="p-price">$128<span> / 450万字符</span></div>
        <div class="p-desc">团队高频使用，最划算</div>
        <a href="/login" class="btn btn-primary" style="width:100%">选择</a>
      </div>
    </div>
  </section>

  <section class="pricing" id="download">
    <h2>下载客户端</h2>
    <div class="sub">Windows · 当前版本 v${VERSION}</div>
    <div class="btns" style="justify-content:center">
      <a href="/download" class="btn btn-primary">下载 Windows 版</a>
    </div>
  </section>

  <div class="footer">
    <div>极客 Geek · 多平台多账号聊天客户端</div>
    <div style="margin-top:10px"><a href="/login">登录</a><a href="/#pricing">定价</a><a href="/#download">下载</a></div>
    <div style="margin-top:10px">© 2026 Geek</div>
  </div>
</div>
</body>
</html>`;

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 · 极客 Geek</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0d10; color: #e8eaed; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { width: 100%; max-width: 380px; background: #14171c; border: 1px solid #23272f; border-radius: 16px; padding: 32px; margin: 20px; }
  h2 { font-size: 20px; margin-bottom: 6px; }
  .sub { color: #8a919c; font-size: 13px; margin-bottom: 22px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 12px; color: #8a919c; margin-bottom: 6px; }
  .field input { width: 100%; padding: 11px 14px; font-size: 14px; color: #e8eaed; background: #0e1116; border: 1px solid #2f3540; border-radius: 10px; outline: none; }
  .field input:focus { border-color: #00d4ff; }
  .btn { width: 100%; padding: 12px; font-size: 15px; font-weight: 600; color: #06121a; background: linear-gradient(135deg, #00d4ff, #00a3cc); border: none; border-radius: 10px; cursor: pointer; }
  .btn:hover { opacity: .92; }
  .switch { text-align: center; margin-top: 16px; font-size: 13px; color: #8a919c; }
  .switch a { color: #00d4ff; text-decoration: none; cursor: pointer; }
  .err { color: #f87171; font-size: 13px; margin-top: 10px; min-height: 18px; }
  .back { display: block; text-align: center; margin-top: 14px; color: #8a919c; font-size: 12.5px; text-decoration: none; }
</style>
</head>
<body>
<div class="card">
  <h2>欢迎回来</h2>
  <div class="sub">登录极客账户，继续使用</div>
  <div class="field"><label>邮箱</label><input type="email" id="email" placeholder="you@example.com" spellcheck="false"></div>
  <div class="field"><label>密码</label><input type="password" id="password" placeholder="••••••••"></div>
  <button class="btn" id="btn-login">登 录</button>
  <div class="err" id="err"></div>
  <div class="switch">还没有账号？<a onclick="toggle()">注册</a></div>
  <a href="/" class="back">← 返回首页</a>
</div>
<script>
let isRegister = false;
function toggle() {
  isRegister = !isRegister;
  document.querySelector('h2').textContent = isRegister ? '创建账号' : '欢迎回来';
  document.querySelector('.sub').textContent = isRegister ? '注册即送 2 万字符，免费体验' : '登录极客账户，继续使用';
  document.querySelector('#btn-login').textContent = isRegister ? '注册并登录' : '登 录';
  document.querySelector('.switch').innerHTML = isRegister
    ? '已有账号？<a onclick="toggle()">登录</a>'
    : '还没有账号？<a onclick="toggle()">注册</a>';
  document.getElementById('err').textContent = '';
}
document.getElementById('btn-login').onclick = async () => {
  const email = document.getElementById('email').value.trim();
  const pass = document.getElementById('password').value;
  const err = document.getElementById('err');
  if (!email || !pass) { err.textContent = '请输入邮箱和密码'; return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = isRegister ? '注册中…' : '登录中…';
  try {
    if (isRegister) {
      // 先注册（返回 userId，无 token），再自动登录拿 token
      const reg = await fetch('${API_BASE}/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });
      const regData = await reg.json();
      if (!reg.ok) {
        err.textContent = regData.error === 'email_exists' ? '该邮箱已注册，请直接登录' : '注册失败，请稍后重试';
        return;
      }
    }
    const res = await fetch('${API_BASE}/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error === 'invalid_credentials' ? '邮箱或密码错误'
        : data.error === 'account_disabled' ? '账号已被封禁，请联系客服'
        : '操作失败，请稍后重试';
      return;
    }
    localStorage.setItem('geek_web_token', data.token);
    localStorage.setItem('geek_web_email', email);
    window.location.href = '/account';
  } catch (e) {
    err.textContent = '网络错误，请稍后重试';
  } finally {
    btn.disabled = false; btn.textContent = isRegister ? '注册并登录' : '登 录';
  }
};
document.getElementById('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });
</script>
</body>
</html>`;

const ACCOUNT_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>个人中心 · 极客 Geek</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0d10; color: #e8eaed; min-height: 100vh; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px 20px 60px; }
  nav { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 28px; }
  .logo { font-weight: 600; font-size: 17px; }
  .card { background: #14171c; border: 1px solid #23272f; border-radius: 14px; padding: 24px; margin-bottom: 16px; }
  .card h3 { font-size: 16px; margin-bottom: 12px; }
  .quota { display: flex; align-items: center; justify-content: space-between; }
  .quota .num { font-size: 30px; font-weight: 700; }
  .quota .num span { font-size: 13px; color: #8a919c; font-weight: 400; }
  .email { color: #8a919c; font-size: 13.5px; margin-bottom: 8px; }
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 14px; }
  .plan { background: #0e1116; border: 1px solid #2f3540; border-radius: 12px; padding: 16px; text-align: center; }
  .plan .p-name { font-size: 14px; }
  .plan .p-price { font-size: 22px; font-weight: 700; margin: 8px 0 2px; }
  .plan .p-price span { font-size: 12px; color: #8a919c; font-weight: 400; }
  .plan .btn { display: block; width: 100%; margin-top: 12px; padding: 8px; border-radius: 8px; border: 1px solid #00d4ff; color: #00d4ff; background: transparent; cursor: pointer; font-size: 13px; }
  .plan .btn:hover { background: rgba(0,212,255,0.1); }
  .btn-ghost { background: #23272f; color: #e8eaed; border: 1px solid #2f3540; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; }
  .btn-ghost:hover { border-color: #00d4ff; }
  .order-box { background: #0e1116; border: 1px solid #2f3540; border-radius: 12px; padding: 16px; margin-top: 14px; }
  .order-box .o-amount { font-size: 24px; font-weight: 700; margin: 6px 0; }
  .order-box .o-line { color: #8a919c; font-size: 13px; line-height: 1.7; }
  .ok { color: #4ade80; font-size: 13.5px; margin-top: 10px; }
  .err { color: #f87171; font-size: 13.5px; margin-top: 10px; }
  .status-pill { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 12.5px; background: rgba(0,212,255,0.1); color: #00d4ff; border: 1px solid rgba(0,212,255,0.3); margin-top: 6px; }
  @media (max-width: 600px) { .plans { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a href="/" class="logo" style="text-decoration:none;color:inherit">极客 Geek · 个人中心</a>
    <div>
      <a href="/" class="btn-ghost" style="display:inline-block;margin-right:8px;text-decoration:none">← 返回首页</a>
      <button class="btn-ghost" id="btn-logout">退出登录</button>
    </div>
  </nav>

  <div class="card">
    <div class="email" id="email"></div>
    <div class="quota">
      <div>
        <div style="color:#8a919c;font-size:12.5px;margin-bottom:4px">剩余字符</div>
        <div class="num" id="quota">—</div>
      </div>
      <span class="status-pill" id="plan-pill">免费用户</span>
    </div>
  </div>

  <div class="card">
    <h3>购买字符包</h3>
    <div style="color:#8a919c;font-size:12.5px">买断不限时，付款后客服手动到账</div>
    <div class="plans">
      <div class="plan">
        <div class="p-name">基础包</div>
        <div class="p-price">$25<span> / 100万</span></div>
        <button class="btn" onclick="buy('basic')">购买</button>
      </div>
      <div class="plan">
        <div class="p-name">标准包</div>
        <div class="p-price">$48<span> / 150万</span></div>
        <button class="btn" onclick="buy('standard')">购买</button>
      </div>
      <div class="plan">
        <div class="p-name">大包</div>
        <div class="p-price">$128<span> / 450万</span></div>
        <button class="btn" onclick="buy('pro')">购买</button>
      </div>
    </div>
    <div id="order-box"></div>
    <div class="ok" id="ok"></div>
    <div class="err" id="err"></div>
  </div>

  <div class="card">
    <h3>下载客户端</h3>
    <div style="color:#8a919c;font-size:13px;margin-bottom:12px">Windows 版 v${VERSION} · 登录后即可使用</div>
    <a href="/download" class="btn-ghost" style="display:inline-block;text-decoration:none">下载 Windows 版</a>
  </div>
</div>
<script>
const API = '${API_BASE}';
function getToken() { return localStorage.getItem('geek_web_token') || ''; }
async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function load() {
  if (!getToken()) { window.location.href = '/login'; return; }
  document.getElementById('email').textContent = localStorage.getItem('geek_web_email') || '';
  try {
    const { data } = await api('/api/quota');
    document.getElementById('quota').textContent = (data.remaining_chars ?? 0).toLocaleString() + ' 字符';
    if (data.remaining_chars > 0) {
      document.getElementById('plan-pill').textContent = '免费用户';
    }
  } catch (e) {
    document.getElementById('quota').textContent = '—';
  }
}
async function buy(plan) {
  const ok = document.getElementById('ok'); const er = document.getElementById('err');
  ok.textContent = ''; er.textContent = '';
  const names = { basic: '基础包 · 100万字符', standard: '标准包 · 150万字符', pro: '大包 · 450万字符' };
  try {
    const { status, data } = await api('/api/orders', { plan });
    if (status !== 200) { er.textContent = data.error || '下单失败'; return; }
    document.getElementById('order-box').innerHTML =
      '<div class="order-box">' +
      '<div>' + esc(names[data.order.plan] || data.order.plan) + '</div>' +
      '<div class="o-amount">$' + data.order.amount + '</div>' +
      '<div class="o-line">订单号 <b>#' + data.order.id + '</b><br>联系客服转账对应金额，备注订单号，客服确认后自动到账。</div>' +
      '<button class="btn-ghost" style="margin-top:12px" onclick="refreshOrder()">我已完成付款，刷新</button>' +
      '</div>';
    ok.textContent = '订单已生成，请完成付款';
  } catch (e) { er.textContent = '网络错误，请稍后重试'; }
}
async function refreshOrder() {
  const ok = document.getElementById('ok'); const er = document.getElementById('err');
  ok.textContent = ''; er.textContent = '';
  try {
    const { data } = await api('/api/quota');
    document.getElementById('quota').textContent = (data.remaining_chars ?? 0).toLocaleString() + ' 字符';
    ok.textContent = '已刷新，当前剩余 ' + (data.remaining_chars ?? 0).toLocaleString() + ' 字符';
  } catch (e) { er.textContent = '网络错误'; }
}
document.getElementById('btn-logout').onclick = () => { localStorage.removeItem('geek_web_token'); localStorage.removeItem('geek_web_email'); window.location.href = '/'; };
load();
</script>
</body>
</html>`;

function html(content, status = 200) {
  return new Response(content, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) return html(HOME_HTML);
    if (request.method === 'GET' && path === '/login') return html(LOGIN_HTML);
    if (request.method === 'GET' && path === '/account') return html(ACCOUNT_HTML);
    if (request.method === 'GET' && path === '/download') {
      // 跳转到 geek-release 下载（R2 安装包）
      return Response.redirect('https://geek-release.9529360.workers.dev/geek-setup-' + VERSION + '.exe', 302);
    }
    if (request.method === 'GET' && path === '/health') return new Response(JSON.stringify({ ok: true, service: 'geek-website', version: VERSION }), { headers: { 'Content-Type': 'application/json' } });

    return html('<h1 style="font-family:sans-serif;color:#8a919c;padding:40px;text-align:center">404 · 页面不存在</h1>', 404);
  },
};
