import { LOGO, PAGE_META } from './geek-marketing-theme.mjs';

export const PLATFORM_DISCLAIMER = 'WhatsApp、Telegram、LINE 及相关商标属于各自权利人。极客是独立产品，平台名称仅用于说明兼容范围，不表示隶属、授权或背书。';

export function nav(path) {
  const links = [
    ['/product', '产品'], ['/translation', '翻译'], ['/broadcast', '群发'], ['/security', '隔离'], ['/guide', '上手'], ['/windows', 'Windows'],
  ];
  return `<header class="header">
<div class="shell nav">
    <a class="brand" href="/" aria-label="极客 Geek 首页">${LOGO}<span>极客 Geek <small>DESKTOP</small></span></a>
    <nav class="nav-links" aria-label="产品导航">${links.map(([href,label]) => `<a href="${href}"${path===href?' class="active" aria-current="page"':''}>${label}</a>`).join('')}</nav>
    <div class="nav-actions"><a class="nav-login" href="/login">登录</a><a class="btn primary" href="/download">立即下载 <span>↘</span></a></div>
  </div>
</header>`;
}

export function footer() {
  return `<footer class="footer">
<div class="shell foot-stack">
<div class="foot">
<span class="foot-brand">${LOGO}<span>极客 Geek</span></span>
<div class="foot-links">
<a href="/product">产品</a>
<a href="/translation">翻译</a>
<a href="/broadcast">群发</a>
<a href="/security">安全边界</a>
<a href="/guide">安装与上手</a>
<a href="/faq">常见问题</a>
<a href="/windows">Windows</a>
<a href="/login">账户</a>
<span>© 2026 Geek</span>
</div>
</div>
<p class="footer-disclaimer">${PLATFORM_DISCLAIMER}</p>
</div>
</footer>`;
}

export function stageProduct() {
  return `<div class="stage" aria-label="极客桌面工作台结构示意">
<div class="stage-label"><i></i><i></i><i></i><span style="margin-left:auto">workspace structure · account owned</span></div>
<div class="stage-body rail-demo">
    <aside class="accounts">
<div class="rail-head"><span class="rail-g">G</span><span>账号</span></div>
<div class="acct active"><b class="badge">WA</b><span>店铺 · 欧洲</span><i class="dot"></i></div>
<div class="acct"><b class="badge tg">TG</b><span>渠道 · Telegram</span><i class="dot"></i></div>
<div class="acct"><b class="badge li">LINE</b><span>客户 · 日本</span><i class="dot"></i></div>
</aside>
    <div class="workspace">
<div class="workspace-top"><span class="chip">备注</span><span class="chip on">翻译已开启</span><span class="chip">群发</span></div>
<div class="chat">Ciao, possiamo anticipare la consegna?<em><b>译文</b>你好，我们可以提前交付吗？</em></div>
<div class="chat me">我确认库存后今天内答复。<em><b>Send as IT</b>Ti risponderò oggi dopo aver verificato lo stock.</em></div>
<div class="job"><div class="job-top"><span>群发 · 店铺欧洲</span><b>运行中</b></div><div class="bar"></div><div class="job-foot"><span>18 / 52</span><span>后台继续执行</span></div></div>
</div>
  </div>
</div>`;
}

export function stageTranslation() {
  return `<div class="stage">
<div class="stage-label"><i></i><i></i><i></i><span style="margin-left:auto">conversation translation</span></div>
<div class="stage-body" style="padding:34px;display:grid;align-content:center">
<div class="mini-title"><span>incoming → outgoing</span><span>账号级设置</span></div>
<div class="quote">Possiamo anticipare la consegna a venerdì?<div class="subline"><b>译文</b>我们可以把交付时间提前到周五吗？</div></div>
<div class="quote green">我确认库存后，今天内给你答复。<div class="subline"><b>发送为 IT</b>Dopo aver verificato lo stock, ti risponderò entro oggi.</div></div>
</div>
</div>`;
}

export function stageBroadcast() {
  return `<div class="stage">
<div class="stage-label"><i></i><i></i><i></i><span style="margin-left:auto">account jobs</span></div>
<div class="stage-body" style="padding:28px;display:grid;align-content:center">
<div class="mini-title"><span>任务归属</span><span>不同账号可并行</span></div>
<div class="task live"><span class="task-icon">WA</span><span><strong>店铺欧洲 · 52 个目标</strong><small>固定快照 · 随机间隔 5–10 秒</small></span><span class="state">运行中<span>18 / 52</span></span></div>
<div class="task live"><span class="task-icon">TG</span><span><strong>渠道 Telegram · 31 个目标</strong><small>独立账号执行槽</small></span><span class="state">运行中<span>9 / 31</span></span></div>
<div class="task"><span class="task-icon">WA</span><span><strong>店铺欧洲 · 定时任务</strong><small>同账号已有任务，自动等待</small></span><span class="state queue">排队中<span>等待上一任务</span></span></div>
</div>
</div>`;
}

export function stageSecurity() {
  return `<div class="stage">
<div class="stage-label"><i></i><i></i><i></i><span style="margin-left:auto">ownership boundaries</span></div>
<div class="stage-body" style="padding:28px;display:grid;align-content:center">
<div class="layers">
<div class="layer"><span class="lock">⌁</span><span><strong>账号会话环境</strong><small>独立持久化 Session / partition</small></span><code>isolated</code></div>
<div class="layer"><span class="lock">▣</span><span><strong>账号工具数据</strong><small>allowlist + safeStorage + 原子持久化</small></span><code>account</code></div>
<div class="layer"><span class="lock">↗</span><span><strong>群发与附件能力</strong><small>Job owner + opaque attachment capability</small></span><code>bound</code></div>
<div class="layer"><span class="lock">文</span><span><strong>翻译服务边界</strong><small>供应商密钥只留在服务端</small></span><code>server</code></div>
</div>
</div>
</div>`;
}

export function stageWindows() {
  return `<div class="stage">
<div class="stage-label"><i></i><i></i><i></i><span style="margin-left:auto">Geek for Windows</span></div>
<div class="stage-body" style="display:grid;place-items:center;padding:34px">
<div style="width:min(360px,100%);text-align:center">
<div style="width:88px;height:88px;margin:0 auto 23px">${LOGO}</div>
<div style="font-size:25px;font-weight:740;letter-spacing:-.04em">极客 Geek</div>
<p style="margin:12px 0 25px;color:var(--muted);font-size:13px;line-height:1.75">一个 Windows 桌面，管理多个海外沟通账号。</p>
<a class="btn primary" href="/download" style="width:100%;min-height:50px">下载当前公开版本 <span>↘</span></a>
<div style="margin-top:13px;color:var(--faint);font-size:9px">下载入口始终由现有 Release Worker 提供当前公开安装包</div>
</div>
</div>
</div>`;
}

export function hero(path, stage) {
  const meta = PAGE_META[path];
  return `<section class="hero">
<div class="shell hero-grid">
<div>
<div class="eyebrow">${meta.eyebrow}</div>
<h1>${meta.headline}</h1>
<p class="lede">${meta.lede}</p>
<div class="hero-actions">
<a class="btn primary" href="/download">下载 Windows 客户端 <span>↘</span></a>${path === '/windows' ? '<a class="btn secondary" href="/login">免费注册 / 登录</a>' : '<a class="btn secondary" href="/guide">查看安装与上手</a>'}</div>
<p class="hero-note">Windows · WhatsApp · Telegram · LINE · 多账号工作区</p>
</div>${stage}</div>
</section>`;
}

export function cta(path) {
  const windows = path === '/windows';
  const guide = path === '/guide';
  const faq = path === '/faq';
  const kicker = windows ? 'Get Geek' : guide ? 'Ready when you are' : faq ? 'Know the boundaries' : 'Continue on desktop';
  const title = windows
    ? '下载以后，直接从你的第一个账号开始。'
    : guide
      ? '先跑通一个账号，再把工作台扩起来。'
      : faq
        ? '边界清楚以后，再决定是否把它放进日常工作。'
        : '把下一段海外沟通，放进真正属于它的账号里。';
  const copy = windows
    ? '已有账户可以直接登录；第一次使用也可以先注册极客账户，再下载 Windows 客户端。'
    : guide
      ? '安装、登录、第一个真实账号和一次受控收发，就是最小可验证闭环。后续再按需要增加翻译与群发。'
      : faq
        ? '极客当前以 Windows 桌面多账号工作流为核心；第三方平台能力变化时，我们以兼容和安全边界为先。'
        : 'Windows 客户端是极客完整工作流的运行现场。账户、翻译、群发和账号隔离在这里真正连接起来。';
  const secondaryHref = windows ? '/login' : faq ? '/security' : '/faq';
  const secondaryText = windows ? '免费注册 / 登录' : faq ? '查看安全边界' : '查看常见问题';
  return `<section class="section">
<div class="shell"><div class="cta"><div class="cta-grid"><div><div class="kicker">${kicker}</div><h2>${title}</h2><p>${copy}</p></div><div class="cta-actions"><a class="btn primary" href="/download">立即下载 Windows 客户端 <span>↘</span></a><a class="btn secondary" href="${secondaryHref}">${secondaryText}</a></div></div></div></div>
</section>`;
}
