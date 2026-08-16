'use strict';
const assert = require('node:assert/strict');
const { createGatewayPool } = require('../src/gateway-failover.cjs');

(async () => {
const A = 'http://127.0.0.1:18991';
const B = 'http://127.0.0.1:18992';

// 1) 全部健康时按顺序返回 primary/backup
const pool1 = createGatewayPool({ endpoints: [A, B], now: () => 0 });
const p1 = pool1.pick();
assert.equal(p1.endpoint, A, '首选端点必须是 primary');
assert.equal(p1.route, 'primary', 'route 必须为 primary');

// 2) primary 失败后切换 backup
const pool2 = createGatewayPool({ endpoints: [A, B], now: () => 0 });
pool2.reportFailure(A);
const p2 = pool2.pick();
assert.equal(p2.endpoint, B, 'primary 失败后必须切到 backup');
assert.equal(p2.route, 'backup', 'route 必须为 backup');

// 3) 失败端点恢复（健康检查）后回到 primary
const pool3 = createGatewayPool({ endpoints: [A, B], now: () => 0 });
pool3.reportFailure(A);
pool3.reportHealth(A, true);
const p3 = pool3.pick();
assert.equal(p3.endpoint, A, '恢复后必须回到 primary');

// 4) 全部失败时尽力而为返回第一个端点，route=primary，不抛错
const pool4 = createGatewayPool({ endpoints: [A, B], now: () => 0 });
pool4.reportFailure(A);
pool4.reportFailure(B);
const p4 = pool4.pick();
assert.equal(p4.endpoint, A, '全部失败时尽力而为返回第一个端点');

// 5) 连续失败计入健康状态；成功后重置
const pool5 = createGatewayPool({ endpoints: [A, B], now: () => 0 });
pool5.reportFailure(A);
pool5.reportFailure(A);
assert.equal(pool5.pick().endpoint, B, '连续失败后持续切到 backup');
pool5.reportSuccess(B);
assert.equal(pool5.pick().endpoint, B, '成功端点保持 backup');

// 6) healthCheckAll 用提供的 fetchImpl 探测并更新状态
let calls = [];
const pool6 = createGatewayPool({
  endpoints: [A, B], now: () => 0,
  healthFetch: async (url) => { calls.push(url); return { ok: url === A + '/health' }; }
});
const health = await pool6.healthCheckAll();
assert.deepEqual(calls.sort(), [A + '/health', B + '/health'].sort(), '必须探测全部端点 /health');
assert.equal(health[A], true, 'A 健康');
assert.equal(health[B], false, 'B 不健康');
const p6 = pool6.pick();
assert.equal(p6.endpoint, A, '健康检查后 pick 优先健康端点');

console.log('GATEWAY_FAILOVER_CONTRACT_OK');
})().catch(err => { console.error(err); process.exit(1); });
