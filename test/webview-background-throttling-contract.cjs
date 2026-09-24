'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const start = main.indexOf("function configureWebviewSecurity(window) {");
const end = main.indexOf("\n  window.webContents.on('did-attach-webview'", start);
assert.ok(start >= 0 && end > start, 'configureWebviewSecurity attach boundary must exist');
const attach = main.slice(start, end);

assert.match(
  attach,
  /webPreferences\.backgroundThrottling = isLine \? false : true;/,
  'only LINE may retain the existing no-throttling compatibility exception'
);
assert.doesNotMatch(
  attach,
  /will-attach-webview'[\s\S]{0,180}backgroundThrottling\s*=\s*false/,
  'all account WebViews must not be forced into permanent foreground scheduling'
);
assert.match(
  attach,
  /isLine[\s\S]*'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false'/,
  'LINE compatibility must keep its explicitly scoped background scheduling exception'
);
assert.match(
  attach,
  /: 'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no';/,
  'WhatsApp/Telegram WebViews must keep secure preferences without disabling throttling'
);
assert.match(attach, /webPreferences\.sandbox = true;/);
assert.match(attach, /webPreferences\.webSecurity = true;/);
assert.match(attach, /webPreferences\.nodeIntegration = false;/);

console.log('WEBVIEW_BACKGROUND_THROTTLING_CONTRACT_OK');
