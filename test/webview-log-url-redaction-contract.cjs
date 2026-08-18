'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeUrlForLog } = require('../src/log-url.cjs');

assert.equal(
  sanitizeUrlForLog('https://web.telegram.org/k/?token=secret#state'),
  'https://web.telegram.org/k/'
);
assert.equal(
  sanitizeUrlForLog('chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html?lw-key=secret#chat'),
  'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html'
);
assert.equal(sanitizeUrlForLog('about:blank#secret'), 'about:blank');
assert.equal(sanitizeUrlForLog('not-a-url?token=secret#state'), 'not-a-url');
assert.doesNotMatch(sanitizeUrlForLog('https://example.com/path?token=secret#state'), /secret|token|state/);

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
