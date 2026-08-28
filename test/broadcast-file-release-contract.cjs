'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBroadcastFileRegistry, CHANNELS } = require('../src/broadcast-files.cjs');
const lifecycle = require('../ui/broadcast-file-lifecycle.js');

let tokenByte = 0;
const fakeFs = {
  async realpath(value) { return path.resolve(String(value)); },
  async stat() { return { size: 4, mtimeMs: 10, isFile: () => true }; },
  async open() { throw new Error('unused'); },
};
const registry = createBroadcastFileRegistry({
  fs: fakeFs,
  randomBytes: () => Buffer.alloc(24, tokenByte++),
  limits: { maxRegistryEntries: 1 },
});

(async () => {
  const [first] = await registry.registerSelection(['a.pdf'], 'owner-a');
  assert.equal(registry.size(), 1);
  assert.equal(registry.release(first.token, 'owner-b'), false, 'wrong owner must not release another renderer capability');
  assert.equal(registry.size(), 1);
  assert.equal(registry.release(first.token, 'owner-a'), true);
  assert.equal(registry.size(), 0, 'successful release must immediately free the registry slot');
  assert.equal(registry.release(first.token, 'owner-a'), false, 'release must be idempotent');

  const [second] = await registry.registerSelection(['b.pdf'], 'owner-a');
  assert.ok(second.token, 'a freed slot must be reusable without waiting for TTL');
  assert.equal(registry.releaseMany([second.token, second.token, 'bad-token'], 'owner-a'), 1);
  assert.equal(registry.size(), 0);

  assert.equal(CHANNELS.releaseTokens, 'file:release-tokens');
  assert.deepEqual(lifecycle.fileTokens([
    { filePath: 'one' },
    { token: 'two' },
    { filePath: 'one' },
    null,
  ]), ['one', 'two']);

  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
  assert.match(preload, /file:release-tokens/, 'preload must expose only the opaque-token release channel');
  assert.match(preload, /overflow\.length[\s\S]*releaseSelectedFiles\(overflow\)/, 'picker overflow must be released before returning to runtime');
  assert.doesNotMatch(preload, /releaseSelectedFiles[\s\S]{0,500}filePath:\s*selected\.filePath/, 'release API must never resolve a canonical path into renderer');

  const loader = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
  const lifecycleAt = loader.indexOf("loadScript('./broadcast-file-lifecycle.js'");
  const runtimeAt = loader.indexOf("loadScript('./broadcast-runtime.js'");
  assert.ok(lifecycleAt >= 0 && runtimeAt > lifecycleAt, 'draft release capture listener must install before runtime mutates draft state');

  const lifecycleSource = fs.readFileSync(path.join(__dirname, '../ui/broadcast-file-lifecycle.js'), 'utf8');
  assert.match(lifecycleSource, /TERMINAL[\s\S]*releaseFiles\(event\.job\.files\)/, 'immediate Job tokens must release at terminal state');
  assert.match(lifecycleSource, /data-runtime-file-index[\s\S]*releaseFiles\(\[files\[index\]\]\)/, 'draft remove must release its token');
  assert.match(lifecycleSource, /#bc-menu-send[\s\S]*!manager\.hasActive\(accountId\)[\s\S]*releaseFiles/, 'draft reset on opening editor must release only when runtime will reset it');

  console.log('BROADCAST_FILE_RELEASE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
