import websiteEntry from './geek-website-entry.js';
import { MARKETING_ROUTES, PAGE_META, SITE_ORIGIN } from './geek-marketing-theme.mjs';
import { LEGACY_ACCOUNT_THEME_STYLE, MARKETING_STYLES_CORE } from './geek-marketing-styles-core.mjs';
import { MARKETING_STYLES_COMPONENTS } from './geek-marketing-styles-components.mjs';
import { PAGE_BODY } from './geek-marketing-pages.mjs';
import { cta, footer, nav, stageProduct, stageSecurity } from './geek-marketing-visuals.mjs';

const STYLES = MARKETING_STYLES_CORE + MARKETING_STYLES_COMPONENTS;
const SITEMAP_ROUTES = ['/', ...MARKETING_ROUTES];
const LEGACY_THEME_ROUTES = new Set(['/login', '/forgot-password', '/reset-password', '/account']);
const LEGACY_PRIMARY_NAV = `<div class="nav-links">
<a href="/product">产品</a>
<a href="/translation">翻译</a>
<a href="/broadcast">群发</a>
<a href="/security">隔离</a>
<a href="/windows">Windows</a>
</div>`;

const HOME_META = Object.freeze({
  title: '极客 Geek · 多平台多账号出海沟通工作台',
  description: '极客 Geek 把 WhatsApp、Telegram、LINE 多账号放进同一个 Windows 工作台，提供账号隔离、消息翻译与账号级群发任务。',
  eyebrow: '海外会话工作台',
  headline: '一个桌面，\n接住每个海外客户。',
  lede: '把 WhatsApp、Telegram 和 LINE 的多个账号放进同一个工作台。账号独立运行，消息随手翻译，群发任务按账号在后台执行——切换客户，不必切换工作方式。',
});

function homeHero() {
  return `<section class="hero">
<div class="shell hero-grid">
<div>
<div class="eyebrow">${HOME_META.eyebrow}</div>
<h1>${HOME_META.headline}</h1>
<p class="lede">${HOME_META.lede}</p>
<div class="hero-actions">
<a class="btn primary" href="/download">下载 Windows 客户端 <span>↘</span></a>
<a class="btn secondary" href="/product">查看产品能力</a>
</div>
<p class="hero-note">WhatsApp / Telegram / LINE · 多账号独立会话 · 翻译与群发同一工作台</p>
</div>${stageProduct()}</div>
</section>`;
}

function homePage() {
  return `${homeHero()}<div class="metric-strip">
<div class="shell metrics">
<div class="metric"><b>多平台多账号</b><span>一个桌面承载多个独立会话现场</span></div>
<div class="metric"><b>账号级隔离</b><span>会话、工具状态与任务都有固定归属</span></div>
<div class="metric"><b>会话内翻译</b><span>原文、译文和回复留在同一客户上下文</span></div>
<div class="metric"><b>后台群发任务</b><span>切换账号不改变任务 owner 与目标快照</span></div>
</div>
</div>
<section class="section">
<div class="shell">
<div class="section-head">
<div>
<div class="kicker">The account is the workspace</div>
<h2>账号就是工作现场，<br>不是一排容易串线的标签。</h2>
</div>
<p class="section-intro">极客把多账号、跨语言沟通和批量触达放进同一条连续工作流。每个账号保有自己的会话环境和任务归属，你切换的是正在查看的现场，不是后台任务的所有权。</p>
</div>
<div class="cards">
<a class="card" href="/product"><div class="card-top"><span>01 · Workspace</span><span class="icon">◫</span></div><h3>多账号独立会话</h3><p>WhatsApp、Telegram、LINE 账号各自保有持久会话环境，长期工作不靠重复登录和窗口堆叠。</p></a>
<a class="card" href="/translation"><div class="card-top"><span>02 · Language</span><span class="icon">文</span></div><h3>翻译就在聊天现场</h3><p>阅读、组织回复和发送目标语言都留在当前客户上下文里，不再复制粘贴到另一套工具。</p></a>
<a class="card" href="/broadcast"><div class="card-top"><span>03 · Job</span><span class="icon">↗</span></div><h3>群发按账号后台执行</h3><p>不同账号可以同时工作；同一账号一次只执行一个群发任务，后续任务按归属排队。</p></a>
</div>
</div>
</section>
<section class="section border">
<div class="shell split">
<div class="copy">
<div class="kicker">Isolation by default</div>
<h2>多账号真正可用的前提，<br>是边界从底层就存在。</h2>
<p>会话 Session、账号数据、WebView 能力、群发附件和服务端翻译密钥各自有明确 owner。界面焦点变化不能把另一个账号的状态“顺手”带过来。</p>
<ul class="list">
<li>账号身份、partition 与 Session 保持固定归属</li>
<li>翻译供应商密钥不进入聊天页面或客户端 WebView</li>
<li>群发任务创建后固定账号、目标、消息与附件能力</li>
<li>边界不明确时 fail closed，而不是猜当前账号</li>
</ul>
</div>${stageSecurity()}</div>
</section>`;
}

function metaFor(path) {
  return path === '/' ? HOME_META : PAGE_META[path];
}

function bodyFor(path) {
  return path === '/' ? homePage() : PAGE_BODY[path]();
}

function render(path) {
  const meta = metaFor(path);
  const canonical = `${SITE_ORIGIN}${path}`;
  const pageName = path === '/' ? 'home' : path.slice(1);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#08090a">
<title>${meta.title}</title>
<meta name="description" content="${meta.description}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="极客 Geek">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.description}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#main">跳到主要内容</a>
<div class="page">${nav(path)}<main id="main" data-marketing-page="${pageName}">${bodyFor(path)}${cta(path)}</main>${footer()}</div>
</body>
</html>`;
}

function marketingHeaders() {
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

function discoveryHeaders(contentType) {
  return new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
}

function robotsBody() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

function sitemapBody() {
  const urls = SITEMAP_ROUTES.map(path => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function marketingResponse(path, method = 'GET') {
  if (path !== '/' && !MARKETING_ROUTES.has(path)) return null;
  return new Response(method === 'HEAD' ? null : render(path), { status: 200, headers: marketingHeaders() });
}

export function discoveryResponse(path, method = 'GET') {
  if (path === '/robots.txt') {
    return new Response(method === 'HEAD' ? null : robotsBody(), {
      status: 200,
      headers: discoveryHeaders('text/plain; charset=utf-8'),
    });
  }
  if (path === '/sitemap.xml') {
    return new Response(method === 'HEAD' ? null : sitemapBody(), {
      status: 200,
      headers: discoveryHeaders('application/xml; charset=utf-8'),
    });
  }
  return null;
}

function canonicalHomeRedirect(method) {
  return new Response(method === 'HEAD' ? null : '', {
    status: 308,
    headers: {
      Location: '/',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function projectLegacyAccountHtml(source) {
  return String(source || '')
    .replace(/<div class="nav-links">[\s\S]*?<\/div>/, LEGACY_PRIMARY_NAV)
    .replaceAll('<a href="/#features">功能</a>', '<a href="/product">产品总览</a>')
    .replaceAll('<a href="/#pricing">定价</a>', '<a href="/broadcast">群发任务</a>')
    .replaceAll('<a href="/#download">Windows 下载</a>', '<a href="/windows">Windows 客户端</a>')
    .replaceAll('<a href="/#guide">使用教程</a>', '<a href="/windows">安装与上手</a>')
    .replaceAll('<a href="/#faq">常见问题</a>', '<a href="/security">安全边界</a>')
    .replace('</head>', `${LEGACY_ACCOUNT_THEME_STYLE}\n</head>`);
}

async function delegatedResponse(request, env, ctx) {
  const response = await websiteEntry.fetch(request, env, ctx);
  const url = new URL(request.url);
  if (request.method !== 'GET' || !LEGACY_THEME_ROUTES.has(url.pathname)) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !/^text\/html\b/i.test(contentType)) return response;
  const source = await response.text();
  if (!source.includes('</head>')) {
    return new Response(source, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
  }
  const headers = new Headers(response.headers);
  return new Response(projectLegacyAccountHtml(source), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname === '/index.html') return canonicalHomeRedirect(request.method);
      const discovery = discoveryResponse(url.pathname, request.method);
      if (discovery) return discovery;
      const response = marketingResponse(url.pathname, request.method);
      if (response) return response;
    }
    return delegatedResponse(request, env, ctx);
  },
};