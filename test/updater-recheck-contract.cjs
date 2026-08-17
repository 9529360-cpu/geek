'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const updater = fs.readFileSync(path.join(__dirname, '../src/updater.cjs'), 'utf8');

assert.match(updater, /INITIAL_CHECK_DELAY_MS\s*=\s*10 \* 1000/, '首次更新检查应延迟 10 秒');
assert.match(updater, /RECHECK_INTERVAL_MS\s*=\s*6 \* 60 \* 60 \* 1000/, '长期运行客户端必须每 6 小时重查');
assert.match(updater, /let checkInFlight = false/, '必须有更新检查并发保护');
assert.match(updater, /if \(checkInFlight \|\| isInstallingUpdate\)/, '检查中或安装中不得并发触发新检查');
assert.match(updater, /finally\s*\{[\s\S]*checkInFlight = false;[\s\S]*scheduleUpdateCheck\(RECHECK_INTERVAL_MS\)/, '每次检查结束后必须安排下一次检查');
assert.match(updater, /scheduleUpdateCheck\(INITIAL_CHECK_DELAY_MS\)/, '初始化必须安排首次检查');
assert.match(updater, /checkTimer\.unref\?\.\(\)/, '周期检查定时器不得单独阻止应用退出');
assert.match(updater, /quitAndInstallForUpdate[\s\S]*clearTimeout\(checkTimer\)/, '开始安装更新前必须停止后续检查定时器');
assert.match(updater, /generic provider/, '更新模块说明必须与当前 R2 generic 发布渠道一致');
assert.doesNotMatch(updater, /provider:\s*github/, '不得保留已经过期的 GitHub provider 操作说明');

console.log('UPDATER_RECHECK_CONTRACT_OK');
