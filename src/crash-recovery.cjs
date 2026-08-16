'use strict';
// 崩溃恢复限频器：滑动时间窗口内最多允许 max 次，超限拒绝。
// 用于 webview 崩溃自动 reload 与主窗口崩溃自动 relaunch，避免崩溃循环。

function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const timestamps = [];
  return {
    allow() {
      const t = now();
      while (timestamps.length && timestamps[0] <= t - windowMs) timestamps.shift();
      if (timestamps.length >= max) return false;
      timestamps.push(t);
      return true;
    },
    reset() {
      timestamps.length = 0;
    }
  };
}

module.exports = { createRateLimiter };
