'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const normalizeLineEndings = (value) => String(value).replace(/\r\n?/g, '\n');
const subscriptionWorker = normalizeLineEndings(fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-worker-core.js'), 'utf8'));
const translationWorker = normalizeLineEndings(fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8'));

const authoritativeBody = "for (const ch of String(text || '')) {\n    n += ch.codePointAt(0) > 255 ? 2 : 1;\n  }";
assert.ok(subscriptionWorker.includes(authoritativeBody), '订阅 Worker 必须保留 >255 的计费规则');
assert.match(
  translationWorker,
  /for \(const char of String\(text \|\| ''\)\) total \+= char\.codePointAt\(0\) > 255 \? 2 : 1;/,
  '翻译 Worker 必须与订阅 Worker 使用同一 >255 计费阈值'
);
assert.doesNotMatch(translationWorker, /codePointAt\(0\) > 127 \? 2 : 1/, '翻译 Worker 不得继续把 Latin-1 重音字符按双字符计费');

function countChars(text) {
  let total = 0;
  for (const char of String(text || '')) total += char.codePointAt(0) > 255 ? 2 : 1;
  return total;
}

const fixtures = [
  ['ASCII', 'Hello', 5],
  ['Italian Latin-1', 'Caffè già', 9],
  ['French Latin-1', 'déjà', 4],
  ['German Latin-1', 'für', 3],
  ['extended Latin', 'Ā', 2],
  ['CJK', '你好', 4],
  ['emoji code point', '🙂', 2],
  ['combining mark', 'e\u0301', 3],
];
for (const [name, text, expected] of fixtures) {
  assert.equal(countChars(text), expected, `${name} 计费语义必须稳定`);
}

assert.match(translationWorker, /reserved = Math\.max\(1, countChars\(text\)\)/, '额度预留必须使用统一 countChars');
assert.match(
  translationWorker,
  /finishUsage\([\s\S]*?requestId,[\s\S]*?countChars\(result\),[\s\S]*?reservationOwner/,
  '目标译文结算必须使用统一 countChars，并保持 reservation owner 参与终态提交'
);
assert.match(translationWorker, /refundUsage\(db, auth\.uid, requestId, reserved, reservationOwner\)/, '退款必须返还同一预留值');

console.log('TRANSLATION_CHARACTER_ACCOUNTING_CONTRACT_OK');
