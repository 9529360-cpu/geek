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

const telegramSubmit = telegram.indexOf('submitButton.click();');
const telegramFinalGuard = telegram.lastIndexOf('assertSendContext();', telegramSubmit);
assert.ok(telegramSubmit >= 0, 'Telegram 必须保留译文的程序化提交');
assert.ok(telegramFinalGuard >= 0 && telegramFinalGuard < telegramSubmit && telegramSubmit - telegramFinalGuard < 420, 'Telegram 程序化提交前必须执行最终聊天上下文校验');
assert.equal((telegram.match(/submitButton\.click\(\);/g) || []).length, 1, 'Telegram 每次译文流程只能保留一个最终程序化 click 提交点');

const lineSubmit = line.indexOf('submitButton.click();');
const lineFinalGuard = line.lastIndexOf('assertSendContext();', lineSubmit);
assert.ok(lineSubmit >= 0, 'LINE 必须保留译文的程序化提交');
assert.ok(lineFinalGuard >= 0 && lineFinalGuard < lineSubmit && lineSubmit - lineFinalGuard < 520, 'LINE 程序化提交前必须执行最终聊天上下文校验');
assert.equal((line.match(/submitButton\.click\(\);/g) || []).length, 1, 'LINE 每次译文流程只能保留一个最终程序化 click 提交点');
assert.doesNotMatch(line, /dispatchEvent\(new KeyboardEvent\(['"]keydown['"]/, 'LINE 译文提交不得回退到不受信任的 synthetic Enter');

console.log('TRANSLATION_DOUBLE_ENTER_CONTRACT_OK');
