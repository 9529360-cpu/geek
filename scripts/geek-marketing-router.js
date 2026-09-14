import websiteEntry from './geek-website-entry.js';
import { MARKETING_ROUTES, PAGE_META, SITE_ORIGIN } from './geek-marketing-theme.mjs';
import { MARKETING_STYLES_CORE } from './geek-marketing-styles-core.mjs';
import { MARKETING_STYLES_COMPONENTS } from './geek-marketing-styles-components.mjs';
import { PAGE_BODY } from './geek-marketing-pages.mjs';
import { cta, footer, nav } from './geek-marketing-visuals.mjs';

const STYLES = MARKETING_STYLES_CORE + MARKETING_STYLES_COMPONENTS;
const SITEMAP_ROUTES = ['/', ...MARKETING_ROUTES];

function render(path) {
  const meta = PAGE_META[path];
  const canonical = `${SITE_ORIGIN}${path}`;
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
<div class="page">${nav(path)}<main id="main" data-marketing-page="${path.slice(1)}">${PAGE_BODY[path]()}${cta(path)}</main>${footer()}</div>
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
  if (!MARKETING_ROUTES.has(path)) return null;
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

export function enhanceHomepageHtml(html) {
  return String(html || '')
    .replaceAll('href="#product"', 'href="/product"')
    .replaceAll('href="#translation"', 'href="/translation"')
    .replaceAll('href="#broadcast"', 'href="/broadcast"')
    .replaceAll('href="#security"', 'href="/security"');
}

async function homepageResponse(request, env, ctx) {
  const response = await websiteEntry.fetch(request, env, ctx);
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || !/^text\/html\b/i.test(contentType)) return response;
  const headers = new Headers(response.headers);
  return new Response(enhanceHomepageHtml(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname === '/' && request.method === 'GET') return homepageResponse(request, env, ctx);
      const discovery = discoveryResponse(url.pathname, request.method);
      if (discovery) return discovery;
      const response = marketingResponse(url.pathname, request.method);
      if (response) return response;
    }
    return websiteEntry.fetch(request, env, ctx);
  },
};