'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const entryPath = path.join(root, 'scripts', 'geek-website-entry.js');
const sentinel = 'RESET_TOKEN_SENTINEL_DO_NOT_REFLECT_386';

(async () => {
  const originalFetch = global.fetch;
  let releaseFetches = 0;
  global.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://geek-release.9529360.workers.dev/latest.yml') {
      releaseFetches += 1;
      return new Response('version: 1.2.22\n', {
        status: 200,
        headers: { 'Content-Type': 'text/yaml; charset=utf-8' },
      });
    }
    throw new Error(`unexpected external fetch in website reset contract: ${url}`);
  };

  try {
    const moduleUrl = `${pathToFileURL(entryPath).href}?reset-contract=${Date.now()}`;
    const production = await import(moduleUrl);
    assert.ok(typeof production.default?.fetch === 'function', 'website production entry must export fetch');
    assert.ok(typeof production.hardenResetHtml === 'function', 'reset hardening transform must remain directly contract-testable');

    const resetResponse = await production.default.fetch(
      new Request(`https://geek.bbnba.com/reset-password?token=${encodeURIComponent(sentinel)}`),
      {},
      {}
    );
    assert.equal(resetResponse.status, 200);
    assert.equal(resetResponse.headers.get('cache-control'), 'no-store', 'reset page must never be publicly/browser cached');
    assert.equal(resetResponse.headers.get('referrer-policy'), 'no-referrer', 'reset page must not emit a Referer containing its token URL');
    assert.equal(resetResponse.headers.get('x-frame-options'), 'DENY', 'existing anti-framing header must survive the reset projection');
    assert.equal(resetResponse.headers.get('x-content-type-options'), 'nosniff', 'existing MIME hardening must survive the reset projection');

    const body = await resetResponse.text();
    assert.ok(!body.includes(sentinel), 'query reset token must never be reflected into the HTML response');
    for (const value of resetResponse.headers.values()) {
      assert.ok(!String(value).includes(sentinel), 'query reset token must never be reflected into response headers');
    }

    const capture = "const resetToken = new URLSearchParams(location.search).get('token') || '';";
    const scrub = "if (resetToken) history.replaceState(null, '', location.pathname);";
    const handler = "document.getElementById('reset-complete').onclick = async () => {";
    const useCaptured = 'const token = resetToken;';
    const captureIndex = body.indexOf(capture);
    const scrubIndex = body.indexOf(scrub);
    const handlerIndex = body.indexOf(handler);
    const useIndex = body.indexOf(useCaptured);

    assert.ok(captureIndex >= 0, 'reset page must capture the query token once into page memory');
    assert.ok(scrubIndex > captureIndex, 'reset page must scrub the visible/current history URL after capture');
    assert.ok(handlerIndex > scrubIndex, 'URL scrubbing must happen before the user can submit the reset form');
    assert.ok(useIndex > handlerIndex, 'submit handler must use the already-captured in-memory token');
    assert.ok(
      !body.includes("const token = new URLSearchParams(location.search).get('token') || '';"),
      'submit handler must not re-read a token from the cleaned URL'
    );
    assert.doesNotMatch(body, /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\([^)]*resetToken/i, 'reset token must not be persisted in web storage');
    assert.doesNotMatch(body, /document\.cookie\s*=\s*[^;\n]*resetToken/i, 'reset token must not be persisted in document cookies');

    const loginResponse = await production.default.fetch(new Request('https://geek.bbnba.com/login'), {}, {});
    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.headers.get('cache-control'), 'public, max-age=60', 'ordinary pages must keep their existing cache policy');
    assert.equal(loginResponse.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', 'ordinary pages must keep their existing referrer policy');
    assert.ok(!(await loginResponse.text()).includes(capture), 'reset hardening must not be injected into unrelated pages');

    assert.equal(
      production.hardenResetHtml('<html><body>drifted reset template</body></html>'),
      null,
      'template drift must fail closed instead of silently serving an unhardened reset page'
    );
    assert.ok(releaseFetches >= 2, 'contract must exercise the real website latest-version projection on both pages');
  } finally {
    global.fetch = originalFetch;
  }

  console.log('WEBSITE_RESET_TOKEN_REFERRER_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
