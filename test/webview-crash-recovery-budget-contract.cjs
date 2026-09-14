'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const start = app.indexOf('const webviewCrashLimiter = (() => {');
const end = app.indexOf('\n  function getWebview(account)', start);
assert.ok(start >= 0 && end > start, '必须保留可定位的 WebView 崩溃限频器实现');

const statement = app.slice(start, end).trim();
const expression = statement
  .replace(/^const webviewCrashLimiter = /, '')
  .replace(/;$/, '');

let now = 0;
const limiter = vm.runInNewContext(`(${expression})`, {
  Date: { now: () => now },
  Map,
});

// A 账号独立消耗 2 次 / 60 秒预算。
assert.equal(limiter.allow('account-a'), true);
now = 10_000;
assert.equal(limiter.allow('account-a'), true);
now = 20_000;
assert.equal(limiter.allow('account-a'), false, 'A 的第三次崩溃必须被拒绝');

// B 的首次崩溃不能被 A 的历史压制。
now = 30_000;
assert.equal(limiter.allow('account-b'), true, 'B 必须拥有自己的恢复预算');
now = 40_000;
assert.equal(limiter.allow('account-a'), false, 'B 的恢复不能重置 A 已耗尽的预算');

// 60 秒窗口滑出后，A 独立恢复。
now = 60_000;
assert.equal(limiter.allow('account-a'), true, 'A 的最旧记录过期后必须独立恢复');

assert.match(
  app,
  /render-process-gone[\s\S]{0,500}webviewCrashLimiter\.allow\(account\.id\)/,
  '生产 crash listener 必须把 account.id 传给限频器'
);

console.log('WEBVIEW_CRASH_RECOVERY_BUDGET_CONTRACT_OK');
