'use strict';
// 孤儿分区清理：启动时统计“已删除账号遗留的 webview 分区目录”。
// 只返回应删目录名列表，不执行删除（删除由 main 带保护执行，避免误删正在使用的分区）。

const PARTITION_DIR_PREFIX = 'webview-page-';

function collectOrphanPartitions({ entries, activePartitions }) {
  const activeLeaves = new Set(
    (activePartitions || [])
      .map((partition) => String(partition).replace(/^persist:/, ''))
      .filter(Boolean)
  );
  return (entries || [])
    .filter((name) => name && name.startsWith(PARTITION_DIR_PREFIX))
    .filter((name) => !activeLeaves.has(name));
}

module.exports = { collectOrphanPartitions, PARTITION_DIR_PREFIX };
