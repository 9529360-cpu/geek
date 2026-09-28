'use strict';

const assert = require('node:assert/strict');
const { selectHostTarget, waitForHostTarget } = require('../test/cdp-reload.cjs');

const target = { type: 'page', title: '极客', webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/1' };
assert.equal(selectHostTarget([{ type: 'webview', title: '极客' }, target], '极客'), target);
assert.equal(selectHostTarget([{ type: 'webview', title: '极客' }], '极客'), null);

(async () => {
  let attempts = 0;
  let clock = 0;
  const resolved = await waitForHostTarget('极客', {
    getTargets: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      if (attempts === 2) return [];
      return [target];
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    maxWaitMs: 500,
    retryMs: 10,
  });
  assert.equal(resolved, target);
  assert.equal(attempts, 3, 'reload must tolerate startup connection and target publication races');

  clock = 0;
  await assert.rejects(
    () => waitForHostTarget('极客', {
      getTargets: async () => [],
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      maxWaitMs: 20,
      retryMs: 10,
    }),
    error => error?.code === 'CDP_HOST_TARGET_TIMEOUT' && error?.category === 'NO_TARGET',
  );
  console.log('CDP_RELOAD_CONTRACT_OK');
})().catch(error => { console.error(error); process.exit(1); });
