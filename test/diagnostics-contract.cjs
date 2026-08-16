'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeMetadata, createDiagnostics } = require('../src/diagnostics.cjs');

const clean = sanitizeMetadata({
  url: 'https://example.com/path?token=secret&x=1',
  authorization: 'Bearer secret-token',
  cookie: 'sid=secret-cookie',
  apiKey: 'secret-key',
  accessToken: 'nested-secret-token',
  headers: { Authorization: 'Bearer nested-secret', Cookie: 'sid=nested-secret' },
  message: 'ordinary diagnostic message',
  messageBody: 'PRIVATE MESSAGE BODY',
  chatText: 'PRIVATE CHAT BODY'
});
assert.equal(clean.url, 'https://example.com/path', 'URL query必须移除');
assert.equal(clean.authorization, '[REDACTED]', 'Authorization必须脱敏');
assert.equal(clean.cookie, '[REDACTED]', 'Cookie必须脱敏');
assert.equal(clean.apiKey, '[REDACTED]', 'API key必须脱敏');
assert.equal(clean.accessToken, '[REDACTED]', 'accessToken必须脱敏');
assert.equal(clean.headers.Authorization, '[REDACTED]', '嵌套Authorization必须脱敏');
assert.equal(clean.headers.Cookie, '[REDACTED]', '嵌套Cookie必须脱敏');
assert.equal(clean.message, 'ordinary diagnostic message', '普通诊断文字应保留');
assert.equal(Object.hasOwn(clean, 'messageBody'), false, 'message正文键必须丢弃');
assert.equal(Object.hasOwn(clean, 'chatText'), false, '聊天正文键必须丢弃');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-diagnostics-'));
const diagnostics = createDiagnostics({ dir, maxBytes: 220, maxFiles: 3, now: () => '2026-08-16T10:00:00.000Z' });
for (let i = 0; i < 20; i += 1) {
  diagnostics.log('webview-load-failed', {
    accountId: 'account-1', platform: 'telegram-z', errorCode: -105,
    url: `https://example.com/path?token=secret-${i}`,
    authorization: `Bearer secret-${i}`,
    chatText: `PRIVATE-${i}`
  });
}
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort();
assert.ok(files.length >= 1 && files.length <= 3, '轮转文件最多保留3个');
const output = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
assert.match(output, /webview-load-failed/, '应记录事件名');
assert.match(output, /account-1/, '应记录账号ID元数据');
assert.doesNotMatch(output, /secret-|PRIVATE-|Bearer/, '日志不得包含凭据或聊天正文');
assert.doesNotMatch(output, /\?token=/, '日志不得包含URL query');

console.log('DIAGNOSTICS_CONTRACT_OK');
