export const SITE_THEME_TOKENS = `
:root{
  --bg:#08090a;
  --panel:#0e1011;
  --surface:#151719;
  --raised:#1b1e20;
  --text:#f7f8f8;
  --text2:#c6cbd0;
  --muted:#8b9198;
  --faint:#62686f;
  --line:rgba(255,255,255,.09);
  --line2:rgba(255,255,255,.15);
  --green:#25d366;
  --green2:#4ce180;
  --greenSoft:rgba(37,211,102,.11);
  --cyan:#54d9ff;
  --amber:#f1c66e;
  --font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;

  /* Compatibility aliases for account/auth pages owned by the legacy business Worker. */
  --bg-soft:var(--panel);
  --card:rgba(255,255,255,.035);
  --card-border:var(--line);
  --text-dim:var(--muted);
  --text-faint:var(--faint);
  --accent:var(--green);
  --accent2:var(--green2);
  --grad:linear-gradient(135deg,var(--green) 0%,var(--green2) 100%);
  --radius:16px;
}
`;

export const LEGACY_ACCOUNT_THEME_STYLE = `<style data-geek-site-theme="shared-core">
${SITE_THEME_TOKENS}
html,body{background:var(--bg)}
body{color:var(--text);font-family:var(--font)}
::selection{background:rgba(37,211,102,.28)}
:focus-visible{outline-color:var(--green2)}
.bg-glow::before{background:radial-gradient(ellipse at center,rgba(37,211,102,.11) 0%,rgba(84,217,255,.045) 38%,transparent 70%)}
.logo-mark{background:linear-gradient(180deg,#23252a,#101114);border-color:rgba(255,255,255,.14);box-shadow:0 8px 30px rgba(0,0,0,.28)}
.btn-primary{background:var(--green);color:#061109;box-shadow:0 8px 28px rgba(37,211,102,.14)}
.btn-primary:hover{background:var(--green2);box-shadow:0 10px 34px rgba(37,211,102,.2)}
.btn-ghost:hover{border-color:rgba(37,211,102,.32);background:rgba(255,255,255,.065)}
.section-head .kicker{color:var(--green2);text-shadow:none}
.feature::before{background:linear-gradient(90deg,transparent,rgba(37,211,102,.42),transparent)}
.feature:hover{border-color:rgba(37,211,102,.30)}
.feature .icon,.step::before,.download .big-icon{color:var(--green2);background:rgba(37,211,102,.09);border-color:rgba(37,211,102,.20)}
.feature .icon svg,.download .big-icon svg{stroke:var(--green2)}
.plan.hot{border-color:rgba(37,211,102,.45);box-shadow:0 0 60px rgba(37,211,102,.08),inset 0 1px 0 rgba(255,255,255,.06);background:linear-gradient(180deg,rgba(37,211,102,.055),rgba(255,255,255,.02))}
.plan .badge{background:var(--green);color:#061109}
.download::before{background:radial-gradient(ellipse at 50% 0%,rgba(37,211,102,.11),transparent 60%)}
input:focus,textarea:focus,select:focus{border-color:rgba(37,211,102,.62);box-shadow:0 0 0 3px rgba(37,211,102,.10);outline:none}
.dashboard-nav a:hover,.dashboard-nav a:first-child{background:var(--greenSoft)}
.dashboard-nav .nav-icon{color:var(--green2);background:var(--greenSoft)}
.copy-btn{color:var(--green2);background:rgba(37,211,102,.08);border-color:rgba(37,211,102,.28)}
.resource-card.primary{background:linear-gradient(135deg,rgba(37,211,102,.10),rgba(84,217,255,.04));border-color:rgba(37,211,102,.30)}
.payment-workspace{background:rgba(37,211,102,.045);border-color:rgba(37,211,102,.22)}
</style>`;

export const MARKETING_STYLES_CORE = `${SITE_THEME_TOKENS}
*{box-sizing:border-box}
html{background:var(--bg);scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0 0 auto;height:760px;pointer-events:none;background:radial-gradient(circle at 72% 8%,rgba(37,211,102,.09),transparent 30%),radial-gradient(circle at 22% 2%,rgba(84,217,255,.055),transparent 26%),linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px);background-size:auto,auto,56px 56px,56px 56px;mask-image:linear-gradient(#000,rgba(0,0,0,.65) 58%,transparent);z-index:0}
.page{position:relative;z-index:1}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--green2);outline-offset:4px}
::selection{background:rgba(37,211,102,.28)}
.skip{position:fixed;top:10px;left:10px;z-index:90;transform:translateY(-180%);padding:10px 14px;border-radius:9px;background:#fff;color:#111;font-weight:700}
.skip:focus{transform:none}
.shell{width:min(1180px,calc(100% - 48px));margin:0 auto}
.header{position:sticky;top:0;z-index:40;background:rgba(8,9,10,.78);border-bottom:1px solid rgba(255,255,255,.055);backdrop-filter:blur(18px)}
.nav{height:72px;display:flex;align-items:center;gap:28px}
.brand{display:flex;align-items:center;gap:11px;min-width:158px;font-weight:740;letter-spacing:-.02em}
.brand-mark{width:34px;height:34px;display:block}
.brand small{margin-left:5px;color:var(--faint);font-size:9px;letter-spacing:.11em}
.nav-links{display:flex;align-items:center;gap:25px;margin-left:auto}
.nav-links a{position:relative;padding:26px 0;color:var(--muted);font-size:13px;font-weight:570}
.nav-links a:hover,.nav-links a.active{color:var(--text)}
.nav-links a.active:after{content:"";position:absolute;left:0;right:0;bottom:16px;height:1px;background:var(--green)}
.nav-actions{display:flex;align-items:center;gap:9px}
.nav-login{padding:9px;color:var(--text2);font-size:13px;font-weight:600}
.btn{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;border-radius:11px;font-size:13px;font-weight:680;letter-spacing:-.01em;transition:transform .16s ease,background .16s ease,border-color .16s ease}
.btn:hover{transform:translateY(-1px)}
.primary{color:#061109;background:var(--green)}
.primary:hover{background:var(--green2)}
.secondary{border:1px solid var(--line2);background:rgba(255,255,255,.035);color:var(--text)}
.secondary:hover{background:rgba(255,255,255,.065);border-color:rgba(255,255,255,.22)}
.hero{padding:116px 0 74px}
.hero-grid{display:grid;grid-template-columns:minmax(0,.82fr) minmax(480px,1.18fr);gap:72px;align-items:center}
.eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
.eyebrow:before{content:"";width:20px;height:1px;background:var(--green);box-shadow:0 0 14px rgba(37,211,102,.5)}
h1{margin:21px 0 23px;white-space:pre-line;font-size:clamp(50px,6vw,76px);line-height:1;letter-spacing:-.064em;font-weight:760}
.lede{margin:0;max-width:650px;color:var(--text2);font-size:17px;line-height:1.82}
.hero-actions{display:flex;flex-wrap:wrap;gap:11px;margin-top:32px}
.hero-note{margin-top:22px;color:var(--faint);font-size:11px;line-height:1.7}
.stage{position:relative;min-height:500px;border:1px solid var(--line2);border-radius:20px;background:#0c0d0e;box-shadow:0 32px 90px rgba(0,0,0,.46),inset 0 1px rgba(255,255,255,.04);overflow:hidden}
.stage:before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.025),transparent 40%);pointer-events:none}
.stage-label{height:42px;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid var(--line);color:#60666d;font-size:9px;letter-spacing:.08em;text-transform:uppercase}
.stage-label i{width:7px;height:7px;border-radius:50%;background:#33373b}
.stage-body{height:458px;position:relative}
.metric-strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.metrics{display:grid;grid-template-columns:repeat(4,1fr)}
.metric{min-height:92px;padding:22px 24px;border-right:1px solid var(--line)}
.metric:last-child{border-right:0}
.metric b{display:block;color:var(--text2);font-size:12px}
.metric span{display:block;margin-top:5px;color:var(--faint);font-size:10px;line-height:1.45}
`;
