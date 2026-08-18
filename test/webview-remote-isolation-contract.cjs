'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'resources', 'bridge-preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(
  main,
  /webPreferences\.preload = path\.join\(RESOURCES_DIR, 'bridge-preload\.cjs'\);\s*webPreferences\.contextIsolation = true;/,
  'WA/TG bridge preload must run with contextIsolation enabled'
);
assert.match(
  main,
  /webPreferences\.preload = path\.join\(__dirname, '\.\.', 'resources', 's3loYR\.js'\);\s*webPreferences\.contextIsolation = false;/,
  'LINE compatibility preload remains explicitly scoped to contextIsolation=false'
);
assert.match(main, /: 'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no';/, 'WA/TG webpreferences must preserve context isolation');
assert.match(main, /\? 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false'/, 'LINE webpreferences compatibility setting must remain scoped to LINE');
assert.match(main, /webPreferences\.nodeIntegration = false;/, 'remote webviews must keep Node integration disabled');
assert.match(main, /webPreferences\.sandbox = true;/, 'remote webviews must keep renderer sandbox enabled');
assert.match(main, /webPreferences\.webSecurity = true;/, 'remote webviews must keep webSecurity enabled');
assert.match(preload, /event\.origin !== window\.location\.origin/, 'isolated bridge must validate same-origin window messages');
assert.match(preload, /ipcRenderer\.sendToHost\(HOST_CHANNEL, data\.payload\)/, 'isolated bridge must use sendToHost rather than exposing ipcRenderer');
assert.match(app, /data-geek-bridge/, 'page-side translation bridge must detect readiness through shared DOM state');
assert.match(app, /window\.postMessage\(\{ __geekBridge: true/, 'page-side translation bridge must cross the isolated world through postMessage');

console.log('WEBVIEW_REMOTE_ISOLATION_CONTRACT_OK');
