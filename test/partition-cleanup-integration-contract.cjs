'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/partition-cleanup\.cjs'\)/, '主进程必须加载分区清理模块');
assert.match(main, /collectOrphanPartitions/, '主进程必须调用孤儿分区统计');
assert.match(main, /Partitions/, '清理必须作用于 userData/Partitions');
assert.match(main, /pendingPartitionDeletions/, '清理失败必须进入退出兜底');
assert.match(main, /await accountState\.load\(\)/, '必须先从 Account State owner 加载已提交账号状态');
assert.match(main, /setTimeout\(\(\) => \{ cleanupOrphanPartitions\(\)\.catch\(\(\) => \{\}\); \}, 3000\)/, '孤儿分区清理必须保持在账号状态加载之后调度');
assert.doesNotMatch(main, /collectOrphanPartitions\([\s\S]{0,200}activePartitions: \[\]/, '清理不得以空账号列表执行');

console.log('PARTITION_CLEANUP_INTEGRATION_CONTRACT_OK');