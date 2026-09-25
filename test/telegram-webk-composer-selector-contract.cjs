'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'src', 'webview-ipc.cjs'), 'utf8');

const webKEditor = '.input-message-input[contenteditable="true"]:not(.input-field-input-fake)';
for (const [name, source] of [['translation adapter', adapter], ['broadcast adapter', app], ['native-input owner', ipc]]) {
  assert.ok(source.includes(webKEditor), name + ' must recognize the live Telegram Web K composer and exclude its fake mirror');
  assert.ok(source.includes('#editable-message-text'), name + ' must retain the Telegram Web A composer fallback');
}

assert.ok(adapter.includes('.btn-send'), 'ordinary Telegram translated send must recognize the live Web K send button');
assert.ok(app.includes('.btn-send'), 'Telegram broadcast must recognize the live Web K send button');
assert.ok(app.includes('.bubble:not(.service):not(.is-date)'), 'Telegram broadcast delivery observation must recognize Web K message bubbles');
assert.ok(app.includes('.Message'), 'Telegram broadcast delivery observation must retain Web A message support');
assert.match(adapter, /const isWebKEditor = editor =>/, 'Telegram translation owner must distinguish the controlled Web K composer');
assert.match(adapter, /if \(!keepWebKContenteditable\) editor\.setAttribute\('contenteditable', 'false'\)/, 'Web K composer must not be disabled through contenteditable during translation');
assert.match(adapter, /__geekTelegramNativeInputCommit/, 'trusted editing guard must allow the request-scoped native fill and release the bypass afterward');
assert.match(adapter, /addEventListener\('beforeinput'/, 'Telegram send lock must block concurrent trusted edits without mutating Web K contenteditable state');

console.log('TELEGRAM_WEBK_COMPOSER_SELECTOR_CONTRACT_OK');
