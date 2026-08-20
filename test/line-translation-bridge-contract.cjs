'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'resources', 's3loYR.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');

assert.equal(preload.trim(), '', 'LINE active preload must remain empty to preserve the known-good 1.2.12 startup path');
assert.doesNotMatch(preload, /require\(['"]electron['"]\)|ipcRenderer|sendToHost|window\.\$electron|defineProperty\(window,\s*['"]\$electron['"]/, 'LINE preload must not synthesize an Electron page global or IPC surface');

assert.match(
  main,
  /webPreferences\.preload = path\.join\(__dirname, '\.\.', 'resources', 's3loYR\.js'\);\s*webPreferences\.contextIsolation = false;/,
  'LINE must remain on its scoped compatibility preload without changing context isolation'
);
assert.match(adapters, /window\.\$electron\?\.send2Host/, 'LINE adapter may use an existing send2Host bridge when the page already provides one');
assert.match(adapters, /else console\.log\('__GEEK_TRANSLATION_REQUEST__:' \+ id \+ ':' \+ window\.__geekTranslationBridgeToken\)/, 'LINE adapter must retain the console-message translation fallback');
assert.match(adapters, /type: 'geek-translation-request'/, 'LINE adapter request type must remain stable');
assert.match(app, /event\?\.channel !== 'send2Host'/, 'host must accept LINE bridge events only on the fixed send2Host channel');
assert.match(app, /message\.type !== 'geek-translation-request'/, 'host must re-check the LINE translation request type');
assert.match(app, /authorizeWebviewBridge\(wv, requestId, suppliedToken\)/, 'host must retain request/token authorization');

console.log('LINE_TRANSLATION_STARTUP_COMPAT_CONTRACT_OK');
