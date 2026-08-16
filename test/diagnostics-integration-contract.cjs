'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/diagnostics\.cjs'\)/, '主进程必须加载诊断模块');
assert.match(main, /path\.join\(USER_DATA_DIR, 'diagnostics'\)/, '诊断日志必须位于userData');
assert.match(main, /maxBytes:\s*5\s*\*\s*1024\s*\*\s*1024/, '日志必须限制为5MB轮转');
assert.match(main, /maxFiles:\s*5/, '日志最多保留5个文件');
assert.match(main, /uncaughtExceptionMonitor/, '必须使用不改变崩溃语义的monitor事件');
assert.doesNotMatch(main, /process\.on\('uncaughtException'/, '不得用uncaughtException吞掉默认崩溃');
assert.match(main, /render-process-gone/, '必须记录主渲染进程退出');
assert.match(main, /child-process-gone/, '必须记录Electron子进程退出');
assert.match(main, /webview-load-failed/, '必须记录WebView加载失败');
assert.doesNotMatch(main, /diagnostics\.log\([^\n]*chat(Text|Body)|diagnostics\.log\([^\n]*message(Text|Body)/, '诊断调用不得传聊天正文');

console.log('DIAGNOSTICS_INTEGRATION_CONTRACT_OK');
