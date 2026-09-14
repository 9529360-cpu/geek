'use strict';
const { performance } = require('node:perf_hooks');

// 崩溃恢复限频器：滑动时间窗口内最多允许 max 次，超限拒绝。
// 使用进程单调时钟避免系统时间调整让恢复额度被意外延长或缩短。
function createRateLimiter({ max, windowMs, now = () => performance.now() }) {
  const timestamps = [];
  let lastNow = null;
  return {
    allow() {
      const t = now();
      if (lastNow !== null && t < lastNow) timestamps.length = 0;
      lastNow = t;
      while (timestamps.length && timestamps[0] <= t - windowMs) timestamps.shift();
      if (timestamps.length >= max) return false;
      timestamps.push(t);
      return true;
    },
    reset() {
      timestamps.length = 0;
      lastNow = null;
    }
  };
}

module.exports = { createRateLimiter };
