'use strict';
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/crash-recovery.cjs');

// 窗口内允许 max 次；超限拒绝；窗口滑动后恢复
const now0 = () => 0;
const limiter = createRateLimiter({ max: 2, windowMs: 60000, now: now0 });
assert.equal(limiter.allow(), true, '第1次允许');
assert.equal(limiter.allow(), true, '第2次允许');
assert.equal(limiter.allow(), false, '第3次必须拒绝（限频）');
assert.equal(limiter.allow(), false, '继续拒绝');

const sliding = createRateLimiter({ max: 2, windowMs: 60000, now: now0 });
sliding.allow(); // t=0
assert.equal(sliding.allow(), true, '窗口内第2次允许');
assert.equal(sliding.allow(), false, '窗口内第3次拒绝');

// 推进时间到窗口外 -> 恢复
const clock = { t: 0 };
const timeLimiter = createRateLimiter({ max: 2, windowMs: 60000, now: () => clock.t });
timeLimiter.allow(); // t=0
timeLimiter.allow(); // t=0
assert.equal(timeLimiter.allow(), false, 't=0 第3次拒绝');
clock.t = 60001;
assert.equal(timeLimiter.allow(), true, '窗口滑动后恢复');

// 显式注入的非单调时钟发生回拨时，旧时间戳不能永久占用恢复额度。
const rollbackClock = { t: 100000 };
const rollbackLimiter = createRateLimiter({ max: 2, windowMs: 60000, now: () => rollbackClock.t });
assert.equal(rollbackLimiter.allow(), true, '回拨前第1次允许');
assert.equal(rollbackLimiter.allow(), true, '回拨前第2次允许');
assert.equal(rollbackLimiter.allow(), false, '回拨前额度已满');
rollbackClock.t = 0;
assert.equal(rollbackLimiter.allow(), true, '检测到时钟回拨后应重新建立当前窗口');
assert.equal(rollbackLimiter.allow(), true, '回拨后的当前窗口仍保留完整额度');
assert.equal(rollbackLimiter.allow(), false, '回拨后的新窗口仍执行原限频规则');

// 默认时钟必须独立于 Date.now()；固定 wall clock 后，真实单调时间推进仍应让窗口过期。
const originalDateNow = Date.now;
Date.now = () => 0;
try {
  const defaultLimiter = createRateLimiter({ max: 1, windowMs: 1 });
  assert.equal(defaultLimiter.allow(), true, '默认时钟第1次允许');
  const waitUntil = process.hrtime.bigint() + 5_000_000n;
  while (process.hrtime.bigint() < waitUntil) {}
  assert.equal(defaultLimiter.allow(), true, '默认时钟不能被固定或回拨的 Date.now() 锁住');
} finally {
  Date.now = originalDateNow;
}

const resetLimiter = createRateLimiter({ max: 1, windowMs: 60000, now: now0 });
assert.equal(resetLimiter.allow(), true, 'reset 前第1次允许');
assert.equal(resetLimiter.allow(), false, 'reset 前额度已满');
resetLimiter.reset();
assert.equal(resetLimiter.allow(), true, 'reset 后恢复完整额度');

console.log('CRASH_RECOVERY_CONTRACT_OK');
