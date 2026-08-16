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

console.log('CRASH_RECOVERY_CONTRACT_OK');
