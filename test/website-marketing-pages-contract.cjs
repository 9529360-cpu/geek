'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const routerPath = path.join(root, 'scripts', 'geek-marketing-router.js');
const routes = ['/product', '/translation', '/broadcast', '/security', '/windows'];
const expected = {
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
    assert.ok(typeof production.enhanceHomepageHtml === 'function');

    for (const route of routes) {
      const response = await production.default.fetch(new Request(`https://geek.bbnba.com${route}`), {}, {});
      assert.equal(response.status, 200, `${route} must render`);
      assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
      assert.match(response.headers.get('content-security-policy') || '', /script-src 'none'/);
      assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
      const html = await response.text();
      assert.match(html, new RegExp(`data-marketing-page="${route.slice(1)}"`));
      for (const href of routes) assert.ok(html.includes(`href="${href}"`), `${route} missing nav ${href}`);
      assert.ok(html.includes('href="/download"'), `${route} must retain the direct installer route`);
      assert.doesNotMatch(html, /<script\b/i);
      assert.doesNotMatch(html, /src="https?:\/\//i, `${route} must not load remote resources`);
      const absoluteHrefs = [...html.matchAll(/href="(https?:\/\/[^\"]+)"/ig)].map(match => match[1]);
      assert.deepEqual(absoluteHrefs, [`https://geek.bbnba.com${route}`], `${route} may only expose its same-origin canonical URL`);
      for (const marker of expected[route]) assert.ok(html.includes(marker), `${route} missing product marker: ${marker}`);
    }

    const home = await production.default.fetch(new Request('https://geek.bbnba.com/'), {}, {});
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /href="\/product"/);
    assert.match(homeHtml, /href="\/translation"/);
    assert.match(homeHtml, /href="\/broadcast"/);
    assert.match(homeHtml, /href="\/security"/);
    assert.doesNotMatch(homeHtml, /href="#(?:product|translation|broadcast|security)"/);

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
