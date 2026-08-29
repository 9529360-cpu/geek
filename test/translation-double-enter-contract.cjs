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

assert.match(telegram, /\(button \|\| sendButton\(\)\)\?\.click\(\)/, 'Telegram 必须保留译文的程序化提交');
assert.match(line, /textarea\.dispatchEvent\(new KeyboardEvent\('keydown'/, 'LINE 必须保留译文的程序化提交');

console.log('TRANSLATION_DOUBLE_ENTER_CONTRACT_OK');
