'use strict';
const assert = require('node:assert/strict');
const { createGatewayPool, DEFAULT_RECOVERY_PROBE_MS } = require('../src/gateway-failover.cjs');

const A = 'https://primary.example.test';
const B = 'https://backup.example.test';
let clock = 1;
const pool = createGatewayPool({ endpoints: [A, B], now: () => clock });

pool.reportFailure(A);
assert.equal(pool.pick().endpoint, B, 'freshly failed primary must immediately fail over to backup');

clock += DEFAULT_RECOVERY_PROBE_MS - 1;
assert.equal(pool.pick().endpoint, B, 'primary must remain open before cooldown expires');

clock += 1;
assert.equal(pool.pick().endpoint, A, 'cooldown expiry must allow one half-open primary probe');
assert.equal(pool.pick().endpoint, B, 'concurrent pick while half-open probe is in flight must keep backup capacity');

pool.reportSuccess(A);
assert.equal(pool.pick().endpoint, A, 'successful half-open probe must restore primary preference');

clock += 10;
pool.reportFailure(A);
clock += DEFAULT_RECOVERY_PROBE_MS;
assert.equal(pool.pick().endpoint, A, 'a later failure must get a fresh recovery probe after its own cooldown');
pool.reportFailure(A);
assert.equal(pool.pick().endpoint, B, 'failed half-open probe must reset cooldown and return traffic to backup');

// When every endpoint is down there is no healthy capacity to preserve, so retain best-effort rotation.
pool.reportFailure(B);
assert.equal(pool.pick().endpoint, A);
assert.equal(pool.pick().endpoint, B);

console.log('GATEWAY_FAILOVER_HALF_OPEN_CONTRACT_OK');
