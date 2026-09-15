'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const runtime = read('src/translation-runtime.cjs');
const base = read('src/translation-runtime-base.cjs');
const scheduler = read('src/translation-smart-queue.cjs');
const preload = read('src/preload.cjs');

assert.match(main, /const \{ createTranslationRuntime \} = require\('\.\/translation-runtime\.cjs'\)/, 'main must compose Translation Runtime owner');
assert.match(main, /translationRuntime = createTranslationRuntime\(\{/, 'main must create Translation Runtime through its owner');
assert.match(main, /translationRuntime\?\.deleteAccount\(removedAccount\.partition\)/, 'account deletion must notify Translation Runtime for exactly the removed partition');
assert.match(main, /translationRuntime\?\.dispose\(\)/, 'main lifecycle must dispose Translation Runtime owner');
assert.doesNotMatch(main, /translation-runtime-base|translation-smart-queue/, 'main must not bypass the public Translation Runtime owner');

for (const forbidden of [
  'TRANSLATION_CACHE_VERSION',
  'translationCaches',
  'translationCacheLoaded',
  'deletedTranslationPartitions',
  'translationInflight',
  'translationCacheWrites',
  'translationLatestRequest',
  'translationRemoteQueue',
  'translateViaRemoteGateway',
  'checkTranslationGateway',
  "ipcMain.handle('translation:",
  "ipcMain.removeHandler('translation:",
]) {
  assert.equal(main.includes(forbidden), false, `main must not retain Translation Runtime ownership marker: ${forbidden}`);
}

assert.match(runtime, /require\('\.\/translation-runtime-base\.cjs'\)/, 'public runtime must compose the proven base transaction layer');
assert.match(runtime, /require\('\.\/translation-smart-queue\.cjs'\)/, 'public runtime must compose the bounded smart queue');
assert.match(runtime, /const privateIpc = \{/, 'base runtime must register only against a private registrar');
assert.match(
  runtime,
  /base\.createTranslationRuntime\(\{ \.\.\.options, ipcMain: privateIpc, fetchImpl: intentAwareFetch \}\)/,
  'base runtime must receive only the private IPC registrar while the public owner decorates its outbound fetch boundary'
);
assert.match(runtime, /const intentAwareFetch = \(url, request = \{\}\) => \{/, 'public runtime must own request-local gateway metadata decoration');
assert.match(runtime, /ipcMain\.handle\('translation:translate', translateIpc\)/, 'public Translation Runtime must own typed translate IPC');
assert.match(runtime, /ipcMain\.handle\('translation:health', health\)/, 'public Translation Runtime must own health IPC');
assert.match(runtime, /for \(const channel of base\.TRANSLATION_CHANNELS\) ipcMain\.removeHandler\(channel\)/, 'public Translation Runtime must own channel teardown');
assert.match(runtime, /normalizeTranslationIntent\(body\.intent\)/, 'priority must use the explicit request intent contract');
assert.match(runtime, /intent === TRANSLATION_INTENTS\.OUTGOING_SEND \? false : body\.coalesce/, 'outgoing work must not coalesce behind lower-priority work');
assert.match(runtime, /scheduler\.cancelPartition\(owner/, 'account deletion must cancel the wrapper admission queue');
assert.match(scheduler, /outgoingReserve/, 'smart queue must reserve bounded interactive capacity');
assert.match(scheduler, /dropOldestBackgroundAnywhere/, 'background overflow must be shed before rejecting interactive work');

assert.match(base, /const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2'/, 'cache version remains owned by the base Translation Runtime transaction layer');
assert.match(base, /state\.deletedPartitions\.has\(partition\)/, 'cache writes must remain partition-scoped and deletion-aware');
assert.match(base, /const workKey = `\$\{partition\}:\$\{key\}`/, 'translation work identity must remain partition-scoped');
assert.match(base, /const inflightKey = callerRequestId \? `\$\{workKey\}:request:\$\{callerRequestId\}` : workKey/, 'base caller transaction identity must remain explicit');
assert.match(base, /serializeTranslationIpcError/, 'base runtime must serialize typed failures explicitly');
assert.match(preload, /unwrapTranslationIpcResponse/, 'sandboxed preload must reconstruct typed translation failures for renderer callers');
assert.doesNotMatch(preload, /require\(['"]\.\.?\//, 'sandboxed preload must not gain a relative CommonJS dependency for the wire contract');

const productionSources = fs.readdirSync(path.join(root, 'src'))
  .filter(name => /\.(?:cjs|mjs|js)$/.test(name));
const realIpcOwners = [];
for (const filename of productionSources) {
  if (filename === 'translation-runtime-base.cjs') continue; // base receives only privateIpc from the public owner above.
  const source = read(path.join('src', filename));
  if (/ipcMain\.handle\('translation:/.test(source) || /ipcMain\.removeHandler\('translation:/.test(source)) {
    realIpcOwners.push(`src/${filename}`);
  }
}
assert.deepEqual(realIpcOwners, ['src/translation-runtime.cjs'], 'translation IPC must have exactly one real production owner');

const baseConsumers = productionSources
  .filter(filename => read(path.join('src', filename)).includes("require('./translation-runtime-base.cjs')"));
assert.deepEqual(baseConsumers, ['translation-runtime.cjs'], 'private base runtime must only be reachable through the public Translation Runtime owner');

console.log('TRANSLATION_RUNTIME_PRODUCTION_OWNERSHIP_CONTRACT_OK');
