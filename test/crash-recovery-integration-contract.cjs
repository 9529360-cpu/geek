'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const moduleFile = fs.readFileSync(path.join(__dirname, '../src/crash-recovery.cjs'), 'utf8');

assert.match(moduleFile, /createRateLimiter/, '限频器模块必须导出 createRateLimiter');

// 主窗口崩溃 -> 限频 relaunch
assert.match(main, /require\('\.\/crash-recovery\.cjs'\)/, '主进程必须加载限频器');
assert.match(main, /relaunchLimiter/, '主进程必须创建 relaunch 限频器');
assert.match(main, /render-process-gone/, '主窗口必须监听 render-process-gone');
assert.match(main, /app\.relaunch\(\)/, '主窗口崩溃后必须 relaunch');
assert.match(main, /诊断|diagnostics\.log\([^)]*crash|main-window/, '主窗口崩溃必须记录诊断');

// webview 崩溃 -> 每账号独立限频 reload（renderer 侧）
assert.match(app, /wv\.addEventListener\('render-process-gone',[\s\S]*webviewCrashLimiter\.allow\(account\.id\)/, 'webview 崩溃恢复必须把 account.id 传给限频器');
assert.match(app, /wv\.reload\(\)/, 'webview 崩溃后必须立即 reload');
assert.match(app, /webviewCrashLimiter\.clear\(id\)/, '删除账号时必须清理该账号的崩溃恢复预算');

const limiterSource = app.match(/const webviewCrashLimiter = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/);
assert.ok(limiterSource, '必须能定位 renderer webview crash limiter 实现');

let now = 1_000;
const fakeDate = { now: () => now };
const createLimiter = new Function('Date', `${limiterSource[0]}; return webviewCrashLimiter;`);
const limiter = createLimiter(fakeDate);

assert.equal(limiter.allow('account-a'), true, '账号 A 第一次崩溃应允许恢复');
now = 2_000;
assert.equal(limiter.allow('account-a'), true, '账号 A 第二次崩溃应允许恢复');
now = 3_000;
assert.equal(limiter.allow('account-a'), false, '账号 A 60 秒内第三次崩溃必须被限频');
assert.equal(limiter.allow('account-b'), true, '账号 A 超限不能消耗账号 B 的首次恢复预算');
now = 4_000;
assert.equal(limiter.allow('account-b'), true, '账号 B 必须拥有独立的第二次恢复预算');
now = 5_000;
assert.equal(limiter.allow('account-a'), false, '账号 B 的活动不能恢复账号 A 的预算');
now = 62_001;
assert.equal(limiter.allow('account-a'), true, '60 秒窗口过去后账号 A 必须独立恢复预算');
limiter.clear('account-a');
now = 62_002;
assert.equal(limiter.allow('account-a'), true, '清理账号预算后重新创建账号应从空预算开始');

console.log('CRASH_RECOVERY_INTEGRATION_CONTRACT_OK');
