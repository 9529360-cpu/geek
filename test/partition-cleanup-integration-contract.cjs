'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/partition-cleanup\.cjs'\)/, '主进程必须加载分区清理模块');
assert.match(main, /collectOrphanPartitions/, '主进程必须调用孤儿分区统计');
assert.match(main, /Partitions/, '清理必须作用于 userData/Partitions');
assert.match(main, /pendingPartitionDeletions/, '清理失败必须进入退出兜底');

const removeBody = main.match(/async function removeAccount\([\s\S]*?\n\}\n\nlet accountIpcBoundary/)?.[0] || '';
const durableDeleteAt = removeBody.indexOf('await accountState.remove(accountId)');
const partitionDirAt = removeBody.indexOf('const partitionDir = path.join(');
const sessionCleanupAt = removeBody.indexOf('await accountSession.clearStorageData()');
assert.ok(durableDeleteAt >= 0, '账号删除必须先提交到 Account State owner');
assert.ok(partitionDirAt > durableDeleteAt && partitionDirAt < sessionCleanupAt, 'durable delete 后必须先确定唯一 partition cleanup 路径再执行 Session 清理');
assert.match(removeBody, /await fs\.rm\(partitionDir, \{ recursive: true, force: true \}\)/, '直接目录清理必须复用同一 partitionDir');
assert.match(removeBody, /catch \(dirError\) \{\s*pendingPartitionDeletions\.add\(partitionDir\)/, '目录删除失败必须登记退出重试');
assert.match(removeBody, /catch \(error\) \{\s*pendingPartitionDeletions\.add\(partitionDir\)[\s\S]*账号已删除，但登录数据清理失败/, '任意前置 Session 清理失败也必须登记退出重试');

const cleanupBody = main.match(/async function cleanupOrphanPartitions\(\) \{[\s\S]*?\n\}\n\napp\.whenReady/)?.[0] || '';
assert.match(cleanupBody, /const snapshot = accountState\.getSnapshot\(\)/, 'startup reclaim 必须从 Account State authority 读取快照');
assert.doesNotMatch(cleanupBody, /if \(!snapshot\.accounts\.length\) return/, '已成功加载的空账号状态是权威真相，不得跳过 orphan 回收');
assert.match(cleanupBody, /const activePartitions = snapshot\.accounts\.map\(\(account\) => account\.partition\)/, 'startup reclaim 必须保护所有活跃 partition');
assert.match(cleanupBody, /collectOrphanPartitions\(\{ entries, activePartitions \}\)/, 'orphan 选择必须继续受 webview-page 前缀 contract 约束');

const startup = main.match(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?\n\}\);\n\napp\.on\('window-all-closed'/)?.[0] || '';
const accountLoadAt = startup.indexOf('await accountState.load()');
const cleanupScheduleAt = startup.indexOf('setTimeout(() => { cleanupOrphanPartitions().catch(() => {}); }, 3000)');
assert.ok(accountLoadAt >= 0 && cleanupScheduleAt > accountLoadAt, '孤儿分区清理必须只在 Account State 成功加载后调度');

console.log('PARTITION_CLEANUP_INTEGRATION_CONTRACT_OK');