'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeMetadata, createDiagnostics } = require('../src/diagnostics.cjs');

const clean = sanitizeMetadata({
  url: 'https://example.com/private/session-token-123?token=secret&x=1',
  authorization: 'Bearer secret-token',
  cookie: 'sid=secret-cookie',
  apiKey: 'secret-key',
  accessToken: 'nested-secret-token',
  sessionId: 'line-session-secret',
  email: 'user@example.com',
  phoneNumber: '+60123456789',
  login: 'proxy-user',
  username: 'private-user',
  headers: { Authorization: 'Bearer nested-secret', Cookie: 'sid=nested-secret', sessionToken: 'nested-session' },
  message: 'ordinary diagnostic message',
  messageBody: 'PRIVATE MESSAGE BODY',
  chatText: 'PRIVATE CHAT BODY'
});
assert.equal(clean.url, 'https://example.com/[REDACTED_PATH]', '结构化URL必须只保留安全的scheme/host投影');
assert.doesNotMatch(clean.url, /private|session-token-123|secret|token/, 'URL path/query中的敏感标识不得保留');
assert.equal(clean.authorization, '[REDACTED]', 'Authorization必须脱敏');
assert.equal(clean.cookie, '[REDACTED]', 'Cookie必须脱敏');
assert.equal(clean.apiKey, '[REDACTED]', 'API key必须脱敏');
assert.equal(clean.accessToken, '[REDACTED]', 'accessToken必须脱敏');
assert.equal(clean.sessionId, '[REDACTED]', 'session ID必须脱敏');
assert.equal(clean.email, '[REDACTED]', '邮箱必须脱敏');
assert.equal(clean.phoneNumber, '[REDACTED]', '手机号必须脱敏');
assert.equal(clean.login, '[REDACTED]', '登录名必须脱敏');
assert.equal(clean.username, '[REDACTED]', '用户名必须脱敏');
assert.equal(clean.headers.Authorization, '[REDACTED]', '嵌套Authorization必须脱敏');
assert.equal(clean.headers.Cookie, '[REDACTED]', '嵌套Cookie必须脱敏');
assert.equal(clean.headers.sessionToken, '[REDACTED]', '嵌套session token必须脱敏');
assert.equal(clean.message, 'ordinary diagnostic message', '普通诊断文字应保留');
assert.equal(Object.hasOwn(clean, 'messageBody'), false, 'message正文键必须丢弃');
assert.equal(Object.hasOwn(clean, 'chatText'), false, '聊天正文键必须丢弃');

const malformed = sanitizeMetadata({
  url: 'not-a-valid-url/private/customer-42?token=SHOULD_NOT_LEAK#secret-fragment',
  nested: { url: 'https://alice:secret@internal-token@example.com:bad/private/customer-42?auth=SHOULD_NOT_LEAK' }
});
assert.equal(malformed.url, '[INVALID_URL]', '无可信scheme的非法URL必须fail closed');
assert.equal(malformed.nested.url, 'https:[REDACTED]', '解析失败但scheme可识别时不得继续猜测authority/path');
assert.doesNotMatch(JSON.stringify(malformed), /customer-42|alice|secret|internal-token|example\.com|SHOULD_NOT_LEAK/, '非法URL不得泄露authority/path/query内容');

const embedded = sanitizeMetadata({
  errorMessage: [
    'upstream request failed but retry context should remain;',
    'Authorization: Bearer bearer-super-secret;',
    'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==;',
    'access_token=access-super-secret;',
    'password: plain-password;',
    'url=https://user:pass@example.com/private/session-token-456?token=query-secret#private-fragment;',
    'file=file:///Users/alice/private/customer-42.csv;',
    'opaque=data:text/plain,customer-secret;',
    'script=javascript:alert(secret-code);',
    'email=user@example.com;',
    'phone=+60123456789;',
    'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345'
  ].join(' '),
  details: [
    'ordinary array diagnostic',
    'refresh_token=array-secret',
    'request https://api.example.com/private/customer-77?apiKey=url-secret failed',
  ],
});
assert.match(embedded.errorMessage, /upstream request failed but retry context should remain/, '自由错误文本必须保留非敏感上下文');
assert.match(embedded.details[0], /ordinary array diagnostic/, '数组中的普通诊断文本必须保留');
assert.match(embedded.errorMessage, /https:\/\/example\.com\/\[REDACTED_PATH\]/, '自由文本中的HTTP URL必须使用canonical安全投影');
assert.match(embedded.errorMessage, /file:\[REDACTED\]/, '自由文本中的本地file URL必须整体脱敏');
assert.match(embedded.errorMessage, /data:\[REDACTED\]/, '自由文本中的data URL payload必须整体脱敏');
assert.match(embedded.errorMessage, /javascript:\[REDACTED\]/, '自由文本中的javascript URL payload必须整体脱敏');
const embeddedOutput = JSON.stringify(embedded);
assert.doesNotMatch(embeddedOutput, /bearer-super-secret|QWxhZGRpbjpvcGVuIHNlc2FtZQ|access-super-secret|plain-password|query-secret|private-fragment|user:pass|session-token-456|Users\/alice|customer-42|customer-secret|secret-code|user@example\.com|\+60123456789|eyJhbGciOiJIUzI1NiJ9|array-secret|customer-77|url-secret/, '自由字符串中的凭据、PII、URL path和opaque payload必须脱敏');
assert.doesNotMatch(embeddedOutput, /\?(?:token|apiKey)=/, '嵌入URL query必须从自由文本中移除');
assert.match(embeddedOutput, /\[REDACTED\]/, '自由文本脱敏应留下明确的redaction标记');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-diagnostics-'));
const diagnostics = createDiagnostics({ dir, maxBytes: 220, maxFiles: 3, now: () => '2026-08-16T10:00:00.000Z' });
for (let i = 0; i < 20; i += 1) {
  diagnostics.log('webview-load-failed', {
    accountId: 'account-1', platform: 'telegram-z', errorCode: -105,
    url: `https://example.com/private/session-${i}?token=secret-${i}`,
    authorization: `Bearer secret-${i}`,
    email: `person${i}@example.com`,
    chatText: `PRIVATE-${i}`
  });
}
diagnostics.log('uncaught-exception', {
  origin: 'uncaughtException',
  errorMessage: 'network failed Authorization: Bearer runtime-secret at https://user:pass@example.com/private/runtime-path-token?token=runtime-query file file:///Users/alice/private/runtime.txt opaque data:text/plain,runtime-data-secret email runtime@example.com phone +60123456789',
});
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort();
assert.ok(files.length >= 1 && files.length <= 3, '轮转文件最多保留3个');
const output = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
assert.match(output, /webview-load-failed/, '原有WebView诊断事件必须继续保留');
assert.match(output, /account-1/, '原有账号ID诊断元数据必须继续保留');
assert.match(output, /uncaught-exception/, '自由异常文本必须经过真实日志写入路径验证');
assert.doesNotMatch(output, /secret-|PRIVATE-|Bearer runtime-secret|runtime-query|runtime-path-token|Users\/alice|runtime\.txt|runtime-data-secret|user:pass|@example\.com|proxy-user|\+60123456789/, '真实JSONL不得包含字段级凭据、PII、URL path或opaque payload');
assert.doesNotMatch(output, /\?token=/, '日志不得包含URL query');

const diagnosticsSource = fs.readFileSync(path.join(__dirname, '../src/diagnostics.cjs'), 'utf8');
assert.match(diagnosticsSource, /require\('\.\/log-url\.cjs'\)/, '持久diagnostics必须复用canonical URL日志owner');
assert.doesNotMatch(diagnosticsSource, /function sanitizeUrl\(/, 'diagnostics不得继续维护第二套URL解析/脱敏owner');

const rotationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-diagnostics-rotation-'));
const rotating = createDiagnostics({ dir: rotationDir, maxBytes: 1, maxFiles: 3, now: () => '2026-08-16T10:00:00.000Z' });
for (let i = 0; i < 15; i += 1) rotating.log('rotation-order', { sequence: i });
const rotationFiles = fs.readdirSync(rotationDir).filter(name => name.endsWith('.jsonl'));
const generations = rotationFiles
  .map(name => Number(name.match(/-(\d+)\.jsonl$/)?.[1]))
  .sort((a, b) => a - b);
assert.deepEqual(generations, [12, 13, 14], 'rotation cleanup must preserve the newest numeric generations');
const retainedSequences = rotationFiles
  .flatMap(name => fs.readFileSync(path.join(rotationDir, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).metadata.sequence))
  .sort((a, b) => a - b);
assert.deepEqual(retainedSequences, [12, 13, 14], 'retained diagnostics must be the newest events, not lexicographically largest filenames');

console.log('DIAGNOSTICS_CONTRACT_OK');
