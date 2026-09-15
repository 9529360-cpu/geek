'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const entryPath = path.join(__dirname, '../scripts/geek-website-versioned-entry.mjs');
  const moduleUrl = `${pathToFileURL(entryPath).href}?version-identity=${Date.now()}`;
  const entry = await import(moduleUrl);
  const versionId = '11111111-2222-4333-8444-555555555555';

  assert.equal(entry.WORKER_VERSION_HEADER, 'X-Geek-Worker-Version');
  assert.equal(typeof entry.default?.fetch, 'function');

  const response = await entry.default.fetch(
    new Request('https://geek.bbnba.com/pricing'),
    { CF_VERSION_METADATA: { id: versionId } },
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(entry.WORKER_VERSION_HEADER), versionId);
  assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'none'/);
  assert.match(await response.text(), /按实际翻译用量付费/);

  const withoutMetadata = await entry.default.fetch(
    new Request('https://geek.bbnba.com/pricing'),
    {},
    {},
  );
  assert.equal(withoutMetadata.status, 200);
  assert.equal(withoutMetadata.headers.get(entry.WORKER_VERSION_HEADER), null, 'version header must reflect Cloudflare metadata rather than a fabricated local value');

  console.log('WEBSITE_WORKER_VERSION_IDENTITY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
