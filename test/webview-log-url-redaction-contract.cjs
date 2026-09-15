'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeUrlForLog } = require('../src/log-url.cjs');

assert.equal(
  sanitizeUrlForLog('https://web.telegram.org/k/?token=secret#state'),
  'https://web.telegram.org/[REDACTED_PATH]'
);
assert.equal(
  sanitizeUrlForLog('chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html?lw-key=secret#chat'),
  'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/[REDACTED_PATH]'
);
assert.equal(sanitizeUrlForLog('about:blank#secret'), 'about:blank');
assert.equal(sanitizeUrlForLog('https://example.com/'), 'https://example.com/');
assert.equal(sanitizeUrlForLog('not-a-url?token=secret#state'), '[INVALID_URL]');

const sensitivePath = sanitizeUrlForLog('https://example.com/reset/session-token-123?token=secret#state');
assert.equal(sensitivePath, 'https://example.com/[REDACTED_PATH]');
assert.doesNotMatch(sensitivePath, /reset|session-token-123|secret|token|state/);

const dataUrl = sanitizeUrlForLog('data:text/html,<script>secret-token</script>#state');
assert.equal(dataUrl, 'data:[REDACTED]');
assert.doesNotMatch(dataUrl, /script|secret-token|state/);

const fileUrl = sanitizeUrlForLog('file:///Users/alice/private/customer-42.csv');
assert.equal(fileUrl, 'file:[REDACTED]');
assert.doesNotMatch(fileUrl, /alice|private|customer-42/);

const malformedUserinfo = sanitizeUrlForLog('https://alice:secret@example.com:bad/path-token?token=x#state');
assert.equal(malformedUserinfo, 'https://example.com:bad/[REDACTED_PATH]');
assert.doesNotMatch(malformedUserinfo, /alice|secret|path-token|token|state/, 'malformed URL fallback must not expose userinfo/path/query/hash secrets');
assert.equal(
  sanitizeUrlForLog('not-a-valid-url/private/customer-42?token=secret#state'),
  '[INVALID_URL]',
  'unparsed malformed input must fail closed instead of preserving arbitrary path data'
);

const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
assert.match(main, /require\('\.\/log-url\.cjs'\)/, '主进程必须复用 URL 日志脱敏 helper');

const failLoad = main.match(/webContents\.on\('did-fail-load',[\s\S]*?\n    \}\);/)?.[0] || '';
assert.ok(failLoad, '必须能定位 did-fail-load 日志块');
assert.match(failLoad, /sanitizeUrlForLog\(validatedURL\)/, 'did-fail-load 必须先脱敏 URL');
assert.match(failLoad, /url:\s*safeUrl/, 'diagnostics 必须写入脱敏 URL');
assert.doesNotMatch(failLoad, /url=\$\{validatedURL\}/, 'console 不得直接打印 validatedURL');

const navigateLine = main.split('\n').find((line) => line.includes('[wv] did-navigate url=')) || '';
assert.match(navigateLine, /sanitizeUrlForLog\(url\)/, 'did-navigate 必须脱敏 URL');

const inPageLine = main.split('\n').find((line) => line.includes('[wv] did-navigate-in-page url=')) || '';
assert.match(inPageLine, /sanitizeUrlForLog\(url\)/, 'did-navigate-in-page 必须脱敏 URL');

console.log('WEBVIEW_LOG_URL_REDACTION_CONTRACT_OK');
