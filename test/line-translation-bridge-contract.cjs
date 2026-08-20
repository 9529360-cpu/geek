'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'resources', 's3loYR.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');

assert.match(preload, /const \{ ipcRenderer \} = require\('electron'\);/, 'LINE preload must keep ipcRenderer private to preload code');
assert.doesNotMatch(preload, /window\.(?:ipcRenderer|electron)\s*=/, 'LINE page must not receive ipcRenderer or a generic Electron API');
assert.match(preload, /REQUEST_TYPE = 'geek-translation-request'/, 'LINE bridge must allow only translation requests');
assert.match(preload, /MAX_ID_LENGTH = 128/, 'LINE bridge must bound request IDs');
assert.match(preload, /MAX_TOKEN_LENGTH = 256/, 'LINE bridge must bound bridge tokens');
assert.match(preload, /message\.type !== REQUEST_TYPE/, 'LINE bridge must reject other message types');
assert.match(preload, /ipcRenderer\.sendToHost\(HOST_CHANNEL, \{ type: REQUEST_TYPE, id, token \}\)/, 'LINE bridge must forward only the fixed safe payload');
assert.match(preload, /Object\.freeze\(\{ send2Host \}\)/, 'LINE page surface must expose only send2Host');

assert.match(
  main,
  /webPreferences\.preload = path\.join\(__dirname, '\.\.', 'resources', 's3loYR\.js'\);\s*webPreferences\.contextIsolation = false;/,
  'LINE must remain on its scoped compatibility preload without changing context isolation'
);
assert.match(adapters, /window\.\$electron\?\.send2Host/, 'LINE translation adapter must use the preload bridge when available');
assert.match(adapters, /type: 'geek-translation-request'/, 'LINE adapter request type must match the preload allowlist');
assert.match(app, /event\?\.channel !== 'send2Host'/, 'host must accept LINE bridge events only on the fixed send2Host channel');
assert.match(app, /message\.type !== 'geek-translation-request'/, 'host must re-check the LINE translation request type');
assert.match(app, /authorizeWebviewBridge\(wv, requestId, suppliedToken\)/, 'host must retain request/token authorization');

console.log('LINE_TRANSLATION_BRIDGE_CONTRACT_OK');
