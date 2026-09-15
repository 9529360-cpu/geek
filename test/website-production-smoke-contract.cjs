'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SITE_ORIGIN,
  RELEASE_ORIGIN,
  DEPLOY_PROBE_PARAM,
  deploymentProbeUrl,
  runSmoke,
  verifyDownload,
  verifyHtml,
} = require('../scripts/website-production-smoke.cjs');

const source = fs.readFileSync(path.join(__dirname, '../scripts/website-production-smoke.cjs'), 'utf8');
const routerSource = fs.readFileSync(path.join(__dirname, '../scripts/geek-marketing-router.js'), 'utf8');

assert.equal(SITE_ORIGIN, 'https://geek.bbnba.com');
assert.equal(RELEASE_ORIGIN, 'https://geek-release.9529360.workers.dev');
assert.equal(DEPLOY_PROBE_PARAM, '__geek_deploy');
assert.doesNotMatch(source, /process\.env\.(?:TARGET_URL|SITE_URL|ENDPOINT_URL|RELEASE_URL)/, 'production smoke targets must not be caller-controlled');
assert.doesNotMatch(source, /Authorization|Cookie|CLOUDFLARE_API_TOKEN/, 'production smoke must not attach credentials');
assert.match(source, /script-src 'none'/, 'production smoke must verify the public CSP boundary');
assert.match(source, /cross-origin-opener-policy/, 'production smoke must verify opener isolation');
assert.match(source, /__geek_deploy/, 'production smoke must bind probes to a deployment-specific cache key');
assert.match(source, /process\.env\.GITHUB_SHA/, 'GitHub deployment verification must use the exact candidate SHA as its cache-bust identity');
assert.match(source, /verifyHtml\('\/pricing'/, 'production smoke must verify the public pricing decision surface');
assert.match(source, /redirect: 'manual'/, 'download verification must inspect rather than follow the release handoff');
assert.match(routerSource, /'Cross-Origin-Opener-Policy': 'same-origin'/, 'marketing pages must isolate cross-origin opener relationships');

function html(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'",
      'cross-origin-opener-policy': 'same-origin',
    },
  });
}

function fakeProductionFetch(requests, expectedCacheBust) {
  return async (url, options = {}) => {
    const rawUrl = String(url);
    const parsed = new URL(rawUrl);
    requests.push({ url: rawUrl, redirect: options.redirect, method: options.method });
    assert.equal(parsed.origin, SITE_ORIGIN, 'smoke request must stay on the fixed Geek website origin');
    assert.equal(parsed.searchParams.get(DEPLOY_PROBE_PARAM), expectedCacheBust, 'every website probe must use the deployment cache key');
    assert.equal([...parsed.searchParams.keys()].length, 1, 'deployment probe must not add caller-controlled query state');

    switch (parsed.pathname) {
      case '/health':
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      case '/':
        return html('<main>一个桌面，先跑通一个账号</main>');
      case '/pricing':
        return html('<main>按实际翻译用量付费，注册赠送 2 万字符</main>');
      case '/guide':
        return html('<main>先跑通一个账号，先验证日常收发</main>');
      case '/faq':
        return html('<main>先把边界说清楚，极客是独立产品</main>');
      case '/sitemap.xml':
        return new Response(`<urlset><url><loc>${SITE_ORIGIN}/pricing</loc></url><url><loc>${SITE_ORIGIN}/guide</loc></url><url><loc>${SITE_ORIGIN}/faq</loc></url></urlset>`, {
          status: 200,
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        });
      case '/download':
        return new Response(null, {
          status: 302,
          headers: { location: `${RELEASE_ORIGIN}/geek-setup-1.2.25.exe` },
        });
      default:
        throw new Error(`unexpected smoke URL: ${url}`);
    }
  };
}

(async () => {
  const originalOutput = process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_OUTPUT;
  try {
    const cacheBust = 'f7de234836e944ed20bf56f3a9b2dac240419254';
    assert.equal(deploymentProbeUrl('/guide', cacheBust), `${SITE_ORIGIN}/guide?${DEPLOY_PROBE_PARAM}=${cacheBust}`);
    assert.equal(
      deploymentProbeUrl('/guide', 'candidate with spaces'),
      `${SITE_ORIGIN}/guide?${DEPLOY_PROBE_PARAM}=candidate-with-spaces`,
      'deployment identity must be normalized rather than becoming arbitrary query syntax',
    );

    const requests = [];
    const result = await runSmoke({
      fetchImpl: fakeProductionFetch(requests, cacheBust),
      attempts: 1,
      timeoutMs: 1000,
      retryDelayMs: 0,
      cacheBust,
    });
    assert.deepEqual(result, { healthHttpCode: '200', routesChecked: 7 });
    assert.deepEqual(requests.map(({ url }) => url), [
      `${SITE_ORIGIN}/health?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/pricing?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/guide?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/faq?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/sitemap.xml?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
      `${SITE_ORIGIN}/download?${DEPLOY_PROBE_PARAM}=${cacheBust}`,
    ]);
    assert.equal(requests.at(-1).redirect, 'manual', 'download handoff must not be followed');
    assert.ok(requests.slice(0, -1).every(({ redirect }) => redirect === 'follow'));
    assert.ok(requests.every(({ method }) => method === 'GET'));

    await assert.rejects(
      () => verifyHtml('/guide', ['required marker'], {
        fetchImpl: async () => html('<main>wrong page</main>'),
        attempts: 1,
        timeoutMs: 1000,
        retryDelayMs: 0,
        cacheBust,
      }),
      /missing required product marker/,
    );

    await assert.rejects(
      () => verifyDownload({
        fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/app.exe' } }),
        attempts: 1,
        timeoutMs: 1000,
        retryDelayMs: 0,
        cacheBust,
      }),
      /approved Geek release Worker installer path/,
    );

    await assert.rejects(
      () => verifyHtml('/', ['one'], {
        fetchImpl: async () => new Response('<main>one</main>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "default-src 'none'; script-src 'none'",
          },
        }),
        attempts: 1,
        timeoutMs: 1000,
        retryDelayMs: 0,
        cacheBust,
      }),
      /cross-origin-opener-policy/,
    );

    await assert.rejects(
      () => verifyHtml('/', ['one'], {
        fetchImpl: async () => new Response('<script>alert(1)</script>one', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "default-src 'none'; script-src 'none'",
            'cross-origin-opener-policy': 'same-origin',
          },
        }),
        attempts: 1,
        timeoutMs: 1000,
        retryDelayMs: 0,
        cacheBust,
      }),
      /unexpectedly contains a script element/,
    );

    console.log('WEBSITE_PRODUCTION_SMOKE_CONTRACT_OK');
  } finally {
    if (originalOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = originalOutput;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
