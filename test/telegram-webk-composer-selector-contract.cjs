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

const telegramStart = adapter.indexOf('function installTelegramTranslation');
const lineStart = adapter.indexOf('function installLineTranslation');
assert.ok(telegramStart >= 0 && lineStart > telegramStart);
const telegram = adapter.slice(telegramStart, lineStart);
assert.ok(telegram.includes('.btn-send'), 'Telegram trusted click interception must recognize the live Web K send button');
assert.ok(app.includes('.btn-send'), 'Telegram broadcast must recognize the live Web K send button');
assert.ok(app.includes('.bubble:not(.service):not(.is-date)'), 'Telegram broadcast delivery observation must recognize Web K message bubbles');
assert.ok(app.includes('.Message'), 'Telegram broadcast delivery observation must retain Web A message support');
assert.doesNotMatch(telegram, /isWebKEditor|keepWebKContenteditable|setAttribute\('contenteditable', 'false'\)/, 'Telegram guest must not own composer mutability for Web K or Web A');
assert.doesNotMatch(telegram, /nativeInsertText|__geekNativeInputPending|submitButton\.click\(\)/, 'Telegram guest must not retain the retired native-fill/synthetic-submit tail');
assert.match(telegram, /SEND_INTENT_OWNER_REQUIRED/, 'Telegram guest must require host SendIntent ownership');
assert.match(telegram, /__geekTelegramNativeInputCommit/, 'trusted editing guard must still yield to the host-owned composer rewrite');
assert.match(telegram, /addEventListener\('beforeinput'/, 'Telegram send lock must block concurrent trusted edits without mutating Web K contenteditable state');

console.log('TELEGRAM_WEBK_COMPOSER_SELECTOR_CONTRACT_OK');
