'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'ui', 'translation-adapters.js'), 'utf8');

const telegramStart = source.indexOf('function installTelegramTranslation');
const lineStart = source.indexOf('function installLineTranslation');
const telegram = source.slice(telegramStart, lineStart);
const line = source.slice(lineStart);

for (const [platform, block, lock] of [
  ['Telegram', telegram, '__geekTelegramSendLock'],
  ['LINE', line, '__geekLineSendLock'],
]) {
  assert.match(block, /blockRepeatedUserSend = event => \{[\s\S]{0,180}!event\?\.isTrusted[\s\S]{0,180}event\.preventDefault\(\); event\.stopImmediatePropagation\(\)/, `${platform} 必须吞掉翻译期间重复的真实用户发送事件`);
  assert.match(block, new RegExp(`if \\(window\\.${lock}\\) \\{ blockRepeatedUserSend\\(event\\); return; \\}`), `${platform} 发送锁判断必须先拦截重复回车/点击再返回`);
}

assert.doesNotMatch(telegram, /submitButton\.click\(\)/, 'Telegram guest must not perform a second programmatic submit after SendIntent owns delivery');
assert.doesNotMatch(telegram, /nativeInsertText|__geekNativeInputPending/, 'Telegram guest must not retain the retired native-fill compatibility tail');
assert.match(telegram, /SEND_INTENT_OWNER_REQUIRED/, 'Telegram guest must fail closed instead of falling back to a second send path');

const lineOwnerStart = line.indexOf('const submitThroughOwner');
const lineOwnerEnd = line.indexOf("document.addEventListener('keydown'", lineOwnerStart);
assert.ok(lineOwnerStart >= 0 && lineOwnerEnd > lineOwnerStart, 'LINE must expose one guest-to-host SendIntent submission owner');
const lineOwner = line.slice(lineOwnerStart, lineOwnerEnd);
assert.equal((lineOwner.match(/__geekTranslationRequest\(/g) || []).length, 1, 'one trusted LINE gesture may create only one host owner request');
assert.doesNotMatch(lineOwner, /nativeInsertText|submitButton\.click|button\.click|dispatchEvent\(/, 'LINE guest must not create a second native commit while SendIntent owns delivery');
assert.match(lineOwner, /window\.__geekLineSendLock = true[\s\S]*await window\.__geekTranslationRequest/, 'LINE duplicate-send lock must be acquired before awaiting the owner');
assert.match(lineOwner, /finally \{[\s\S]{0,100}window\.__geekLineSendLock = false/, 'LINE duplicate-send lock must release only after the owner reaches a terminal response');

assert.match(
  line,
  /document\.addEventListener\('click', event => \{[\s\S]{0,180}data-geek-native-submit-commit[\s\S]{0,180}if \(!event\.isTrusted\) return;/,
  'LINE translation must intercept only trusted user clicks so verified programmatic submits bypass translation'
);

console.log('TRANSLATION_DOUBLE_ENTER_CONTRACT_OK');
