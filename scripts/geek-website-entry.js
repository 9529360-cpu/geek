import baseWorker from './geek-website-worker.js';

const HOME_PATH = '/';
const RESET_PATH = '/reset-password';
const RESET_HANDLER_MARKER = "  document.getElementById('reset-complete').onclick = async () => {";
const RESET_TOKEN_READ = "    const token = new URLSearchParams(location.search).get('token') || '';";
const RESET_TOKEN_CAPTURE = [
  "  const resetToken = new URLSearchParams(location.search).get('token') || '';",
  "  if (resetToken) history.replaceState(null, '', location.pathname);",
].join('\n');

const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#08090a">
<title>极客 Geek · 多平台多账号出海沟通工作台</title>
<meta name="description" content="极客 Geek 把 WhatsApp、Telegram、LINE 多账号放进同一个 Windows 工作台，提供账号隔离、消息翻译与账号级群发任务。">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root {
    --bg: #08090a;
    --bg-panel: #0f1011;
    --bg-surface: #151719;
    --bg-raised: #1b1d20;
    --text: #f7f8f8;
    --text-2: #c7cbd0;
    --text-3: #8a8f98;
    --text-4: #62666d;
    --line: rgba(255,255,255,.09);
    --line-strong: rgba(255,255,255,.15);
    --accent: #25d366;
    --accent-hi: #4ce180;
    --accent-soft: rgba(37,211,102,.12);
    --cyan: #4bd8ff;
    --warn: #f7c873;
    --radius: 18px;
    --shadow: 0 34px 90px rgba(0,0,0,.48);
    --font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
  body::before {
    content: ""; position: fixed; inset: 0 0 auto; height: 760px; pointer-events: none; z-index: 0;
    background:
      radial-gradient(circle at 74% 13%, rgba(37,211,102,.09), transparent 30%),
      radial-gradient(circle at 28% 5%, rgba(75,216,255,.06), transparent 28%),
      linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
    background-size: auto, auto, 56px 56px, 56px 56px;
    mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,.7) 58%, transparent 100%);
  }
  a { color: inherit; text-decoration: none; }
  button, a { -webkit-tap-highlight-color: transparent; }
  :focus-visible { outline: 2px solid var(--accent-hi); outline-offset: 4px; }
  ::selection { background: rgba(37,211,102,.28); color: #fff; }
  .skip-link { position: fixed; top: 10px; left: 10px; transform: translateY(-180%); z-index: 99; padding: 10px 14px; border-radius: 10px; background: #fff; color: #111; font-weight: 700; }
  .skip-link:focus { transform: none; }
  .page { position: relative; z-index: 1; }
  .shell { width: min(1180px, calc(100% - 48px)); margin: 0 auto; }
  .hairline { border-top: 1px solid var(--line); }

  .site-header { position: sticky; top: 0; z-index: 40; border-bottom: 1px solid transparent; background: rgba(8,9,10,.74); backdrop-filter: blur(18px); }
  .nav { height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 28px; }
  .brand { display: inline-flex; align-items: center; gap: 11px; min-width: 150px; font-weight: 720; letter-spacing: -.02em; }
  .brand-mark { width: 34px; height: 34px; display: block; flex: none; }
  .brand-copy { display: flex; align-items: baseline; gap: 7px; }
  .brand-copy small { color: var(--text-4); font-size: 10px; letter-spacing: .12em; font-weight: 700; }
  .nav-links { display: flex; align-items: center; gap: 30px; margin-left: auto; }
  .nav-links a { color: var(--text-3); font-size: 13px; font-weight: 560; transition: color .16s ease; }
  .nav-links a:hover { color: var(--text); }
  .nav-actions { display: flex; align-items: center; gap: 10px; }
  .nav-login { color: var(--text-2); font-size: 13px; font-weight: 600; padding: 9px 10px; }
  .btn { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; border-radius: 11px; padding: 0 18px; font-size: 13px; font-weight: 680; letter-spacing: -.01em; transition: transform .16s ease, background .16s ease, border-color .16s ease; }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary { color: #061109; background: var(--accent); box-shadow: 0 8px 28px rgba(37,211,102,.14); }
  .btn-primary:hover { background: var(--accent-hi); }
  .btn-secondary { color: var(--text); border: 1px solid var(--line-strong); background: rgba(255,255,255,.035); }
  .btn-secondary:hover { background: rgba(255,255,255,.065); border-color: rgba(255,255,255,.22); }
  .arrow { font-size: 16px; line-height: 1; }

  .hero { padding: 112px 0 96px; display: grid; grid-template-columns: minmax(0, .82fr) minmax(520px, 1.18fr); align-items: center; gap: 76px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 9px; color: var(--text-3); font-size: 12px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
  .eyebrow::before { content: ""; width: 20px; height: 1px; background: var(--accent); box-shadow: 0 0 16px rgba(37,211,102,.55); }
  .hero h1 { margin: 22px 0 24px; max-width: 620px; font-size: clamp(52px, 6vw, 78px); line-height: .99; letter-spacing: -.065em; font-weight: 760; }
  .hero h1 span { color: var(--text-3); }
  .hero-lede { margin: 0; max-width: 610px; color: var(--text-2); font-size: 17px; line-height: 1.82; letter-spacing: -.01em; }
  .hero-actions { margin-top: 34px; display: flex; flex-wrap: wrap; gap: 12px; }
  .hero-notes { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 9px 16px; color: var(--text-3); font-size: 12px; }
  .hero-notes span { display: inline-flex; align-items: center; gap: 7px; }
  .hero-notes i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 9px rgba(37,211,102,.6); }

  .product-wrap { position: relative; min-width: 0; }
  .product-wrap::before { content: ""; position: absolute; inset: 12% -8% -12% 22%; background: radial-gradient(circle, rgba(37,211,102,.12), transparent 62%); filter: blur(34px); pointer-events: none; }
  .product-window { position: relative; min-height: 566px; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 20px; background: #0b0c0d; box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,.04); }
  .window-bar { height: 45px; display: flex; align-items: center; padding: 0 15px; border-bottom: 1px solid var(--line); background: #101112; }
  .traffic { display: flex; gap: 6px; }
  .traffic i { display: block; width: 8px; height: 8px; border-radius: 50%; background: #34373b; }
  .window-title { margin: 0 auto; padding-right: 44px; color: var(--text-4); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .app-shot { height: 521px; display: grid; grid-template-columns: 158px 1fr; }
  .account-rail { padding: 14px 11px; border-right: 1px solid var(--line); background: #0e0f10; }
  .shot-brand { display: flex; align-items: center; gap: 8px; padding: 3px 5px 15px; color: var(--text-2); font-size: 11px; font-weight: 700; }
  .shot-brand .mini-logo { width: 21px; height: 21px; border-radius: 7px; display: grid; place-items: center; background: #191b1d; color: var(--accent); font-weight: 800; border: 1px solid var(--line); }
  .rail-label { margin: 6px 6px 8px; color: #555b62; font-size: 8px; letter-spacing: .12em; text-transform: uppercase; }
  .account-item { display: grid; grid-template-columns: 28px minmax(0,1fr) 7px; align-items: center; gap: 8px; padding: 8px; margin: 4px 0; border: 1px solid transparent; border-radius: 9px; }
  .account-item.active { border-color: rgba(37,211,102,.32); background: rgba(37,211,102,.09); }
  .platform-badge { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: #fff; font-size: 8px; font-weight: 800; letter-spacing: .02em; }
  .platform-badge.wa { background: #176b37; }
  .platform-badge.tg { background: #216e9d; }
  .platform-badge.line { background: #267c36; }
  .account-copy { min-width: 0; }
  .account-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); font-size: 9px; font-weight: 630; }
  .account-copy small { display: block; margin-top: 3px; color: #555a60; font-size: 7px; }
  .state-dot { width: 6px; height: 6px; border-radius: 50%; background: #3d4247; }
  .state-dot.live { background: var(--accent); box-shadow: 0 0 8px rgba(37,211,102,.6); }
  .state-dot.send { background: var(--warn); box-shadow: 0 0 8px rgba(247,200,115,.45); }
  .shot-main { position: relative; display: flex; flex-direction: column; min-width: 0; background: #0b0c0d; }
  .shot-top { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 17px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.015); }
  .chat-avatar { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg,#5c6270,#2d3137); border: 1px solid rgba(255,255,255,.12); }
  .chat-title strong { display: block; font-size: 10px; color: var(--text-2); }
  .chat-title small { display: block; margin-top: 2px; color: #555b62; font-size: 7px; }
  .shot-tools { margin-left: auto; display: flex; gap: 6px; }
  .tool-chip { padding: 5px 7px; border: 1px solid var(--line); border-radius: 7px; color: #777d85; background: rgba(255,255,255,.025); font-size: 7px; }
  .tool-chip.on { color: #a8f5c2; border-color: rgba(37,211,102,.24); background: rgba(37,211,102,.08); }
  .conversation { flex: 1; padding: 31px 26px 85px; overflow: hidden; position: relative; }
  .conversation::before { content: ""; position: absolute; inset: 0; opacity: .14; background-image: radial-gradient(rgba(255,255,255,.17) .6px, transparent .6px); background-size: 16px 16px; }
  .message-row { position: relative; z-index: 1; display: flex; margin-bottom: 16px; }
  .message-row.me { justify-content: flex-end; }
  .bubble { max-width: 76%; padding: 11px 13px; border-radius: 11px; border: 1px solid var(--line); background: #151718; color: #bbc0c5; font-size: 9px; line-height: 1.55; box-shadow: 0 8px 28px rgba(0,0,0,.15); }
  .me .bubble { background: rgba(37,211,102,.10); border-color: rgba(37,211,102,.23); }
  .translation { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.07); color: #e2e5e8; }
  .translation small { display: inline-flex; align-items: center; margin-right: 5px; color: var(--accent-hi); font-size: 6px; text-transform: uppercase; letter-spacing: .08em; }
  .composer { position: absolute; z-index: 2; left: 17px; right: 17px; bottom: 17px; height: 47px; display: flex; align-items: center; padding: 0 12px; border: 1px solid var(--line); border-radius: 11px; background: #121415; color: #5f656b; font-size: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.28); }
  .composer .send-dot { margin-left: auto; width: 27px; height: 27px; display: grid; place-items: center; border-radius: 8px; background: var(--accent); color: #071108; font-size: 12px; font-weight: 900; }
  .broadcast-float { position: absolute; right: 18px; bottom: 76px; z-index: 5; width: 220px; padding: 14px; border: 1px solid rgba(255,255,255,.13); border-radius: 13px; background: rgba(24,26,27,.96); box-shadow: 0 20px 46px rgba(0,0,0,.42); }
  .broadcast-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #d9dde0; font-size: 9px; font-weight: 680; }
  .broadcast-state { color: var(--warn); font-size: 7px; font-weight: 700; }
  .broadcast-meta { margin-top: 7px; color: #70767d; font-size: 7px; }
  .progress { height: 4px; margin-top: 10px; overflow: hidden; border-radius: 99px; background: #303336; }
  .progress::after { content: ""; display: block; width: 36%; height: 100%; border-radius: inherit; background: var(--accent); }
  .broadcast-foot { display: flex; justify-content: space-between; margin-top: 8px; color: #777d83; font-size: 7px; }
  .shot-caption { position: absolute; right: 12px; top: -28px; color: var(--text-4); font-size: 10px; }

  .signal-bar { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .signals { min-height: 92px; display: grid; grid-template-columns: repeat(4, 1fr); align-items: stretch; }
  .signal { display: flex; align-items: center; gap: 12px; padding: 20px 24px; border-right: 1px solid var(--line); }
  .signal:last-child { border-right: 0; }
  .signal-num { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 9px; color: var(--accent-hi); background: var(--accent-soft); font-size: 11px; font-weight: 760; }
  .signal strong { display: block; font-size: 12px; color: var(--text-2); }
  .signal small { display: block; margin-top: 3px; color: var(--text-4); font-size: 10px; line-height: 1.45; }

  .section { padding: 128px 0; }
  .section.compact { padding: 102px 0; }
  .section-head { display: grid; grid-template-columns: .72fr 1.28fr; align-items: end; gap: 70px; margin-bottom: 58px; }
  .kicker { color: var(--accent-hi); font-size: 11px; font-weight: 720; letter-spacing: .16em; text-transform: uppercase; }
  .section h2 { margin: 13px 0 0; max-width: 650px; font-size: clamp(36px, 4.6vw, 58px); line-height: 1.05; letter-spacing: -.052em; font-weight: 720; }
  .section-intro { margin: 0; max-width: 580px; color: var(--text-3); font-size: 15px; line-height: 1.85; }

  .workflow-grid { display: grid; grid-template-columns: repeat(3,1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .workflow-item { min-height: 260px; padding: 32px 30px 34px; border-right: 1px solid var(--line); }
  .workflow-item:last-child { border-right: 0; }
  .workflow-index { display: flex; align-items: center; justify-content: space-between; margin-bottom: 72px; color: var(--text-4); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .workflow-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.025); color: var(--text-2); }
  .workflow-item h3 { margin: 0 0 10px; font-size: 17px; letter-spacing: -.025em; }
  .workflow-item p { margin: 0; color: var(--text-3); font-size: 13px; line-height: 1.75; }

  .feature-split { display: grid; grid-template-columns: minmax(0,.82fr) minmax(520px,1.18fr); gap: 76px; align-items: center; }
  .feature-split.reverse { grid-template-columns: minmax(520px,1.18fr) minmax(0,.82fr); }
  .feature-copy h2 { margin: 14px 0 18px; }
  .feature-copy p { margin: 0; color: var(--text-3); font-size: 15px; line-height: 1.9; }
  .feature-list { margin: 30px 0 0; padding: 0; list-style: none; display: grid; gap: 14px; }
  .feature-list li { display: grid; grid-template-columns: 19px 1fr; gap: 11px; align-items: start; color: var(--text-2); font-size: 13px; line-height: 1.65; }
  .feature-list li::before { content: ""; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; border: 1px solid rgba(37,211,102,.32); background: radial-gradient(circle,var(--accent) 0 2px,transparent 3px); }

  .demo-panel { position: relative; min-height: 460px; border: 1px solid var(--line); border-radius: 20px; background: #0d0f10; box-shadow: inset 0 1px rgba(255,255,255,.03); overflow: hidden; }
  .demo-panel::before { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,.025), transparent 38%); pointer-events: none; }
  .translate-demo { padding: 34px; display: grid; align-content: center; gap: 20px; }
  .lang-line { display: flex; align-items: center; justify-content: space-between; color: var(--text-4); font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
  .lang-pair { display: flex; align-items: center; gap: 8px; }
  .lang-pill { padding: 6px 9px; border-radius: 8px; border: 1px solid var(--line); color: var(--text-2); background: rgba(255,255,255,.025); font-size: 9px; text-transform: none; letter-spacing: 0; }
  .translation-card { position: relative; padding: 22px; border: 1px solid var(--line); border-radius: 15px; background: #151718; }
  .translation-card.incoming { margin-right: 68px; }
  .translation-card.outgoing { margin-left: 68px; border-color: rgba(37,211,102,.2); background: rgba(37,211,102,.06); }
  .translation-card .tag { color: var(--text-4); font-size: 8px; text-transform: uppercase; letter-spacing: .12em; }
  .translation-card p { margin: 11px 0 0; color: #d5d9dd; font-size: 13px; line-height: 1.7; }
  .translation-card .result { margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line); color: var(--text-2); }
  .translation-card .result b { color: var(--accent-hi); font-size: 8px; margin-right: 7px; letter-spacing: .08em; text-transform: uppercase; }

  .broadcast-demo { padding: 30px; display: grid; align-content: center; gap: 14px; }
  .task-card { display: grid; grid-template-columns: 36px 1fr auto; align-items: center; gap: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 13px; background: #151718; }
  .task-card.live { border-color: rgba(37,211,102,.22); }
  .task-card.queued { opacity: .72; }
  .task-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; background: rgba(255,255,255,.055); color: var(--text-2); font-size: 9px; font-weight: 780; }
  .task-copy strong { display: block; color: var(--text-2); font-size: 11px; }
  .task-copy small { display: block; margin-top: 5px; color: var(--text-4); font-size: 8px; }
  .task-state { text-align: right; color: var(--accent-hi); font-size: 8px; font-weight: 700; }
  .task-state.queue { color: var(--warn); }
  .task-state span { display: block; margin-top: 4px; color: var(--text-4); font-size: 7px; font-weight: 500; }
  .flow-note { margin-top: 10px; padding: 13px 15px; border-left: 2px solid var(--accent); color: var(--text-3); background: rgba(37,211,102,.045); font-size: 9px; line-height: 1.7; }

  .security-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 18px; }
  .security-main, .security-side { border: 1px solid var(--line); border-radius: 20px; background: #0d0f10; }
  .security-main { min-height: 420px; padding: 40px; display: flex; flex-direction: column; justify-content: space-between; }
  .security-main h3 { margin: 0; max-width: 570px; font-size: clamp(30px,4vw,48px); letter-spacing: -.045em; line-height: 1.08; }
  .security-main h3 span { color: var(--text-3); }
  .security-copy { display: grid; grid-template-columns: repeat(2,1fr); gap: 26px; }
  .security-copy div { padding-top: 18px; border-top: 1px solid var(--line); }
  .security-copy strong { font-size: 12px; }
  .security-copy p { margin: 8px 0 0; color: var(--text-4); font-size: 11px; line-height: 1.75; }
  .security-side { padding: 22px; display: grid; gap: 10px; align-content: center; }
  .isolation-row { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.022); }
  .iso-lock { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 11px; color: var(--accent-hi); background: var(--accent-soft); font-size: 15px; }
  .isolation-row strong { display: block; font-size: 10px; }
  .isolation-row small { display: block; margin-top: 4px; color: var(--text-4); font-size: 8px; }
  .isolated { color: var(--accent-hi); font-size: 7px; text-transform: uppercase; letter-spacing: .08em; }

  .start-card { position: relative; overflow: hidden; padding: 70px; border: 1px solid var(--line-strong); border-radius: 24px; background: #0d0f10; }
  .start-card::after { content: ""; position: absolute; width: 520px; height: 520px; right: -170px; top: -250px; border-radius: 50%; background: radial-gradient(circle,rgba(37,211,102,.16),transparent 66%); pointer-events: none; }
  .start-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.15fr .85fr; gap: 70px; align-items: end; }
  .start-card h2 { margin: 14px 0 18px; max-width: 620px; }
  .start-card p { margin: 0; color: var(--text-3); font-size: 14px; line-height: 1.8; }
  .start-actions { display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
  .start-actions .btn { min-height: 50px; }
  .start-facts { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3,1fr); gap: 0; margin-top: 46px; padding-top: 28px; border-top: 1px solid var(--line); }
  .start-fact { padding-right: 24px; }
  .start-fact strong { display: block; font-size: 13px; }
  .start-fact small { display: block; margin-top: 7px; color: var(--text-4); font-size: 10px; line-height: 1.6; }

  footer { padding: 38px 0 44px; border-top: 1px solid var(--line); }
  .footer { display: flex; justify-content: space-between; align-items: center; gap: 24px; color: var(--text-4); font-size: 11px; }
  .footer-brand { display: inline-flex; align-items: center; gap: 9px; color: var(--text-2); font-weight: 700; }
  .footer-brand .brand-mark { width: 25px; height: 25px; }
  .footer-links { display: flex; align-items: center; gap: 20px; }
  .footer-links a:hover { color: var(--text-2); }

  @media (max-width: 1040px) {
    .nav-links { display: none; }
    .hero, .feature-split, .feature-split.reverse { grid-template-columns: 1fr; gap: 56px; }
    .hero { padding-top: 84px; }
    .hero-copy { max-width: 760px; }
    .product-wrap { max-width: 760px; width: 100%; margin: 0 auto; }
    .section-head { grid-template-columns: 1fr; gap: 22px; }
    .security-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .shell { width: min(100% - 32px, 1180px); }
    .nav { height: 64px; }
    .brand-copy small, .nav-login { display: none; }
    .nav-actions .btn { min-height: 38px; padding: 0 13px; font-size: 12px; }
    .hero { padding: 70px 0 66px; }
    .hero h1 { font-size: clamp(44px, 14vw, 64px); }
    .hero-lede { font-size: 15px; line-height: 1.72; }
    .hero-actions { display: grid; grid-template-columns: 1fr; }
    .hero-actions .btn { width: 100%; }
    .product-window { min-height: 480px; border-radius: 15px; }
    .app-shot { height: 435px; grid-template-columns: 84px 1fr; }
    .account-rail { padding: 10px 7px; }
    .shot-brand { padding-left: 2px; }
    .shot-brand span:last-child, .account-copy { display: none; }
    .account-item { grid-template-columns: 28px 1fr; justify-items: center; padding: 6px; }
    .state-dot { justify-self: end; }
    .shot-tools .tool-chip:not(.on) { display: none; }
    .conversation { padding: 24px 14px 80px; }
    .bubble { max-width: 88%; }
    .broadcast-float { width: 174px; right: 10px; bottom: 72px; }
    .signals { grid-template-columns: repeat(2,1fr); }
    .signal:nth-child(2) { border-right: 0; }
    .signal:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
    .section { padding: 90px 0; }
    .workflow-grid { grid-template-columns: 1fr; }
    .workflow-item { min-height: 210px; border-right: 0; border-bottom: 1px solid var(--line); }
    .workflow-item:last-child { border-bottom: 0; }
    .workflow-index { margin-bottom: 42px; }
    .demo-panel { min-height: 400px; }
    .translate-demo, .broadcast-demo { padding: 20px; }
    .translation-card.incoming { margin-right: 22px; }
    .translation-card.outgoing { margin-left: 22px; }
    .security-main { min-height: 480px; padding: 28px; }
    .security-copy { grid-template-columns: 1fr; gap: 16px; }
    .start-card { padding: 40px 26px; }
    .start-grid { grid-template-columns: 1fr; gap: 34px; }
    .start-facts { grid-template-columns: 1fr; gap: 20px; }
    .start-fact { padding: 0 0 18px; border-bottom: 1px solid var(--line); }
    .start-fact:last-child { border-bottom: 0; padding-bottom: 0; }
    .footer { align-items: flex-start; flex-direction: column; }
  }
  @media (max-width: 480px) {
    .product-wrap { width: calc(100% + 8px); margin-left: -4px; }
    .product-window { min-height: 430px; }
    .app-shot { height: 385px; }
    .shot-top { padding: 0 10px; }
    .shot-caption { display: none; }
    .broadcast-float { transform: scale(.92); transform-origin: bottom right; }
    .signal { padding: 17px 14px; }
    .signal-num { display: none; }
    .task-card { grid-template-columns: 32px 1fr; }
    .task-state { grid-column: 2; text-align: left; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
</style>
</head>
<body>
<a class="skip-link" href="#main">跳到主要内容</a>
<div class="page">
  <header class="site-header">
    <div class="shell nav" aria-label="主导航">
      <a class="brand" href="/" aria-label="极客 Geek 首页">
        <svg class="brand-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs><linearGradient id="gx-silver-home" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f7fa"/><stop offset=".55" stop-color="#b9c0c9"/><stop offset="1" stop-color="#7d858f"/></linearGradient><linearGradient id="gx-tile-home" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23252a"/><stop offset="1" stop-color="#101114"/></linearGradient></defs>
          <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#gx-tile-home)" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
          <rect x="31" y="12" width="21" height="14" rx="3.5" fill="none" stroke="#25d366" stroke-width="1.7" opacity=".95"/><circle cx="34.5" cy="15.5" r="1.4" fill="#25d366"/>
          <rect x="35" y="39" width="23" height="17" rx="3.5" fill="none" stroke="#25d366" stroke-width="1.7" opacity=".95"/><circle cx="38.5" cy="42.5" r="1.4" fill="#25d366"/>
          <path d="M18 38 A14.5 14.5 0 1 1 44 29" fill="none" stroke="url(#gx-silver-home)" stroke-width="9.5" stroke-linecap="round"/><path d="M45.5 23 l-2.5 9 l8.5 -4.2 z" fill="url(#gx-silver-home)"/>
        </svg>
        <span class="brand-copy"><span>极客 Geek</span><small>DESKTOP</small></span>
      </a>
      <nav class="nav-links" aria-label="页面区块">
        <a href="#product">产品</a><a href="#translation">翻译</a><a href="#broadcast">群发</a><a href="#security">隔离</a>
      </nav>
      <div class="nav-actions">
        <a class="nav-login" href="/login">登录</a>
        <a class="btn btn-primary" href="/download">下载 Windows 版 <span class="arrow">↘</span></a>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="shell hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow">海外会话工作台</div>
        <h1 id="hero-title">一个桌面，<br><span>接住每个海外客户。</span></h1>
        <p class="hero-lede">把 WhatsApp、Telegram 和 LINE 的多个账号放进同一个工作台。账号独立运行，消息随手翻译，群发任务按账号在后台执行——切换客户，不必切换工作方式。</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="/download">下载 Windows 客户端 <span class="arrow">↘</span></a>
          <a class="btn btn-secondary" href="/login">免费注册 · 赠 2 万字符</a>
        </div>
        <div class="hero-notes" aria-label="产品要点">
          <span><i></i>WhatsApp / Telegram / LINE</span><span><i></i>多账号独立会话</span><span><i></i>翻译与群发同一工作台</span>
        </div>
      </div>

      <div class="product-wrap" aria-label="极客产品界面示意">
        <div class="shot-caption">产品界面示意</div>
        <div class="product-window">
          <div class="window-bar"><div class="traffic"><i></i><i></i><i></i></div><div class="window-title">Geek workspace · accounts isolated</div></div>
          <div class="app-shot">
            <aside class="account-rail" aria-label="账号列表示意">
              <div class="shot-brand"><span class="mini-logo">G</span><span>极客</span></div>
              <div class="rail-label">账号</div>
              <div class="account-item active"><span class="platform-badge wa">WA</span><span class="account-copy"><strong>店铺 · 欧洲</strong><small>WhatsApp</small></span><span class="state-dot live"></span></div>
              <div class="account-item"><span class="platform-badge tg">TG</span><span class="account-copy"><strong>渠道 · Telegram</strong><small>Telegram</small></span><span class="state-dot live"></span></div>
              <div class="account-item"><span class="platform-badge line">LINE</span><span class="account-copy"><strong>客户 · 日本</strong><small>LINE</small></span><span class="state-dot send"></span></div>
              <div class="account-item"><span class="platform-badge wa">WA</span><span class="account-copy"><strong>售后 · 北美</strong><small>WhatsApp</small></span><span class="state-dot"></span></div>
            </aside>
            <section class="shot-main" aria-label="聊天与翻译示意">
              <div class="shot-top">
                <div class="chat-avatar"></div><div class="chat-title"><strong>Marina Rossi</strong><small>WhatsApp · 在线</small></div>
                <div class="shot-tools"><span class="tool-chip">备注</span><span class="tool-chip on">翻译已开启</span><span class="tool-chip">群发</span></div>
              </div>
              <div class="conversation">
                <div class="message-row"><div class="bubble">Ciao, vorrei confermare i tempi di consegna per il nuovo ordine.<div class="translation"><small>译文</small>你好，我想确认一下新订单的交付时间。</div></div></div>
                <div class="message-row me"><div class="bubble">没问题，我现在为你确认最新进度。<div class="translation"><small>Send as IT</small>Certo, controllo subito l'ultimo aggiornamento per te.</div></div></div>
                <div class="composer">输入消息… <span class="send-dot">→</span></div>
              </div>
              <div class="broadcast-float" aria-label="群发任务状态示意">
                <div class="broadcast-head"><span>群发任务 · 店铺欧洲</span><span class="broadcast-state">运行中</span></div>
                <div class="broadcast-meta">已固定 52 个对象 · 间隔 5–10 秒</div>
                <div class="progress"></div>
                <div class="broadcast-foot"><span>18 / 52</span><span>后台继续执行</span></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>

    <div class="signal-bar">
      <div class="shell signals" aria-label="核心能力">
        <div class="signal"><span class="signal-num">01</span><span><strong>多平台多账号</strong><small>一个桌面统一管理不同会话入口</small></span></div>
        <div class="signal"><span class="signal-num">02</span><span><strong>账号级隔离</strong><small>每个账号拥有独立持久化会话环境</small></span></div>
        <div class="signal"><span class="signal-num">03</span><span><strong>统一翻译</strong><small>收发消息都能进入同一翻译工作流</small></span></div>
        <div class="signal"><span class="signal-num">04</span><span><strong>后台群发任务</strong><small>切换账号不改变已创建任务的归属</small></span></div>
      </div>
    </div>

    <section class="shell section" id="product" aria-labelledby="product-title">
      <div class="section-head">
        <div><div class="kicker">One workspace</div><h2 id="product-title">不是把网页堆在一起，<br>是把工作流收在一起。</h2></div>
        <p class="section-intro">海外销售、运营、客服真正消耗时间的，不是打开聊天软件，而是在账号、语言和任务之间反复切换。极客把这些上下文绑定回账号本身，让每个账号都成为一个可持续工作的独立现场。</p>
      </div>
      <div class="workflow-grid">
        <article class="workflow-item"><div class="workflow-index"><span>ACCOUNT</span><span class="workflow-icon">◫</span></div><h3>账号就是工作区</h3><p>WhatsApp、Telegram、LINE 账号各自拥有独立会话环境。切换查看账号，不会把另一个账号的运行状态带过来。</p></article>
        <article class="workflow-item"><div class="workflow-index"><span>LANGUAGE</span><span class="workflow-icon">文</span></div><h3>语言跟着会话走</h3><p>接收和发送都能使用统一翻译能力，不用把消息复制到第三方页面再来回粘贴。</p></article>
        <article class="workflow-item"><div class="workflow-index"><span>TASK</span><span class="workflow-icon">↗</span></div><h3>任务跟着账号走</h3><p>群发创建后固定所属账号与目标快照。你可以继续聊天、切换账号，让任务在对应账号下继续执行。</p></article>
      </div>
    </section>

    <section class="hairline" id="translation">
      <div class="shell section compact feature-split">
        <div class="feature-copy">
          <div class="kicker">Translation</div>
          <h2>语言不同，<br>工作流不必不同。</h2>
          <p>翻译是聊天的一部分，而不是另一个工具。极客把收件、发送、重新翻译和账号级设置放回会话现场，让跨语言沟通尽量接近普通聊天。</p>
          <ul class="feature-list"><li>按账号保存翻译设置，切换账号不串配置</li><li>普通翻译可复用账号级缓存，减少重复请求与重复扣字符</li><li>翻译供应商密钥留在服务端，不下发到聊天页面</li></ul>
        </div>
        <div class="demo-panel translate-demo" aria-label="翻译工作流示意">
          <div class="lang-line"><span>Conversation flow</span><span class="lang-pair"><span class="lang-pill">Italiano</span>→<span class="lang-pill">简体中文</span></span></div>
          <div class="translation-card incoming"><span class="tag">收到的消息</span><p>Possiamo anticipare la consegna a venerdì?</p><p class="result"><b>译文</b>我们可以把交付时间提前到周五吗？</p></div>
          <div class="translation-card outgoing"><span class="tag">你的回复</span><p>我确认库存后，今天内给你答复。</p><p class="result"><b>发送为 IT</b>Dopo aver verificato lo stock, ti risponderò entro oggi.</p></div>
        </div>
      </div>
    </section>

    <section id="broadcast">
      <div class="shell section compact feature-split reverse">
        <div class="demo-panel broadcast-demo" aria-label="多账号群发任务示意">
          <div class="lang-line"><span>Account jobs</span><span>不同账号可并行</span></div>
          <div class="task-card live"><span class="task-icon">WA</span><span class="task-copy"><strong>店铺欧洲 · 52 个聊天</strong><small>已固定目标 · 随机间隔 5–10 秒</small></span><span class="task-state">运行中<span>18 / 52</span></span></div>
          <div class="task-card live"><span class="task-icon">TG</span><span class="task-copy"><strong>渠道 Telegram · 31 个聊天</strong><small>独立账号任务 · 不占用 WA 执行槽</small></span><span class="task-state">运行中<span>9 / 31</span></span></div>
          <div class="task-card queued"><span class="task-icon">WA</span><span class="task-copy"><strong>店铺欧洲 · 定时任务</strong><small>同账号已有任务执行，自动等待</small></span><span class="task-state queue">排队中<span>等待上一任务</span></span></div>
          <div class="flow-note">任务按账号归属：不同账号可以同时工作；同一账号一次只执行一个群发任务，任务内按设定间隔顺序发送。</div>
        </div>
        <div class="feature-copy">
          <div class="kicker">Broadcast jobs</div>
          <h2>群发是任务，<br>不是一个卡住你的弹窗。</h2>
          <p>从“当前页面正在发”变成“这个账号有一个明确的任务”。任务创建后固定账号、受众和发送参数；定时任务到点若撞上同账号正在执行的任务，会进入队列，而不是丢失或串号。</p>
          <ul class="feature-list"><li>不同账号可以各自运行独立群发任务</li><li>同账号任务串行，目标对象按间隔顺序发送</li><li>计划、运行、排队、完成与失败状态都属于任务本身</li></ul>
        </div>
      </div>
    </section>

    <section class="hairline" id="security">
      <div class="shell section compact">
        <div class="section-head">
          <div><div class="kicker">Isolation by default</div><h2>账号彼此独立，<br>边界从一开始就存在。</h2></div>
          <p class="section-intro">多账号工具最怕“看起来分开、实际上共用状态”。极客把账号身份、会话环境和账号级工具数据都按账号归属处理，让切换页面只改变你正在看什么，而不是改变后台真正属于谁。</p>
        </div>
        <div class="security-grid">
          <article class="security-main"><h3>切换的是视图，<br><span>不是账号所有权。</span></h3><div class="security-copy"><div><strong>独立会话环境</strong><p>每个账号使用独立持久化 Session / partition，登录状态与账号运行上下文按账号隔离。</p></div><div><strong>账号级本机数据</strong><p>工具状态写入所属账号沙箱；安全存储不可用时不会降级把敏感数据明文落盘。</p></div></div></article>
          <aside class="security-side" aria-label="账号隔离示意"><div class="isolation-row"><span class="iso-lock">⌁</span><span><strong>WhatsApp · 店铺欧洲</strong><small>独立 Session / partition</small></span><span class="isolated">isolated</span></div><div class="isolation-row"><span class="iso-lock">⌁</span><span><strong>Telegram · 渠道账号</strong><small>独立 Session / partition</small></span><span class="isolated">isolated</span></div><div class="isolation-row"><span class="iso-lock">⌁</span><span><strong>LINE · 日本客户</strong><small>独立 Session / partition</small></span><span class="isolated">isolated</span></div></aside>
        </div>
      </div>
    </section>

    <section class="shell section" id="start">
      <div class="start-card">
        <div class="start-grid">
          <div><div class="kicker">Start with Geek</div><h2>先把工作台跑起来，<br>再决定买多少字符。</h2><p>创建极客账户即可领取 2 万翻译字符。下载 Windows 客户端、登录同一账户、添加聊天账号，就能开始配置翻译与群发。</p></div>
          <div class="start-actions"><a class="btn btn-primary" href="/download">下载 Windows 客户端 <span class="arrow">↘</span></a><a class="btn btn-secondary" href="/login">免费注册 / 登录</a></div>
        </div>
        <div class="start-facts"><div class="start-fact"><strong>注册赠送 20,000 字符</strong><small>用于体验实际翻译工作流。</small></div><div class="start-fact"><strong>字符余额无到期时间</strong><small>不是必须每月续费的订阅倒计时。</small></div><div class="start-fact"><strong>客户端自动检查更新</strong><small>下载入口始终指向当前公开发布版本。</small></div></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="shell footer">
      <span class="footer-brand"><svg class="brand-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="3" y="3" width="58" height="58" rx="15" fill="#151719" stroke="rgba(255,255,255,.18)" stroke-width="2"/><path d="M18 38 A14.5 14.5 0 1 1 44 29" fill="none" stroke="#b9c0c9" stroke-width="9.5" stroke-linecap="round"/><path d="M45.5 23 l-2.5 9 l8.5 -4.2 z" fill="#b9c0c9"/><rect x="35" y="40" width="20" height="14" rx="3" fill="none" stroke="#25d366" stroke-width="1.7"/></svg>极客 Geek</span>
      <div class="footer-links"><a href="/login">账户</a><a href="/download">下载</a><a href="#security">安全边界</a><span>© 2026 Geek</span></div>
    </div>
  </footer>
</div>
</body>
</html>`;

function homeHeaders() {
  return new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
}

function homeResponse() {
  return new Response(HOME_HTML, { status: 200, headers: homeHeaders() });
}

function resetHeaders(source) {
  const headers = new Headers(source);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return headers;
}

function hardenResetHtml(source) {
  const html = String(source || '');
  if (!html.includes(RESET_HANDLER_MARKER) || !html.includes(RESET_TOKEN_READ)) return null;
  return html
    .replace(RESET_HANDLER_MARKER, `${RESET_TOKEN_CAPTURE}\n${RESET_HANDLER_MARKER}`)
    .replace(RESET_TOKEN_READ, '    const token = resetToken;');
}

function unavailableResetPage(response) {
  const headers = resetHeaders(response?.headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response('Reset page unavailable', { status: 500, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === HOME_PATH) return homeResponse();

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET' || url.pathname !== RESET_PATH) return response;

    const headers = resetHeaders(response.headers);
    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || !/^text\/html\b/i.test(contentType)) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const hardened = hardenResetHtml(await response.text());
    if (!hardened) return unavailableResetPage(response);
    return new Response(hardened, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export { hardenResetHtml, homeResponse };
