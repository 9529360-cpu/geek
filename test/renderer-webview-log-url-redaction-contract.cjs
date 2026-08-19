'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'ui', 'log-url.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const rendererSanitizer = require('../ui/log-url.js');
const mainSanitizer = require('../src/log-url.cjs');

const cases = [
  'https://user:pass@example.com/path?token=secret#state',
  'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html?lw-key=secret#chat',
  'about:blank#secret',
  'not-a-valid-url/path?token=secret#state',
  '',
  null,
];
for (const value of cases) {
  assert.equal(
    rendererSanitizer.sanitizeUrlForLog(value),
    mainSanitizer.sanitizeUrlForLog(value),
    `renderer/main URL sanitizers must agree for ${String(value)}`
  );
}
assert.equal(
  rendererSanitizer.sanitizeUrlForLog(`broken-${'x'.repeat(700)}?token=secret`).length,
  512,
  'malformed renderer URLs must remain bounded'
);
assert.doesNotMatch(
  rendererSanitizer.sanitizeUrlForLog('https://user:pass@example.com/path?token=secret#state'),
  /user|pass|token|secret|state/,
  'renderer URL sanitizer must remove credentials, query and hash'
);

const browser = vm.createContext({ window: {}, URL });
vm.runInContext(rendererSource, browser, { filename: 'ui/log-url.js' });
assert.equal(typeof browser.window.GeekLogUrl?.sanitizeUrlForLog, 'function', 'browser helper must expose GeekLogUrl');
assert.equal(
  browser.window.GeekLogUrl.sanitizeUrlForLog('https://example.com/a?secret=1#x'),
  'https://example.com/a'
);

const helperIndex = index.indexOf('<script src="log-url.js"></script>');
const appIndex = index.indexOf('<script src="app.js"></script>');
assert.ok(helperIndex >= 0 && appIndex > helperIndex, 'renderer URL helper must load before app.js');

const blockStart = app.indexOf('window.__wvLog = window.__wvLog || [];');
const blockEnd = app.indexOf("wv.addEventListener('dom-ready'", blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, 'WebView in-memory logging block must exist');
const block = app.slice(blockStart, blockEnd);

assert.match(block, /const safeWebviewLogUrl = \(value\) => \{/, 'WebView logger must use a fail-closed wrapper');
assert.match(block, /window\.GeekLogUrl && window\.GeekLogUrl\.sanitizeUrlForLog/, 'wrapper must use the browser URL sanitizer');
assert.match(block, /return typeof sanitize === 'function' \? sanitize\(value\) : '';/, 'missing helper must return an empty URL');
assert.match(block, /catch \{\s*return '';\s*\}/, 'sanitizer errors must fail closed');
assert.match(block, /url=\$\{safeWebviewLogUrl\(e\.validatedURL\)\}/, 'did-fail-load URL must be sanitized');
assert.match(block, /safeWebviewLogUrl\(wv\.getURL && wv\.getURL\(\)\)/, 'current WebView URL must be sanitized');
assert.doesNotMatch(block, /url=\$\{e\.validatedURL\}/, 'raw validatedURL must not remain in renderer logs');
assert.doesNotMatch(block, /url=\$\{wv\.getURL && wv\.getURL\(\)\}/, 'raw getURL result must not remain in renderer logs');

console.log('RENDERER_WEBVIEW_LOG_URL_REDACTION_CONTRACT_OK');
