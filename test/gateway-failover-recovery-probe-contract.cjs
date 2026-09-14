'use strict';

const assert = require('node:assert/strict');
const { createGatewayPool } = require('../src/gateway-failover.cjs');

(async () => {
  const A = 'https://primary.example.test';
  const B = 'https://backup.example.test';

  const pool = createGatewayPool({ endpoints: [A, B], now: () => 1000 });
  pool.reportFailure(A);
  pool.reportFailure(B);

  const first = pool.pick();
  const second = pool.pick();
  const third = pool.pick();
  assert.deepEqual(
    [first.endpoint, second.endpoint, third.endpoint],
    [A, B, A],
    'all-unhealthy recovery probes must start at primary then rotate across configured endpoints',
  );
  assert.equal(first.route, 'primary');
  assert.equal(second.route, 'backup');

  pool.reportSuccess(B);
  assert.equal(pool.pick().endpoint, B, 'a recovered healthy backup must resume normal healthy routing');
  pool.reportFailure(B);
  assert.deepEqual(
    [pool.pick().endpoint, pool.pick().endpoint],
    [A, B],
    'a new all-unhealthy episode must reset and probe from primary again',
  );

  const checked = createGatewayPool({
    endpoints: [A, B],
    healthFetch: async () => ({ ok: false }),
  });
  const health = await checked.healthCheckAll();
  assert.deepEqual(health, { [A]: false, [B]: false });
  assert.deepEqual(
    [checked.pick().endpoint, checked.pick().endpoint],
    [A, B],
    'healthCheckAll marking every endpoint unhealthy must not collapse later retries onto primary only',
  );

  const single = createGatewayPool({ endpoints: [A] });
  single.reportFailure(A);
  assert.equal(single.pick().endpoint, A);
  assert.equal(single.pick().endpoint, A, 'single-endpoint recovery probing must remain stable');

  console.log('GATEWAY_FAILOVER_RECOVERY_PROBE_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
