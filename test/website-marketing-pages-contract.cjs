'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const routerPath = path.join(root, 'scripts', 'geek-marketing-router.js');
const routes = ['/', '/product', '/translation', '/broadcast', '/security', '/windows'];
const expected = {
  '/': ['海外会话工作台', '账号就是工作现场', '不同账号可以同时工作'],
  '/product': ['账号就是工作现场', '多平台多账号'],
  '/translation': ['语言不同', '供应商密钥'],
  '/broadcast': ['群发是任务', '不同账号可以并行'],
  '/security': ['边界真的存在', 'safeStorage'],
  '/windows': ['桌面主战场', '下载当前公开版本'],
};

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://geek-release.9529360.workers.dev/latest.yml') {
      return new Response('version: 1.2.24\n', { status: 200 });
    }
    throw new Error(`unexpected external fetch in website marketing contract: ${url}`);
  };

  try {
    const moduleUrl = `${pathToFileURL(routerPath).href}?marketing-contract=${Date.now()}`;
    const production = await import(moduleUrl);
    assert.ok(typeof production.default?.fetch === 'function');
    assert.ok(typeof production.marketingResponse === 'function');
    assert.ok(typeof production.discoveryResponse === 'function');
    assert.equal('enhanceHomepageHtml' in production, false, 'production homepage must not depend on legacy HTML projection');

    for (const route of routes) {
      const response = await production.default.fetch(new Request(`https://geek.bbnba.com${route}`), {}, {});
      assert.equal(response.status, 200, `${route} must render`);
      assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
      assert.match(response.headers.get('content-security-policy') || '', /script-src 'none'/);
      assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
      const html = await response.text();
      const pageName = route === '/' ? 'home' : route.slice(1);
      assert.match(html, new RegExp(`data-marketing-page="${pageName}"`));
      for (const href of routes) assert.ok(html.includes(`href="${href}"`), `${route} missing nav ${href}`);
      assert.ok(html.includes('href="/download"'), `${route} must retain the direct installer route`);
      assert.ok(html.includes(`<meta property="og:url" content="https://geek.bbnba.com${route}">`), `${route} missing canonical social URL`);
      assert.match(html, /<meta property="og:site_name" content="极客 Geek">/);
      assert.match(html, /<meta name="twitter:card" content="summary">/);
      assert.doesNotMatch(html, /<script\b/i);
      assert.doesNotMatch(html, /src="https?:\/\//i, `${route} must not load remote resources`);
      const absoluteHrefs = [...html.matchAll(/href="(https?:\/\/[^\"]+)"/ig)].map(match => match[1]);
      assert.deepEqual(absoluteHrefs, [`https://geek.bbnba.com${route}`], `${route} may only expose its same-origin canonical URL`);
      for (const marker of expected[route]) assert.ok(html.includes(marker), `${route} missing product marker: ${marker}`);

      const head = await production.default.fetch(new Request(`https://geek.bbnba.com${route}`, { method: 'HEAD' }), {}, {});
      assert.equal(head.status, 200, `${route} HEAD must resolve through the marketing router`);
      assert.match(head.headers.get('content-type') || '', /^text\/html\b/);
      assert.equal(await head.text(), '');
    }

    const index = await production.default.fetch(new Request('https://geek.bbnba.com/index.html'), {}, {});
    assert.equal(index.status, 308, '/index.html must canonicalize to the shared homepage');
    assert.equal(index.headers.get('location'), '/');

    const robots = await production.default.fetch(new Request('https://geek.bbnba.com/robots.txt'), {}, {});
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get('content-type') || '', /^text\/plain\b/);
    assert.match(await robots.text(), /^User-agent: \*\nAllow: \/\n\nSitemap: https:\/\/geek\.bbnba\.com\/sitemap\.xml\n$/);

    const sitemap = await production.default.fetch(new Request('https://geek.bbnba.com/sitemap.xml'), {}, {});
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type') || '', /^application\/xml\b/);
    const sitemapXml = await sitemap.text();
    assert.match(sitemapXml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    for (const route of routes) {
      assert.ok(sitemapXml.includes(`<loc>https://geek.bbnba.com${route}</loc>`), `sitemap missing ${route}`);
    }
    assert.equal((sitemapXml.match(/<loc>https:\/\/geek\.bbnba\.com\/<\/loc>/g) || []).length, 1, 'sitemap must list homepage exactly once');

    const sitemapHead = await production.default.fetch(new Request('https://geek.bbnba.com/sitemap.xml', { method: 'HEAD' }), {}, {});
    assert.equal(sitemapHead.status, 200);
    assert.match(sitemapHead.headers.get('content-type') || '', /^application\/xml\b/);
    assert.equal(await sitemapHead.text(), '');

    for (const route of ['/login', '/forgot-password', '/reset-password', '/account']) {
      const response = await production.default.fetch(new Request(`https://geek.bbnba.com${route}`), {}, {});
      assert.equal(response.status, 200, `${route} must remain owned by the existing account surface`);
      const html = await response.text();
      assert.match(html, /data-geek-site-theme="unified-20260914"/, `${route} missing unified site theme projection`);
      assert.match(html, /--accent:#25d366!important/, `${route} must use the current Geek green accent`);
      assert.match(html, /--bg:#08090a!important/, `${route} must use the current Geek marketing background`);
    }

    const download = await production.default.fetch(new Request('https://geek.bbnba.com/download'), {}, {});
    assert.equal(download.status, 302, '/download must preserve the existing direct-download contract');
    assert.equal(download.headers.get('location'), 'https://geek-release.9529360.workers.dev/geek-setup-1.2.24.exe');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('WEBSITE_MARKETING_PAGES_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});