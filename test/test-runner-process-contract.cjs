'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runTests } = require('../scripts/run-tests.cjs');

(async () => {
  let active = 0;
  let maxActive = 0;
  const launched = [];
  function spawnImpl(_exe, args) {
    const child = new EventEmitter();
    const name = String(args?.[0] || '').split(/[\\/]/).at(-1);
    launched.push(name);
    active += 1;
    maxActive = Math.max(maxActive, active);
    setImmediate(() => {
      active -= 1;
      child.emit('exit', 0, null);
    });
    return child;
  }

  await runTests(['alpha.cjs', 'beta.cjs', 'gamma.cjs'], { spawnImpl });
  assert.deepEqual(launched, ['alpha.cjs', 'beta.cjs', 'gamma.cjs']);
  assert.equal(maxActive, 1, 'test runner must remain strictly sequential while avoiding spawnSync');

  let calls = 0;
  function failingSpawn() {
    const child = new EventEmitter();
    calls += 1;
    setImmediate(() => child.emit('exit', 7, null));
    return child;
  }
  await assert.rejects(
    () => runTests(['red.cjs', 'must-not-run.cjs'], { spawnImpl: failingSpawn }),
    error => error?.exitCode === 7,
  );
  assert.equal(calls, 1, 'runner must stop immediately after the first failing contract');
  console.log('TEST_RUNNER_PROCESS_CONTRACT_OK');
})().catch(error => { console.error(error); process.exit(1); });
