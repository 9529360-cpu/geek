'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/partition-cleanup\.cjs'\)/, '主进程必须加载分区清理模块');
assert.match(main, /collectOrphanPartitions/, '主进程必须调用孤儿分区统计');
assert.match(main, /Partitions/, '清理必须作用于 userData\/Partitions');
assert.match(main, /pendingPartitionDeletions/, '清理失败必须进入退出兜底');

const stateLoadIndex = main.indexOf('await accountState.load()');
const orphanScheduleIndex = main.indexOf('setTimeout(() => { cleanupOrphanPartitions().catch(() => {}); }, 3000)');
assert.ok(stateLoadIndex >= 0, '必须先从 Account State owner 加载已提交账号状态');
assert.ok(orphanScheduleIndex > stateLoadIndex, '孤儿分区清理必须只在 Account State 成功加载之后调度');
assert.doesNotMatch(
  main,
  /if\s*\(\s*!snapshot\.accounts\.length\s*\)\s*return\s*;/,
  '已成功加载的空账号列表仍是权威状态，必须允许回收 webview-page-* 孤儿分区',
);

const removeAccountIndex = main.indexOf('async function removeAccount');
const partDirIndex = main.indexOf("const partDir = path.join(app.getPath('userData'), 'Partitions'", removeAccountIndex);
const clearStorageIndex = main.indexOf('await accountSession.clearStorageData()', removeAccountIndex);
assert.ok(removeAccountIndex >= 0 && partDirIndex > removeAccountIndex, '删除账号后必须先固定该账号的分区目录');
assert.ok(clearStorageIndex > partDirIndex, '分区目录必须在任何 Session 清理操作之前确定，确保早期失败也可登记重试');
assert.match(
  main.slice(removeAccountIndex, main.indexOf('let accountIpcBoundary', removeAccountIndex)),
  /catch \(error\) \{[\s\S]{0,240}pendingPartitionDeletions\.add\(partDir\)/,
  'Session 或目录清理失败都必须登记同一个分区目录到退出重试集合',
);
assert.match(
  main.slice(removeAccountIndex, main.indexOf('let accountIpcBoundary', removeAccountIndex)),
  /pendingPartitionDeletions\.delete\(partDir\)/,
  '目录删除成功后必须清除可能存在的旧 pending 标记',
);

console.log('PARTITION_CLEANUP_INTEGRATION_CONTRACT_OK');
