'use strict';
const assert = require('node:assert/strict');
const { collectOrphanPartitions } = require('../src/partition-cleanup.cjs');

// 只统计“应删除的孤儿分区目录名”，不实际删除（删除在 main 带保护执行）

// 1) 当前账号 partition 不在孤儿列表
const orphan1 = collectOrphanPartitions({
  entries: ['webview-page-a', 'webview-page-b', 'webview-page-orphan', 'other-storage', 'Cache'],
  activePartitions: ['persist:webview-page-a', 'persist:webview-page-b']
});
assert.deepEqual(orphan1, ['webview-page-orphan'], '只应删除非当前账号的 webview-page-* 目录');
assert.ok(!orphan1.includes('other-storage'), '不得删除非 webview-page 前缀目录');
assert.ok(!orphan1.includes('Cache'), '不得删除 Cache 等系统目录');

// 2) 空目录名（未命名分区）不参与
const orphan2 = collectOrphanPartitions({
  entries: ['', 'webview-page-x'],
  activePartitions: []
});
assert.deepEqual(orphan2, ['webview-page-x'], '空名目录必须跳过');

// 3) 无活跃账号时仍只清理 webview-page-* 前缀
const orphan3 = collectOrphanPartitions({
  entries: ['webview-page-1', 'webview-page-2', 'Local Storage'],
  activePartitions: []
});
assert.deepEqual(orphan3.sort(), ['webview-page-1', 'webview-page-2'], '无活跃账号时清理全部 webview-page 前缀');

console.log('PARTITION_CLEANUP_CONTRACT_OK');
