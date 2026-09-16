import { isTronAddress, renderTronAddressQrSvg } from './website-payment-qr.mjs';

// geek-website Worker —— 极客官网（现代深色科技风落地页）
// 部署在 geek.bbnba.com；动态功能（登录/注册/余额/下单）调用 geek-subscription API
// 设计语言：Linear/Vercel 风格——深色 + 霓虹渐变 + 毛玻璃 + SVG 线性图标 + 微动效

const API_BASE = '';
const SUBSCRIPTION_API = 'https://admin.bbnba.com';
const RELEASE_BASE = 'https://geek-release.9529360.workers.dev';
const VERSION = '__GEEK_LATEST_VERSION__';
const FALLBACK_VERSION = '1.2.27';

async function latestVersion() {
  try {
    const response = await fetch(`${RELEASE_BASE}/latest.yml`, { cf: { cacheTtl: 60 } });
    if (!response.ok) return FALLBACK_VERSION;
    const match = (await response.text()).match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
    return match ? match[1] : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

function withLatestVersion(content, version) {
  return content.replaceAll(VERSION, version);
}

const SHARED_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #05060a;
    --bg-soft: #0a0d14;
    --card: rgba(255,255,255,0.03);
    --card-border: rgba(255,255,255,0.08);
    --text: #f2f4f8;
    --text-dim: #9aa3b2;
    --text-faint: #5c6470;
    --accent: #4f8cff;
    --accent2: #00e5a0;
    --grad: linear-gradient(135deg, #4f8cff 0%, #00e5a0 50%, #a78bfa 100%);
    --radius: 16px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  }
  html { scroll-behavior: smooth; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
  ::selection { background: rgba(79,140,255,.3); }
  a { text-decoration: none; color: inherit; }
  :focus-visible { outline: 2px solid #7db4ff; outline-offset: 3px; }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 24px; position: relative; z-index: 2; }

  /* 背景光晕 + 网格 */
  .bg-glow { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .bg-glow::before {
    content: ''; position: absolute; top: -30vh; left: 50%; transform: translateX(-50%);
    width: 120vw; height: 90vh; background: radial-gradient(ellipse at center, rgba(79,140,255,.14) 0%, rgba(0,229,160,.05) 40%, transparent 70%);
    filter: blur(20px);
  }
  .bg-glow::after {
    content: ''; position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 56px 56px;
    mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 30%, transparent 75%);
  }

  /* 导航 */
  nav { display: flex; align-items: center; justify-content: space-between; padding: 22px 0; }
  .logo { display: flex; align-items: center; gap: 11px; font-weight: 700; font-size: 17px; letter-spacing: .2px; }
  .logo-mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, #1d2438, #0a0d16); border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(79,140,255,.25); position: relative; overflow: hidden; }
  .logo-mark svg { width: 22px; height: 22px; }
  .nav-links { display: flex; gap: 30px; align-items: center; }
  .nav-links a { color: var(--text-dim); font-size: 14px; transition: color .18s; }
  .nav-links a:hover { color: var(--text); }
  .nav-cta { display: flex; gap: 10px; align-items: center; }

  /* 按钮 */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 22px; border-radius: 12px; font-size: 14px; font-weight: 600; transition: all .18s; cursor: pointer; border: none; white-space: nowrap; }
  .btn-primary { background: var(--grad); color: #04121a; box-shadow: 0 6px 24px rgba(79,140,255,.35); }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 32px rgba(79,140,255,.45); }
  .btn-ghost { background: rgba(255,255,255,.05); color: var(--text); border: 1px solid var(--card-border); backdrop-filter: blur(8px); }
  .btn-ghost:hover { border-color: rgba(79,140,255,.5); background: rgba(255,255,255,.08); }

  /* Hero */
  .hero { text-align: center; padding: 96px 0 72px; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; border-radius: 100px; font-size: 13px; color: var(--text-dim); background: rgba(255,255,255,.04); border: 1px solid var(--card-border); backdrop-filter: blur(8px); margin-bottom: 28px; }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: #00e5a0; box-shadow: 0 0 12px #00e5a0; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .hero h1 { font-size: clamp(40px, 7vw, 68px); font-weight: 800; letter-spacing: -1.5px; line-height: 1.12; margin-bottom: 22px; }
  .hero h1 .grad { background: var(--grad); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .hero .sub { color: var(--text-dim); font-size: clamp(15px, 2vw, 18px); max-width: 620px; margin: 0 auto 38px; line-height: 1.75; }
  .hero .btns { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
  .hero .mini { margin-top: 22px; color: var(--text-faint); font-size: 13px; }

  /* 平台标签 */
  .platform-strip { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin: 44px 0 8px; }
  .p-tag { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 100px; font-size: 13.5px; color: var(--text-dim); background: rgba(255,255,255,.035); border: 1px solid var(--card-border); backdrop-filter: blur(6px); }
  .p-tag svg { width: 15px; height: 15px; opacity: .8; }

  /* 区块通用 */
  .section { padding: 88px 0; }
  .section-head { text-align: center; max-width: 560px; margin: 0 auto 52px; }
  .section-head .kicker { font-size: 13px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #7db4ff; margin-bottom: 14px; text-shadow: 0 0 16px rgba(79,140,255,.4); }
  .section-head h2 { font-size: clamp(28px, 4vw, 42px); font-weight: 800; letter-spacing: -1px; margin-bottom: 14px; }
  .section-head p { color: var(--text-dim); font-size: 15.5px; line-height: 1.7; }

  /* 功能卡片 */
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .feature { background: var(--card); border: 1px solid var(--card-border); border-radius: var(--radius); padding: 30px 26px; backdrop-filter: blur(10px); transition: all .25s; position: relative; overflow: hidden; }
  .feature::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(79,140,255,.5), transparent); opacity: 0; transition: opacity .25s; }
  .feature:hover { transform: translateY(-3px); border-color: rgba(79,140,255,.35); background: rgba(255,255,255,.045); }
  .feature:hover::before { opacity: 1; }
  .feature .icon { width: 44px; height: 44px; border-radius: 12px; background: rgba(79,140,255,.12); border: 1px solid rgba(79,140,255,.22); display: flex; align-items: center; justify-content: center; margin-bottom: 18px; }
  .feature .icon svg { width: 22px; height: 22px; stroke: var(--accent); }
  .feature h3 { font-size: 16.5px; font-weight: 700; margin-bottom: 9px; }
  .feature p { color: var(--text-dim); font-size: 14px; line-height: 1.65; }

  /* 定价 */
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: stretch; }
  .plan { background: var(--card); border: 1px solid var(--card-border); border-radius: 20px; padding: 34px 28px; backdrop-filter: blur(10px); position: relative; display: flex; flex-direction: column; transition: all .25s; }
  .plan:hover { transform: translateY(-3px); }
  .plan.hot { border-color: rgba(79,140,255,.55); box-shadow: 0 0 60px rgba(79,140,255,.12), inset 0 1px 0 rgba(255,255,255,.06); background: linear-gradient(180deg, rgba(79,140,255,.07), rgba(255,255,255,.02)); }
  .plan .badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--grad); color: #04121a; font-size: 11.5px; font-weight: 700; padding: 5px 14px; border-radius: 100px; letter-spacing: .5px; }
  .plan .p-name { font-size: 16px; font-weight: 700; color: var(--text-dim); }
  .plan .p-price { font-size: 44px; font-weight: 800; letter-spacing: -1.5px; margin: 16px 0 4px; }
  .plan .p-price .cur { font-size: 20px; vertical-align: super; font-weight: 600; color: var(--text-dim); margin-right: 2px; }
  .plan .p-amount { font-size: 13.5px; color: var(--text-faint); margin-bottom: 24px; }
  .plan ul { list-style: none; margin-bottom: 28px; flex: 1; }
  .plan li { display: flex; gap: 10px; align-items: flex-start; color: var(--text-dim); font-size: 14px; padding: 6px 0; line-height: 1.5; }
  .plan li svg { width: 16px; height: 16px; flex-shrink: 0; margin-top: 2px; stroke: #00e5a0; }
  .plan .btn { width: 100%; }

  /* 下载区 */
  .download { text-align: center; background: var(--card); border: 1px solid var(--card-border); border-radius: 24px; padding: 64px 32px; backdrop-filter: blur(10px); position: relative; overflow: hidden; }
  .download::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 0%, rgba(79,140,255,.12), transparent 60%); pointer-events: none; }
  .download .big-icon { width: 76px; height: 76px; border-radius: 22px; background: rgba(79,140,255,.1); border: 1px solid rgba(79,140,255,.25); display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
  .download .big-icon svg { width: 36px; height: 36px; stroke: var(--accent); }
  .download h2 { font-size: clamp(24px, 3.5vw, 34px); font-weight: 800; margin-bottom: 10px; }
  .download p { color: var(--text-dim); font-size: 15px; margin-bottom: 28px; }
  .version-pill { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 20px; padding: 6px 14px; border-radius: 100px; background: rgba(255,255,255,.04); border: 1px solid var(--card-border); color: var(--text-dim); font-size: 12.5px; }

  /* 上手流程 + 常见问题 */
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; counter-reset: step; }
  .step { counter-increment: step; background: var(--card); border: 1px solid var(--card-border); border-radius: var(--radius); padding: 28px 26px; position: relative; }
  .step::before { content: "0" counter(step); display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 12px; margin-bottom: 18px; color: #8fb7ff; background: rgba(79,140,255,.12); border: 1px solid rgba(79,140,255,.25); font-size: 12px; font-weight: 800; letter-spacing: .8px; }
  .step h3 { font-size: 16.5px; margin-bottom: 9px; }
  .step p { color: var(--text-dim); font-size: 14px; line-height: 1.7; }
  .faq { max-width: 820px; margin: 0 auto; display: grid; gap: 12px; }
  .faq details { background: var(--card); border: 1px solid var(--card-border); border-radius: 14px; padding: 0 20px; }
  .faq summary { cursor: pointer; padding: 19px 30px 19px 0; font-size: 15px; font-weight: 650; list-style: none; position: relative; }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: '+'; position: absolute; right: 2px; top: 16px; color: #7db4ff; font-size: 22px; font-weight: 400; }
  .faq details[open] summary::after { content: '−'; }
  .faq details p { color: var(--text-dim); font-size: 14px; line-height: 1.75; padding: 0 28px 19px 0; }

  /* 桌面用户控制台 */
  .account-page .wrap { max-width: 1480px; padding: 0 32px; }
  .account-page footer { display: none; }
  .account-page nav { height: 76px; padding: 18px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
  .account-page .nav-links { display: none; }
  .dashboard-shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 30px; align-items: start; padding: 28px 0 64px; }
  .dashboard-sidebar { position: sticky; top: 22px; min-height: calc(100vh - 126px); display: flex; flex-direction: column; padding: 18px 14px; background: rgba(10,13,20,.78); border: 1px solid var(--card-border); border-radius: 18px; backdrop-filter: blur(18px); }
  .sidebar-account { padding: 10px 10px 18px; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .sidebar-label { color: var(--text-faint); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 7px; }
  .sidebar-email { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dashboard-nav { display: grid; gap: 5px; }
  .dashboard-nav a { display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 11px; color: var(--text-dim); font-size: 13.5px; transition: color .15s, background .15s; }
  .dashboard-nav a:hover, .dashboard-nav a:first-child { color: var(--text); background: rgba(79,140,255,.11); }
  .dashboard-nav .nav-icon { width: 25px; height: 25px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: #8fb7ff; background: rgba(79,140,255,.1); font-size: 12px; }
  .sidebar-support { margin-top: auto; padding: 16px 10px 4px; color: var(--text-faint); font-size: 12px; line-height: 1.7; }
  .sidebar-support a { color: #8fb7ff; }
  .dashboard-main { min-width: 0; }
  .dashboard-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin: 2px 0 22px; }
  .dashboard-heading h1 { font-size: 29px; letter-spacing: -.7px; margin-bottom: 6px; }
  .dashboard-heading p { color: var(--text-dim); font-size: 13.5px; }
  .dashboard-actions { display: flex; gap: 9px; }
  .dashboard-card { background: rgba(255,255,255,.025); border: 1px solid var(--card-border); border-radius: 18px; backdrop-filter: blur(12px); }
  .metric-grid { display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 14px; }
  .metric { min-height: 144px; padding: 21px 22px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; }
  .metric.primary { background: linear-gradient(135deg, rgba(79,140,255,.16), rgba(0,229,160,.07)); border-color: rgba(79,140,255,.34); }
  .metric.primary::after { content: ''; position: absolute; width: 180px; height: 180px; right: -65px; bottom: -90px; border-radius: 50%; background: rgba(0,229,160,.1); filter: blur(4px); }
  .metric-label { color: var(--text-dim); font-size: 12px; }
  .metric-value { font-size: 23px; font-weight: 780; letter-spacing: -.5px; position: relative; z-index: 1; }
  .metric.primary .metric-value { font-size: 31px; }
  .metric-note { color: var(--text-faint); font-size: 11.5px; line-height: 1.5; }
  .status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; background: #00e5a0; box-shadow: 0 0 9px rgba(0,229,160,.7); }
  .dashboard-section { margin-top: 22px; scroll-margin-top: 22px; }
  .section-card { padding: 24px; }
  .section-toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
  .section-toolbar h2 { font-size: 18px; margin-bottom: 6px; }
  .section-toolbar p { color: var(--text-dim); font-size: 12.5px; }
  .account-action { padding: 7px 12px; border-radius: 9px; font-size: 12px; color: var(--text-dim); background: rgba(255,255,255,.04); border: 1px solid var(--card-border); cursor: pointer; }
  .account-action:hover { color: var(--text); border-color: rgba(79,140,255,.45); }
  .mini-plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .mini-plan { min-height: 180px; padding: 21px; display: flex; flex-direction: column; background: rgba(255,255,255,.025); border: 1px solid var(--card-border); border-radius: 15px; position: relative; }
  .mini-plan.recommended { background: linear-gradient(180deg, rgba(79,140,255,.1), rgba(255,255,255,.025)); border-color: rgba(79,140,255,.48); }
  .mini-plan .recommended-badge { position: absolute; top: -9px; right: 16px; padding: 4px 10px; border-radius: 100px; background: var(--grad); color: #04121a; font-size: 10px; font-weight: 800; }
  .mini-plan-name { color: var(--text-dim); font-size: 13px; }
  .mini-plan-price { margin: 13px 0 2px; font-size: 30px; font-weight: 800; }
  .mini-plan-chars { color: var(--text-faint); font-size: 12px; }
  .mini-plan .btn { margin-top: auto; width: 100%; padding: 9px; }
  .payment-workspace { display: grid; grid-template-columns: 190px 1fr; gap: 26px; align-items: center; padding: 24px; margin-top: 18px; text-align: left; background: rgba(0,229,160,.045); border: 1px solid rgba(0,229,160,.24); border-radius: 15px; }
  .payment-heading { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 20px; align-items: center; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .copy-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .copy-btn { padding: 6px 10px; border-radius: 8px; font-size: 12px; color: #8fb7ff; background: rgba(79,140,255,.1); border: 1px solid rgba(79,140,255,.3); cursor: pointer; }
  .orders-table { overflow: hidden; border: 1px solid var(--card-border); border-radius: 13px; }
  .order-row { display: grid; grid-template-columns: .7fr 1.2fr .8fr 1fr .7fr; align-items: center; gap: 14px; min-height: 48px; padding: 0 15px; border-top: 1px solid rgba(255,255,255,.055); font-size: 12.5px; }
  .order-row:first-child { border-top: none; }
  .order-table-head { min-height: 42px; color: var(--text-faint); background: rgba(255,255,255,.025); font-size: 11.5px; font-weight: 700; letter-spacing: .3px; }
  .order-status { justify-self: end; padding: 4px 9px; border-radius: 100px; background: rgba(255,255,255,.04); }
  .orders-empty { padding: 28px; text-align: center; color: var(--text-dim); font-size: 13px; }
  .resource-grid { display: grid; grid-template-columns: 1.35fr repeat(3, 1fr); gap: 12px; }
  .resource-card { min-height: 116px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--card-border); border-radius: 14px; background: rgba(255,255,255,.025); }
  .resource-card strong { font-size: 14px; }
  .resource-card span { color: var(--text-dim); font-size: 12px; line-height: 1.55; }
  .resource-card.primary { background: linear-gradient(135deg, rgba(79,140,255,.12), rgba(167,139,250,.07)); border-color: rgba(79,140,255,.34); }
  .desktop-required { display: none; min-height: calc(100vh - 100px); align-items: center; justify-content: center; text-align: center; padding: 36px 20px; }
  .desktop-required-card { max-width: 430px; padding: 30px 24px; background: var(--card); border: 1px solid var(--card-border); border-radius: 18px; }
  .desktop-required-card h1 { font-size: 23px; margin-bottom: 10px; }
  .desktop-required-card p { color: var(--text-dim); font-size: 13px; line-height: 1.7; margin-bottom: 20px; }

  /* 页脚 */
  footer { border-top: 1px solid rgba(255,255,255,.06); padding: 44px 0 36px; margin-top: 40px; }
  .footer-grid { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 24px; }
  .footer-brand { max-width: 260px; }
  .footer-brand .logo { margin-bottom: 12px; }
  .footer-brand p { color: var(--text-faint); font-size: 13px; line-height: 1.7; }
  .footer-cols { display: flex; gap: 64px; flex-wrap: wrap; }
  .footer-cols .col h4 { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 14px; }
  .footer-cols .col a { display: block; color: var(--text-dim); font-size: 13.5px; padding: 5px 0; transition: color .15s; }
  .footer-cols .col a:hover { color: var(--text); }
  .footer-bottom { margin-top: 36px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.05); display: flex; justify-content: space-between; color: var(--text-faint); font-size: 12.5px; flex-wrap: wrap; gap: 10px; }

  /* 动效 */
  .fade-up { opacity: 0; transform: translateY(24px); transition: opacity .6s ease, transform .6s ease; }
  .fade-up.in { opacity: 1; transform: none; }

  @media (max-width: 860px) {
    .features, .plans, .steps { grid-template-columns: 1fr; }
    .nav-links { display: none; }
    .hero { padding: 64px 0 48px; }
    .section { padding: 56px 0; }
    .footer-grid { flex-direction: column; }
  }
  @media (max-width: 960px) {
    .account-page .dashboard-shell { display: none; }
    .account-page .desktop-required { display: flex; }
  }
  @media (max-width: 480px) {
    .btn { padding: 10px 18px; font-size: 13.5px; }
    .wrap { padding: 0 18px; }
    .nav-cta { gap: 7px; }
    .nav-cta .btn { padding: 10px 13px; }
    .footer-cols { gap: 34px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    .fade-up { opacity: 1; transform: none; }
  }
`;

const ICONS = {
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
  tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  line: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.92 2 10.75c0 4.56 3.94 8.29 9.26 8.67.36.08.85.24.97.56.11.29.07.74.03 1.04 0 .05-.04.32.28.59.34.29.98.06 1.02.06.04 0 .66-.4 1.37-1.01 1.21-1.04 1.5-1.62 1.89-2.07C18.44 17.36 22 14.38 22 10.75 22 5.92 17.52 2 12 2zM8.05 13.99H6.16a.57.57 0 01-.57-.57V9.36c0-.31.25-.57.57-.57.32 0 .57.26.57.57v3.49h1.32c.31 0 .57.25.57.57 0 .31-.26.57-.57.57zm2.22-3.05c0 .31-.25.57-.57.57a.57.57 0 01-.57-.57V9.36a.57.57 0 011.14 0v1.58zm.96 2.48c0 .31-.25.57-.57.57a.57.57 0 01-.57-.57V9.36c0-.31.25-.57.57-.57.32 0 .57.26.57.57v4.06zm4.6-.35a.57.57 0 01-.64.5c-.13 0-.26-.05-.34-.14l-2.53-2.7v2.34c0 .31-.25.57-.57.57a.57.57 0 01-.57-.57V9.36c0-.27.19-.5.45-.56.04 0 .08-.01.12-.01.15 0 .29.06.39.16l2.53 2.7V9.36c0-.31.26-.57.57-.57.32 0 .57.26.57.57v4.06c0 .03-.01.06-.01.09v.13zm2.6-2.24a.57.57 0 01-.57.57h-1.32v1.32a.57.57 0 01-1.14 0V11.9h-1.32a.57.57 0 010-1.14h1.32V9.44a.57.57 0 011.14 0v1.32h1.32a.57.57 0 01.57.57z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16"/><path d="M3 21v-5h5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

function layout(body, active) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${active === 'home' ? '极客 Geek · 多平台多账号实时翻译客户端' : active === 'login' ? '登录 · 极客 Geek' : '用户后台 · 极客 Geek'}</title>
<meta name="description" content="极客 Geek —— WhatsApp / Telegram / LINE 多平台多账号聊天客户端，实时翻译、群发、群组工具，出海必备。">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${SHARED_CSS}</style>
</head>
<body class="${active === 'account' ? 'account-page' : ''}">
<div class="bg-glow"></div>
<div class="wrap">
  <nav>
    <a href="/" class="logo">
      <span class="logo-mark"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="0.55" stop-color="#00e5a0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient><linearGradient id="lw1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7db4ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient><linearGradient id="lw2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5a0"/><stop offset="1" stop-color="#00c48a"/></linearGradient></defs><rect x="31.5" y="9.5" width="20.5" height="14" rx="3.5" fill="rgba(0,229,160,0.08)" stroke="url(#lw2)" stroke-width="1.8"/><circle cx="34.8" cy="12.8" r="1.2" fill="#00e5a0"/><rect x="12.5" y="24.5" width="25.5" height="17" rx="4" fill="rgba(79,140,255,0.1)" stroke="url(#lw1)" stroke-width="1.9"/><circle cx="16" cy="28" r="1.2" fill="#7db4ff"/><path d="M39.5 42 C46 36 48 29.5 46.5 23" fill="none" stroke="url(#lg1)" stroke-width="3.4" stroke-linecap="round"/><path d="M49.5 20.5 l-4.8 2.7 l1.6 -5.2 z" fill="url(#lg1)"/></svg></span>
      极客 Geek
    </a>
    <div class="nav-links">
      <a href="/#features">功能</a>
      <a href="/#guide">教程</a>
      <a href="/#pricing">定价</a>
      <a href="/#download">下载</a>
      ${active === 'account' ? '<a href="/account">个人中心</a>' : ''}
    </div>
    <div class="nav-cta">
      ${active === 'account'
        ? '<a href="/" class="btn btn-ghost">← 返回首页</a>'
        : '<a href="/login" class="btn btn-ghost">登录</a>'}
      ${active === 'account'
        ? '<button class="btn btn-primary" onclick="logout()">退出登录</button>'
        : '<a href="/login" class="btn btn-primary">免费注册</a>'}
    </div>
  </nav>
  ${body}
  <footer>
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="logo"><span class="logo-mark"><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lgf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="0.55" stop-color="#00e5a0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient><linearGradient id="lwf1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7db4ff"/><stop offset="1" stop-color="#4f8cff"/></linearGradient><linearGradient id="lwf2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5a0"/><stop offset="1" stop-color="#00c48a"/></linearGradient></defs><rect x="31.5" y="9.5" width="20.5" height="14" rx="3.5" fill="rgba(0,229,160,0.08)" stroke="url(#lwf2)" stroke-width="1.8"/><circle cx="34.8" cy="12.8" r="1.2" fill="#00e5a0"/><rect x="12.5" y="24.5" width="25.5" height="17" rx="4" fill="rgba(79,140,255,0.1)" stroke="url(#lwf1)" stroke-width="1.9"/><circle cx="16" cy="28" r="1.2" fill="#7db4ff"/><path d="M39.5 42 C46 36 48 29.5 46.5 23" fill="none" stroke="url(#lgf)" stroke-width="3.4" stroke-linecap="round"/><path d="M49.5 20.5 l-4.8 2.7 l1.6 -5.2 z" fill="url(#lgf)"/></svg></span>极客 Geek</div>
        <p>为出海业务打造的多平台多账号实时翻译客户端。</p>
      </div>
      <div class="footer-cols">
        <div class="col">
          <h4>产品</h4>
          <a href="/#features">功能</a>
          <a href="/#pricing">定价</a>
          <a href="/#download">下载</a>
        </div>
        <div class="col">
          <h4>账户</h4>
          <a href="/login">登录 / 注册</a>
          <a href="/account">个人中心</a>
        </div>
        <div class="col">
          <h4>支持</h4>
          <a href="/#guide">使用教程</a>
          <a href="/#faq">常见问题</a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Geek · All rights reserved</span>
      <span>v${VERSION}</span>
    </div>
  </footer>
</div>
<script>
// 滚动渐入
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .08 });
document.querySelectorAll('.fade-up').forEach(el => io.observe(el));
</script>
${active === 'account' ? '<script>async function logout(){await fetch("/api/logout",{method:"POST",credentials:"same-origin"});location.href="/";}</script>' : ''}
</body>
</html>`;
}

const HOME = layout(`
  <section class="hero">
    <div class="pill"><span class="dot"></span>注册即送 2 万字符 · 无时间限制</div>
    <h1>多平台多账号<br><span class="grad">实时翻译聊天客户端</span></h1>
    <p class="sub">WhatsApp · Telegram · LINE 多账号同时在线，消息实时翻译、群发群管、沙箱隔离。为跨境电商与出海业务打造。</p>
    <div class="btns">
      <a href="/login" class="btn btn-primary">免费注册 · 送 2 万字符 ${ICONS.arrow}</a>
      <a href="/#download" class="btn btn-ghost">${ICONS.down} 下载客户端</a>
    </div>
    <div class="mini">Windows · 免安装 · 自动更新</div>
    <div class="platform-strip">
      <span class="p-tag">${ICONS.wa} WhatsApp</span>
      <span class="p-tag">${ICONS.tg} Telegram</span>
      <span class="p-tag">${ICONS.line} LINE</span>
    </div>
  </section>

  <section class="section" id="features">
    <div class="section-head fade-up">
      <div class="kicker">Features</div>
      <h2>为效率而生</h2>
      <p>一个客户端，搞定出海沟通的全部场景。</p>
    </div>
    <div class="features">
      <div class="feature fade-up"><div class="icon">${ICONS.globe}</div><h3>多平台多开</h3><p>WhatsApp / Telegram / LINE 任意组合，一个客户端同时挂多个账号，沙箱隔离互不干扰。</p></div>
      <div class="feature fade-up"><div class="icon">${ICONS.bolt}</div><h3>实时翻译</h3><p>消息即时翻译，支持 200+ 语种双向互译，历史消息缓存不重复扣字符。</p></div>
      <div class="feature fade-up"><div class="icon">${ICONS.send}</div><h3>群发群管</h3><p>文字 / 图片 / 文件群发，定时任务，随机间隔防封，群组工具一应俱全。</p></div>
      <div class="feature fade-up"><div class="icon">${ICONS.shield}</div><h3>数据隔离</h3><p>每个账号独立会话环境与代理，账号数据完全隔离，删除账号不留痕迹。</p></div>
      <div class="feature fade-up"><div class="icon">${ICONS.refresh}</div><h3>自动恢复</h3><p>重启自动恢复登录状态，崩溃自动重启，长时间挂机不丢消息。</p></div>
      <div class="feature fade-up"><div class="icon">${ICONS.sparkle}</div><h3>智能回复</h3><p>AI 辅助沟通，贴近母语习惯，让聊天更自然真实。</p></div>
    </div>
  </section>

  <section class="section" id="guide">
    <div class="section-head fade-up">
      <div class="kicker">Get started</div>
      <h2>三步开始使用</h2>
      <p>从创建账户到添加聊天账号，首次使用路径清晰可控。</p>
    </div>
    <div class="steps">
      <div class="step fade-up"><h3>免费注册</h3><p>使用邮箱创建极客账户，注册后即可获得 2 万翻译字符，字符余额没有到期时间。</p></div>
      <div class="step fade-up"><h3>下载并登录</h3><p>下载 Windows 客户端，用同一邮箱账户登录；客户端会自动检查后续更新。</p></div>
      <div class="step fade-up"><h3>添加聊天账号</h3><p>按需添加 WhatsApp、Telegram 或 LINE 账号，各账号会话相互隔离，随后即可配置翻译与群发。</p></div>
    </div>
  </section>

  <section class="section" id="pricing">
    <div class="section-head fade-up">
      <div class="kicker">Pricing</div>
      <h2>字符套餐 · 买断不限时</h2>
      <p>注册即送 2 万字符，用完再买，没有时间限制。USDT 到账后系统自动增加字符余额。</p>
    </div>
    <div class="plans">
      <div class="plan fade-up">
        <div class="p-name">基础包</div>
        <div class="p-price"><span class="cur">$</span>25</div>
        <div class="p-amount">100 万字符 · 轻量入门</div>
        <ul>
          <li>${ICONS.check} 100 万翻译字符</li>
          <li>${ICONS.check} 全部平台支持</li>
          <li>${ICONS.check} 群发群管功能</li>
          <li>${ICONS.check} 7×24 小时支持</li>
        </ul>
        <a href="/login" class="btn btn-ghost">选择基础包</a>
      </div>
      <div class="plan hot fade-up">
        <div class="badge">最受欢迎</div>
        <div class="p-name">标准包</div>
        <div class="p-price"><span class="cur">$</span>48</div>
        <div class="p-amount">150 万字符 · 主流之选</div>
        <ul>
          <li>${ICONS.check} 150 万翻译字符</li>
          <li>${ICONS.check} 全部平台支持</li>
          <li>${ICONS.check} 群发群管功能</li>
          <li>${ICONS.check} 智能回复优先队列</li>
          <li>${ICONS.check} 7×24 小时支持</li>
        </ul>
        <a href="/login" class="btn btn-primary">选择标准包</a>
      </div>
      <div class="plan fade-up">
        <div class="p-name">大包</div>
        <div class="p-price"><span class="cur">$</span>128</div>
        <div class="p-amount">450 万字符 · 团队之选</div>
        <ul>
          <li>${ICONS.check} 450 万翻译字符</li>
          <li>${ICONS.check} 全部平台支持</li>
          <li>${ICONS.check} 群发群管功能</li>
          <li>${ICONS.check} 智能回复优先队列</li>
          <li>${ICONS.check} 专属客服支持</li>
        </ul>
        <a href="/login" class="btn btn-ghost">选择大包</a>
      </div>
    </div>
  </section>

  <section class="section" id="download">
    <div class="download fade-up">
      <div class="big-icon">${ICONS.down}</div>
      <h2>下载客户端</h2>
      <p>Windows 桌面版，登录即可使用</p>
      <div class="version-pill">当前版本 v${VERSION} · 自动更新</div>
      <div><a href="/download" class="btn btn-primary" style="font-size:15px;padding:14px 34px">${ICONS.down} 下载 Windows 版</a></div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="section-head fade-up">
      <div class="kicker">FAQ</div>
      <h2>常见问题</h2>
      <p>下载前最常遇到的问题，这里一次说清。</p>
    </div>
    <div class="faq fade-up">
      <details><summary>注册赠送的字符会过期吗？</summary><p>不会。注册赠送和后续购买的都是字符余额，没有订阅到期时间；翻译成功后按实际字符用量扣减。</p></details>
      <details><summary>一个客户端可以同时登录多少个平台？</summary><p>可以按需要组合添加 WhatsApp、Telegram 和 LINE 账号。每个账号使用独立会话环境，互不共享登录状态。</p></details>
      <details><summary>购买字符包后多久可以到账？</summary><p>在个人中心创建 USDT（TRC20）订单并按页面显示的精确金额转账。链上确认后系统会自动增加字符余额，个人中心会同步显示订单状态。</p></details>
      <details><summary>聊天记录会上传到极客账户吗？</summary><p>极客账户服务用于登录、字符余额与订单。聊天平台的会话数据保存在各自隔离的客户端环境中，不作为账户后台数据上传。</p></details>
      <details><summary>忘记密码怎么办？</summary><p>在登录页选择“忘记密码”，提交注册邮箱。若账户存在，系统会发送或安排一次性重置链接；统一提示不会暴露邮箱是否注册。</p></details>
    </div>
  </section>
`, 'home');

const LOGIN = layout(`
  <section style="padding:64px 0 88px">
    <div style="max-width:400px;margin:0 auto">
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="font-size:30px;font-weight:800;letter-spacing:-.5px;margin-bottom:8px" id="login-title">欢迎回来</h1>
        <p style="color:var(--text-dim);font-size:14.5px" id="login-sub">登录极客账户，继续使用</p>
      </div>
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:20px;padding:30px;backdrop-filter:blur(12px)">
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:12.5px;color:var(--text-dim);margin-bottom:7px">邮箱</label>
          <input type="email" id="email" placeholder="you@example.com" spellcheck="false" style="width:100%;padding:13px 16px;font-size:14.5px;color:var(--text);background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;outline:none;transition:border-color .15s">
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:12.5px;color:var(--text-dim);margin-bottom:7px">密码</label>
          <input type="password" id="password" minlength="10" maxlength="128" autocomplete="current-password" placeholder="至少 10 位密码" style="width:100%;padding:13px 16px;font-size:14.5px;color:var(--text);background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;outline:none;transition:border-color .15s">
        </div>
        <button class="btn btn-primary" id="btn-login" style="width:100%;padding:14px;font-size:15px">登 录</button>
        <div id="err" style="color:#f87171;font-size:13px;margin-top:12px;min-height:18px"></div>
        <div style="text-align:center;margin-top:14px;color:var(--text-dim);font-size:13.5px" id="switch-line">还没有账号？<a onclick="toggle()" style="color:var(--accent);cursor:pointer;font-weight:600">注册</a></div>
        <div style="text-align:center;margin-top:10px;font-size:13px"><a href="/forgot-password" style="color:var(--text-dim)">忘记密码？</a></div>
      </div>
    </div>
  </section>
  <script>
  let isRegister = false;
  function toggle() {
    isRegister = !isRegister;
    document.getElementById('login-title').textContent = isRegister ? '创建账号' : '欢迎回来';
    document.getElementById('login-sub').textContent = isRegister ? '注册即送 2 万字符，免费体验' : '登录极客账户，继续使用';
    document.getElementById('btn-login').textContent = isRegister ? '注册并登录' : '登 录';
    document.getElementById('switch-line').innerHTML = isRegister
      ? '已有账号？<a onclick="toggle()" style="color:var(--accent);cursor:pointer;font-weight:600">登录</a>'
      : '还没有账号？<a onclick="toggle()" style="color:var(--accent);cursor:pointer;font-weight:600">注册</a>';
    document.getElementById('err').textContent = '';
  }
  document.querySelectorAll('input').forEach(i => i.addEventListener('focus', function(){ this.style.borderColor = 'rgba(79,140,255,.6)'; }));
  document.querySelectorAll('input').forEach(i => i.addEventListener('blur', function(){ this.style.borderColor = 'var(--card-border)'; }));
  document.getElementById('btn-login').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const pass = document.getElementById('password').value;
    const err = document.getElementById('err');
    if (!email || !pass) { err.textContent = '请输入邮箱和密码'; return; }
    if (isRegister && (pass.length < 10 || pass.length > 128)) { err.textContent = '密码需要 10–128 位'; return; }
    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = isRegister ? '注册中…' : '登录中…';
    try {
      if (isRegister) {
        const reg = await fetch('${API_BASE}/api/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
        const regData = await reg.json();
        if (!reg.ok) {
          err.textContent = regData.error === 'email_exists' ? '该邮箱已注册，请直接登录' : '注册失败，请稍后重试';
          return;
        }
      }
      const res = await fetch('${API_BASE}/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
      const data = await res.json();
      if (!res.ok) {
        err.textContent = data.error === 'invalid_credentials' ? '邮箱或密码错误' : data.error === 'account_disabled' ? '账号已被封禁，请联系客服' : '操作失败，请稍后重试';
        return;
      }
      window.location.href = '/account';
    } catch (e) { err.textContent = '网络错误，请稍后重试'; }
    finally { btn.disabled = false; btn.textContent = isRegister ? '注册并登录' : '登 录'; }
  };
  document.getElementById('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });
  </script>
`, 'login');

const FORGOT_PASSWORD = layout(`
  <section style="padding:70px 0 110px">
    <div style="max-width:440px;margin:0 auto;background:var(--card);border:1px solid var(--card-border);border-radius:20px;padding:34px 30px">
      <h1 style="font-size:28px;margin-bottom:9px">找回密码</h1>
      <p style="color:var(--text-dim);font-size:14px;line-height:1.7;margin-bottom:22px">输入注册邮箱。若账户存在，我们会发送重置链接；邮件尚未配置时，申请会进入运营后台由客服处理。</p>
      <input type="email" id="reset-email" autocomplete="email" placeholder="you@example.com" style="width:100%;padding:13px 16px;color:var(--text);background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;outline:none;margin-bottom:14px">
      <button class="btn btn-primary" id="reset-request" style="width:100%">提交申请</button>
      <div id="reset-message" style="font-size:13px;line-height:1.6;margin-top:14px;min-height:20px"></div>
    </div>
  </section>
  <script>
  document.getElementById('reset-request').onclick = async () => {
    const email = document.getElementById('reset-email').value.trim();
    const message = document.getElementById('reset-message');
    if (!email) { message.style.color = '#f87171'; message.textContent = '请输入注册邮箱'; return; }
    const response = await fetch('/api/password-reset/request', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => null);
    message.style.color = response && response.status !== 429 ? '#4ade80' : '#fbbf24';
    message.textContent = response && response.status === 429 ? '申请过于频繁，请稍后再试' : '申请已提交。如果账户存在，请检查邮箱或联系客服获取一次性重置链接。';
  };
  </script>
`, 'login');

const RESET_PASSWORD = layout(`
  <section style="padding:70px 0 110px">
    <div style="max-width:440px;margin:0 auto;background:var(--card);border:1px solid var(--card-border);border-radius:20px;padding:34px 30px">
      <h1 style="font-size:28px;margin-bottom:9px">设置新密码</h1>
      <p style="color:var(--text-dim);font-size:14px;line-height:1.7;margin-bottom:22px">重置链接 30 分钟有效，只能使用一次。</p>
      <input type="password" id="new-password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="新密码（至少 10 位）" style="width:100%;padding:13px 16px;color:var(--text);background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;outline:none;margin-bottom:12px">
      <input type="password" id="confirm-password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="再次输入新密码" style="width:100%;padding:13px 16px;color:var(--text);background:rgba(255,255,255,.04);border:1px solid var(--card-border);border-radius:12px;outline:none;margin-bottom:14px">
      <button class="btn btn-primary" id="reset-complete" style="width:100%">确认重置</button>
      <div id="reset-message" style="font-size:13px;line-height:1.6;margin-top:14px;min-height:20px"></div>
    </div>
  </section>
  <script>
  document.getElementById('reset-complete').onclick = async () => {
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    const message = document.getElementById('reset-message');
    if (password.length < 10 || password.length > 128) { message.style.color = '#f87171'; message.textContent = '密码需要 10–128 位'; return; }
    if (password !== confirm) { message.style.color = '#f87171'; message.textContent = '两次输入的密码不一致'; return; }
    const token = new URLSearchParams(location.search).get('token') || '';
    const response = await fetch('/api/password-reset/complete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }).catch(() => null);
    if (response && response.ok) { message.style.color = '#4ade80'; message.textContent = '密码已重置，正在跳转登录…'; setTimeout(() => location.href = '/login', 900); return; }
    message.style.color = '#f87171'; message.textContent = '链接无效或已过期，请重新申请';
  };
  </script>
`, 'login');

const ACCOUNT = layout(`
  <section class="desktop-required" aria-labelledby="desktop-required-title">
    <div class="desktop-required-card">
      <div class="sidebar-label">Desktop console</div>
      <h1 id="desktop-required-title">请使用电脑访问用户后台</h1>
      <p>用户后台包含订单表格、付款工作区和账户管理工具，需要更大的屏幕操作。手机端暂不提供压缩版后台。</p>
      <div style="display:flex;justify-content:center;gap:10px">
        <a href="/" class="btn btn-primary">返回官网</a>
        <button type="button" class="btn btn-ghost" onclick="logout()">退出登录</button>
      </div>
    </div>
  </section>

  <div class="dashboard-shell">
    <aside class="dashboard-sidebar" aria-label="用户后台导航">
      <div class="sidebar-account">
        <div class="sidebar-label">当前账户</div>
        <div class="sidebar-email" id="email">正在加载…</div>
      </div>
      <nav class="dashboard-nav">
        <a href="#overview"><span class="nav-icon">01</span>控制台概览</a>
        <a href="#packages"><span class="nav-icon">02</span>字符包与付款</a>
        <a href="#orders"><span class="nav-icon">03</span>订单记录</a>
        <a href="#resources"><span class="nav-icon">04</span>资源与帮助</a>
      </nav>
      <div class="sidebar-support">遇到付款或到账问题？<br><a href="mailto:bbnbbba@gmail.com">联系人工支持</a></div>
    </aside>

    <main class="dashboard-main">
      <header class="dashboard-heading">
        <div>
          <h1>用户后台</h1>
          <p id="welcome-email">正在读取账户信息…</p>
        </div>
        <div class="dashboard-actions">
          <button type="button" class="account-action" id="refresh-account">刷新数据</button>
          <a href="/download" class="btn btn-primary" style="padding:9px 15px">${ICONS.down} 下载客户端</a>
        </div>
      </header>

      <section id="overview" class="metric-grid" aria-label="账户概览">
        <article class="dashboard-card metric primary">
          <div class="metric-label">可用字符余额</div>
          <div class="metric-value" id="quota" aria-live="polite">加载中…</div>
          <div class="metric-note">字符永久有效 · 翻译调用时实时扣减</div>
        </article>
        <article class="dashboard-card metric">
          <div class="metric-label">账户状态</div>
          <div class="metric-value" id="account-state"><span class="status-dot"></span>读取中</div>
          <div class="metric-note" id="member-since">账户信息加载中…</div>
          <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;margin-top:8px">
            <span class="metric-note">账号号</span>
            <span id="account-no" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;word-break:break-all;color:#8fb7ff;flex:1;min-width:0">加载中…</span>
            <button type="button" class="copy-btn" id="copy-account-no" disabled style="padding:4px 8px;font-size:11px">复制</button>
          </div>
        </article>
        <article class="dashboard-card metric">
          <div class="metric-label">最近订单</div>
          <div class="metric-value" id="latest-order-status">读取中</div>
          <div class="metric-note" id="latest-order-note">正在同步订单记录</div>
        </article>
        <article class="dashboard-card metric">
          <div class="metric-label">当前客户端</div>
          <div class="metric-value">v${VERSION}</div>
          <div class="metric-note">Windows 版本 · 登录同一账户即可同步余额</div>
        </article>
      </section>
      <div id="account-message" role="status" style="color:var(--text-dim);font-size:12px;min-height:18px;margin:9px 2px 0"></div>

      <section id="packages" class="dashboard-section">
        <div class="dashboard-card section-card">
          <div class="section-toolbar">
            <div><h2>字符包与付款</h2><p>一次购买，永久有效；USDT 到账后系统自动增加余额。</p></div>
            <span style="color:#8fb7ff;font-size:12px">USDT · TRC20</span>
          </div>
          <div class="mini-plans">
            <article class="mini-plan">
              <div class="mini-plan-name">基础包</div><div class="mini-plan-price">$25</div><div class="mini-plan-chars">100 万字符</div>
              <button class="btn btn-ghost" onclick="buy('basic')">创建订单</button>
            </article>
            <article class="mini-plan recommended">
              <span class="recommended-badge">推荐</span><div class="mini-plan-name">标准包</div><div class="mini-plan-price">$48</div><div class="mini-plan-chars">150 万字符</div>
              <button class="btn btn-primary" onclick="buy('standard')">创建订单</button>
            </article>
            <article class="mini-plan">
              <div class="mini-plan-name">大包</div><div class="mini-plan-price">$128</div><div class="mini-plan-chars">450 万字符</div>
              <button class="btn btn-ghost" onclick="buy('pro')">创建订单</button>
            </article>
          </div>
          <div id="order-box"></div>
          <div id="ok" role="status" style="color:#4ade80;font-size:13px;margin-top:12px"></div>
          <div id="err" role="alert" style="color:#f87171;font-size:13px;margin-top:12px"></div>
        </div>
      </section>

      <section id="orders" class="dashboard-section">
        <div class="dashboard-card section-card">
          <div class="section-toolbar">
            <div><h2>最近订单</h2><p>显示最近 10 笔订单及付款状态。</p></div>
            <button type="button" class="account-action" id="refresh-orders">刷新订单</button>
          </div>
          <div class="orders-table">
            <div class="order-row order-table-head"><span>订单号</span><span>字符包</span><span>金额</span><span>创建日期</span><span style="text-align:right">状态</span></div>
            <div id="orders-list"><div class="orders-empty">正在加载订单…</div></div>
          </div>
        </div>
      </section>

      <section id="resources" class="dashboard-section">
        <div class="section-toolbar"><div><h2>资源与帮助</h2><p>从下载到首次使用，常用入口集中在这里。</p></div></div>
        <div class="resource-grid">
          <a class="resource-card primary" href="/download"><strong>下载 Windows 客户端</strong><span>获取 v${VERSION}，安装后登录当前账户。</span></a>
          <a class="resource-card" href="/#guide"><strong>首次使用指南</strong><span>安装、登录和添加第一个聊天账号。</span></a>
          <a class="resource-card" href="/#faq"><strong>常见问题</strong><span>查看余额、平台支持和使用说明。</span></a>
          <a class="resource-card" href="/forgot-password"><strong>账户安全</strong><span>忘记密码时提交重置申请。</span></a>
        </div>
      </section>
    </main>
  </div>
  <script>
  const API = '${API_BASE}';
  async function api(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const res = await fetch(API + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function formatDate(value) {
    if (!value) return '';
    const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  async function load() {
    const message = document.getElementById('account-message');
    message.textContent = '正在同步账户数据…';
    try {
      const me = await api('/api/me');
      if (me.status !== 200) { window.location.href = '/login'; return; }
      const email = me.data.user?.email || '';
      document.getElementById('email').textContent = email;
      document.getElementById('welcome-email').textContent = email ? email + '，欢迎回来' : '欢迎回来';
      document.getElementById('account-state').innerHTML = '<span class="status-dot"></span>正常';
      const created = formatDate(me.data.user?.created_at);
      document.getElementById('member-since').textContent = created ? '注册于 ' + created : '账户可正常使用';
      const accountNo = String(me.data.user?.account_no || '');
      const accountNoEl = document.getElementById('account-no');
      const accountNoButton = document.getElementById('copy-account-no');
      accountNoEl.textContent = accountNo || '暂不可用';
      accountNoButton.disabled = !accountNo;
      accountNoButton.onclick = accountNo ? (event) => copyValue(accountNo, '账号号', event.currentTarget) : null;
      const { data } = await api('/api/quota');
      const q = data.remaining_chars ?? 0;
      document.getElementById('quota').textContent = q.toLocaleString() + ' 字符';
      await loadOrders();
      message.textContent = '账户数据已同步';
    } catch (e) {
      document.getElementById('quota').textContent = '暂时无法加载';
      document.getElementById('account-state').textContent = '同步失败';
      const accountNoEl = document.getElementById('account-no');
      const accountNoButton = document.getElementById('copy-account-no');
      accountNoEl.textContent = '暂不可用';
      accountNoButton.disabled = true;
      accountNoButton.onclick = null;
      message.textContent = '网络异常，请点击“刷新数据”重试';
    }
  }
  async function loadOrders() {
    const box = document.getElementById('orders-list');
    const latestStatus = document.getElementById('latest-order-status');
    const latestNote = document.getElementById('latest-order-note');
    box.innerHTML = '<div class="orders-empty">正在加载订单…</div>';
    const result = await api('/api/orders').catch(() => null);
    if (!result) {
      box.innerHTML = '<div class="orders-empty">订单加载失败，请点击刷新重试</div>';
      latestStatus.textContent = '同步失败'; latestNote.textContent = '请刷新订单后重试'; return;
    }
    if (result.status !== 200) {
      box.innerHTML = '<div class="orders-empty">订单加载失败</div>';
      latestStatus.textContent = '同步失败'; latestNote.textContent = '暂时无法读取订单'; return;
    }
    const orders = Array.isArray(result.data.orders) ? result.data.orders.slice(0, 10) : [];
    if (!orders.length) {
      box.innerHTML = '<div class="orders-empty">暂无订单，选择上方字符包即可创建第一笔订单。</div>';
      latestStatus.textContent = '暂无订单'; latestNote.textContent = '字符包购买记录会显示在这里'; return;
    }
    const planNames = { basic: '基础包', standard: '标准包', pro: '大包' };
    const statusNames = { pending: '等待付款', processing: '确认中', paid: '已到账', cancelled: '已取消', expired: '已过期' };
    latestStatus.textContent = statusNames[orders[0].status] || '处理中';
    latestNote.textContent = '#' + (Number(orders[0].id) || 0) + ' · ' + (planNames[orders[0].plan] || '字符包');
    const nodes = orders.map(order => {
      const row = document.createElement('div');
      row.className = 'order-row';
      const created = formatDate(order.created_at);
      const exactAmount = Number.isFinite(Number(order.amount_cents)) && Number(order.amount_cents) > 0 ? (Number(order.amount_cents) / 100).toFixed(2) : (Number(order.amount) || 0);
      const number = document.createElement('span');
      number.textContent = '#' + (Number(order.id) || 0);
      const plan = document.createElement('span');
      plan.textContent = planNames[order.plan] || '字符包';
      const amount = document.createElement('span');
      amount.textContent = '$' + exactAmount;
      const date = document.createElement('span');
      date.textContent = created || '—';
      const status = document.createElement('span');
      status.className = 'order-status';
      status.textContent = statusNames[order.status] || '处理中';
      status.style.color = order.status === 'paid' ? '#4ade80' : order.status === 'pending' ? '#fbbf24' : 'var(--text-dim)';
      row.append(number, plan, amount, date, status);
      return row;
    });
    box.replaceChildren(...nodes);
  }
  async function copyValue(value, label, button) {
    const message = document.getElementById('account-message');
    try {
      await navigator.clipboard.writeText(String(value));
      message.textContent = label + '已复制';
      if (button) { const before = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = before; }, 1400); }
    } catch (error) {
      message.textContent = '复制失败，请长按或选中文本复制';
    }
  }
  async function buy(plan) {
    const ok = document.getElementById('ok'); const er = document.getElementById('err');
    ok.textContent = ''; er.textContent = '';
    const names = { basic: '基础包 · 100万字符', standard: '标准包 · 150万字符', pro: '大包 · 450万字符' };
    try {
      const { status, data } = await api('/api/orders', { plan, pay_method: 'usdt' });
      if (status !== 200) { er.textContent = data.error || '下单失败'; return; }
      const pay = data.pay || {};
      if (pay.method === 'usdt' && pay.usdt_address) {
        // USDT 支付：显示当前订单地址二维码 + 唯一金额 + 自动检测到账
        document.getElementById('order-box').innerHTML =
          '<div class="payment-workspace">' +
            '<div class="payment-heading"><div><div style="font-weight:700;font-size:16px">' + esc(names[data.order.plan] || data.order.plan) + '</div><div style="color:var(--text-dim);font-size:12px;margin-top:4px">订单号 <b style="color:var(--text)">#' + data.order.id + '</b> · USDT (TRC20)</div></div><div id="usdt-status"><span style="display:inline-block;padding:5px 14px;border-radius:100px;font-size:12px;background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.3)">等待链上确认</span></div></div>' +
            '<div style="background:#fff;border-radius:12px;padding:12px;width:176px;height:176px">' +
              '<img id="usdt-qr" src="/payment-qr?address=' + encodeURIComponent(pay.usdt_address) + '" width="152" height="152" style="width:152px;height:152px;display:block" alt="USDT TRC20 收款地址二维码">' +
              '<div id="usdt-qr-fallback" style="display:none;width:152px;height:152px;align-items:center;justify-content:center;text-align:center;color:#111827;font-size:12px;line-height:1.5">二维码不可用<br>请复制地址</div>' +
            '</div>' +
            '<div>' +
              '<div style="color:var(--text-dim);font-size:12.5px;margin-bottom:4px">请转账以下精确金额</div>' +
              '<div class="copy-row"><div style="font-size:34px;font-weight:800;letter-spacing:-1px;color:#00e5a0" id="usdt-amount">$' + esc(pay.usdt_amount_display) + '</div><button type="button" class="copy-btn" id="copy-usdt-amount">复制金额</button></div>' +
              '<div style="color:var(--text-faint);font-size:12px;margin-top:2px">精确金额用于自动识别订单，请勿自行取整。</div>' +
              '<div style="color:var(--text-dim);font-size:12.5px;margin-top:14px;margin-bottom:4px">USDT (TRC20) 收款地址</div>' +
              '<div class="copy-row"><div style="font-size:12.5px;color:#8fb7ff;word-break:break-all;line-height:1.5;flex:1;min-width:180px" id="usdt-addr">' + esc(pay.usdt_address) + '</div><button type="button" class="copy-btn" id="copy-usdt-address">复制地址</button></div>' +
              '<div style="color:var(--text-dim);font-size:12px;line-height:1.65;margin-top:14px">使用支持 TRC20 的钱包扫码或复制地址。到账后系统会自动更新订单状态与字符余额。</div>' +
            '</div>' +
          '</div>';
        const qrImage = document.getElementById('usdt-qr');
        qrImage?.addEventListener('error', () => {
          qrImage.style.display = 'none';
          const fallback = document.getElementById('usdt-qr-fallback');
          if (fallback) fallback.style.display = 'flex';
        }, { once: true });
        document.getElementById('copy-usdt-amount')?.addEventListener('click', (event) => copyValue(pay.usdt_amount_display, '精确金额', event.currentTarget));
        document.getElementById('copy-usdt-address')?.addEventListener('click', (event) => copyValue(pay.usdt_address, '收款地址', event.currentTarget));
        ok.textContent = '订单已生成，扫码转账后自动到账';
        await loadOrders();
        startUsdtPoll(data.order.id);
      } else {
        // 降级：手动确认（未配置 USDT 地址时）
        document.getElementById('order-box').innerHTML =
          '<div style="background:rgba(0,229,160,.05);border:1px solid rgba(0,229,160,.25);border-radius:14px;padding:18px;margin-top:18px">' +
          '<div style="font-weight:600">' + esc(names[data.order.plan] || data.order.plan) + '</div>' +
          '<div style="font-size:26px;font-weight:800;margin:6px 0">$' + data.order.amount + '</div>' +
          '<div style="color:var(--text-dim);font-size:13px;line-height:1.7">订单号 <b style="color:var(--text)">#' + data.order.id + '</b><br>联系客服转账对应金额，客服确认后自动到账。</div>' +
          '<button class="btn btn-ghost" style="margin-top:14px;padding:8px 18px" onclick="refreshOrder()">我已完成付款，刷新</button>' +
          '</div>';
        ok.textContent = '订单已生成，请完成付款';
        await loadOrders();
      }
    } catch (e) { er.textContent = '网络错误，请稍后重试'; }
  }
  // 轮询订单状态：每 5 秒查一次，到账自动更新余额
  let usdtPollTimer = null;
  async function startUsdtPoll(orderId) {
    if (usdtPollTimer) clearInterval(usdtPollTimer);
    usdtPollTimer = setInterval(async () => {
      try {
        const { data } = await api('/api/orders');
        const order = (data.orders || []).find(o => o.id === orderId);
        if (order && order.status === 'paid') {
          clearInterval(usdtPollTimer);
          document.getElementById('usdt-status').innerHTML =
            '<span style="display:inline-block;padding:5px 14px;border-radius:100px;font-size:12.5px;background:rgba(74,222,128,.12);color:#4ade80;border:1px solid rgba(74,222,128,.3)">✅ 已到账！正在为你开通…</span>';
          ok.textContent = '✅ 支付成功，字符已到账！';
          const q = await api('/api/quota');
          document.getElementById('quota').textContent = (q.data.remaining_chars ?? 0).toLocaleString() + ' 字符';
          await loadOrders();
        } else if (order && order.status === 'expired') {
          clearInterval(usdtPollTimer);
          document.getElementById('usdt-status').innerHTML =
            '<span style="display:inline-block;padding:5px 14px;border-radius:100px;font-size:12.5px;background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.3)">订单已过期，请重新下单</span>';
          ok.textContent = '';
        }
      } catch (e) { /* 轮询失败静默 */ }
    }, 5000);
  }
  async function refreshOrder() {
    const ok = document.getElementById('ok'); const er = document.getElementById('err');
    ok.textContent = ''; er.textContent = '';
    try {
      const { data } = await api('/api/quota');
      document.getElementById('quota').textContent = (data.remaining_chars ?? 0).toLocaleString() + ' 字符';
      await loadOrders();
      ok.textContent = '已刷新，当前剩余 ' + (data.remaining_chars ?? 0).toLocaleString() + ' 字符';
    } catch (e) { er.textContent = '网络错误'; }
  }
  document.getElementById('refresh-account').addEventListener('click', load);
  document.getElementById('refresh-orders').addEventListener('click', loadOrders);
  load();
  </script>
`, 'account');

function faviconResponse() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4f8cff"/><stop offset=".55" stop-color="#00e5a0"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#0a0d14"/><rect x="12" y="24" width="26" height="18" rx="5" fill="#111a2d" stroke="#7db4ff" stroke-width="2"/><rect x="32" y="10" width="20" height="14" rx="4" fill="#08221d" stroke="#00e5a0" stroke-width="2"/><path d="M40 43c7-6 9-13 7-20" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round"/><path d="m50 20-5 3 2-6z" fill="url(#g)"/></svg>`;
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function paymentQrResponse(address) {
  const value = String(address || '').trim();
  if (!isTronAddress(value)) {
    return new Response('invalid payment address', {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return new Response(renderTronAddressQrSvg(value), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function html(content, status = 200) {
  return new Response(content, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  } });
}

async function proxyApi(request, path) {
  const headers = new Headers();
  for (const name of ['Content-Type', 'Authorization', 'Cookie']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Origin', SUBSCRIPTION_API);
  const upstream = await fetch(SUBSCRIPTION_API + path, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
  const responseHeaders = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const cookie = upstream.headers.get('Set-Cookie');
  if (cookie) responseHeaders.set('Set-Cookie', cookie);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/favicon.svg' || path === '/favicon.ico')) return faviconResponse();
    if (request.method === 'GET' && path === '/payment-qr') return paymentQrResponse(url.searchParams.get('address'));

    if (path.startsWith('/api/')) return proxyApi(request, path + url.search);

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) return html(withLatestVersion(HOME, await latestVersion()));
    if (request.method === 'GET' && path === '/login') return html(withLatestVersion(LOGIN, await latestVersion()));
    if (request.method === 'GET' && path === '/forgot-password') return html(withLatestVersion(FORGOT_PASSWORD, await latestVersion()));
    if (request.method === 'GET' && path === '/reset-password') return html(withLatestVersion(RESET_PASSWORD, await latestVersion()));
    if (request.method === 'GET' && path === '/account') return html(withLatestVersion(ACCOUNT, await latestVersion()));
    if (request.method === 'GET' && path === '/download') {
      return Response.redirect(`${RELEASE_BASE}/geek-setup-${await latestVersion()}.exe`, 302);
    }
    if (request.method === 'GET' && path === '/health') return new Response(JSON.stringify({ ok: true, service: 'geek-website', version: await latestVersion() }), { headers: { 'Content-Type': 'application/json' } });

    return html('<div style="font-family:system-ui;color:#9aa3b2;padding:80px;text-align:center;background:#05060a;min-height:100vh"><h1 style="font-size:60px;font-weight:800;margin-bottom:12px">404</h1><p>页面不存在</p><a href="/" style="color:#4f8cff;margin-top:16px;display:inline-block">← 返回首页</a></div>', 404);
  },
};
