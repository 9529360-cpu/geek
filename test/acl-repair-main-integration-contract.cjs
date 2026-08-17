'use strict';
// 集成契约：main.cjs 启动流程必须集成 ACL 修复迁移
// - 打包+win32 时，修复必须在 diagnostics.log('app-ready') 之前执行
// - 修复失败不得阻断 whenReady / 主窗口创建
// - 不再使用旧 hardenUserDataDir（/inheritance:r 会清空子目录 ACL）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

// 1. 必须加载 ACL 修复模块
assert.match(main, /require\('\.\/acl-repair\.cjs'\)/, '主进程必须加载 ACL 修复模块');

// 2. 启动前置修复必须调用 runStartupAclRepair 且早于 app-ready 日志（升级首次启动即修复）
const readyIdx = main.indexOf('app.whenReady()');
const repairCallIdx = main.indexOf('runStartupAclRepair(');
const appReadyLogIdx = main.indexOf("diagnostics.log('app-ready'");
assert.ok(readyIdx >= 0 && appReadyLogIdx > readyIdx, 'whenReady 回调必须存在且 app-ready 在其内');
assert.ok(repairCallIdx > readyIdx && repairCallIdx < appReadyLogIdx, 'ACL 修复必须先于 app-ready 日志');

// 3. 修复仅在打包 + win32 时执行
const gate = main.slice(repairCallIdx - 400, repairCallIdx + 100);
assert.match(gate, /app\.isPackaged/, 'ACL 修复必须限定打包版');
assert.match(gate, /process\.platform\s*===?\s*'win32'/, 'ACL 修复必须限定 Windows');

// 4. 修复必须传入独立可信基准（防自证）与可靠用户名
const aclArgs = main.slice(repairCallIdx, main.indexOf('});', repairCallIdx) + 4);
assert.match(aclArgs, /expectedUserDataDir/, '必须传入独立可信基准 expectedUserDataDir');
assert.match(aclArgs, /resolveUsername/, '必须通过 resolveUsername 取得用户名');

// 5. 旧 hardenUserDataDir 必须移除；不得再实际调用 icacls 带 /inheritance:r（注释说明允许）
assert.doesNotMatch(main, /function hardenUserDataDir/, '旧 hardenUserDataDir 必须移除');
assert.doesNotMatch(main, /execFile\([^)]*\/inheritance:r/, '不得再实际执行 icacls /inheritance:r');

// 6. diagnostics 必须在写入前自动重试 mkdir（ACL 修复后无需重新初始化）
const diagSrc = fs.readFileSync(path.join(__dirname, '../src/diagnostics.cjs'), 'utf8');
assert.match(diagSrc, /ensureDir/, 'diagnostics 必须实现目录自动恢复');
assert.match(diagSrc, /if \(!ensureDir\(\)\)/, '目录不可用时必须静默降级');

console.log('ACL_REPAIR_MAIN_INTEGRATION_OK');
