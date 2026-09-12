'use strict';

// Mutation B evidence trigger only; ownership oracle behavior is unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const runtime = read('src/translation-runtime.cjs');

assert.match(main, /const \{ createTranslationRuntime \} = require\('\.\/translation-runtime\.cjs'\)/, 'main must compose Translation Runtime owner');
assert.match(main, /translationRuntime = createTranslationRuntime\(\{/, 'main must create Translation Runtime through its owner');
assert.match(main, /translationRuntime\?\.deleteAccount\(removedAccount\.partition\)/, 'account deletion must notify Translation Runtime for exactly the removed partition');
assert.match(main, /translationRuntime\?\.dispose\(\)/, 'main lifecycle must dispose Translation Runtime owner');

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

assert.match(runtime, /const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2'/, 'cache version belongs to Translation Runtime');
assert.match(runtime, /state\.deletedPartitions\.has\(partition\)/, 'cache writes must be partition-scoped and deletion-aware');
assert.match(runtime, /const inflightKey = `\$\{partition\}:\$\{key\}`/, 'inflight request identity must remain partition-scoped');
assert.match(runtime, /ipcMain\.handle\('translation:translate', translate\)/, 'Translation Runtime must own translate IPC');
assert.match(runtime, /ipcMain\.handle\('translation:health', health\)/, 'Translation Runtime must own health IPC');
assert.match(runtime, /for \(const channel of TRANSLATION_CHANNELS\) ipcMain\.removeHandler\(channel\)/, 'Translation Runtime must own channel teardown');

const productionSources = fs.readdirSync(path.join(root, 'src'))
  .filter(name => /\.(?:cjs|mjs|js)$/.test(name));
const directOwners = [];
for (const filename of productionSources) {
  const source = read(path.join('src', filename));
  if (/ipcMain\.handle\('translation:/.test(source) || /ipcMain\.removeHandler\('translation:/.test(source)) {
    directOwners.push(`src/${filename}`);
  }
}
assert.deepEqual(directOwners, ['src/translation-runtime.cjs'], 'translation IPC must have exactly one direct production owner');

console.log('TRANSLATION_RUNTIME_PRODUCTION_OWNERSHIP_CONTRACT_OK');
