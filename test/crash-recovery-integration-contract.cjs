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

// webview 崩溃 -> 账号级限频 reload（renderer 侧）
assert.match(app, /webviewCrashLimiter|crashLimiter|render-process-gone/, 'renderer 必须监听 webview 崩溃');
assert.match(app, /wv\.reload\(\)/, 'webview 崩溃后必须 reload');
assert.match(app, /webviewCrashLimiter\.allow\(account\.id\)/, 'webview 恢复必须按账号 id 消耗独立预算');

console.log('CRASH_RECOVERY_INTEGRATION_CONTRACT_OK');
