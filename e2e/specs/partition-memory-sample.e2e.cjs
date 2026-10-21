'use strict';

// Live end-to-end check for on-demand per-partition memory sampling
// (Issue #787, item 2). The unit contracts prove the sampler's grouping
// logic with fake metrics; this spec proves the full live wiring — main
// IPC channel + preload + sampler against real Electron metrics — in an
// app instance with real guest webviews.
//
// Shape only, no value targets: no threshold in this file is a performance
// target, and targets can only be set after the first real measurement
// run. The sampled values are printed to the CI log (E2E_PARTITION_MEMORY)
// so the run itself becomes the baseline record.

const assert = require('node:assert/strict');

const ACTIVE_PARTITION = 'persist:webview-page-e2e-account-a';
const UI_TIMEOUT = 10_000;
const SAMPLE_TIMEOUT = 30_000;

async function waitForHostApi() {
  await browser.waitUntil(async () => browser.execute(() =>
    document.readyState === 'complete' && !!window.api?.diagnostics?.partitionMemorySample), {
    timeout: UI_TIMEOUT,
    interval: 100,
    timeoutMsg: 'Geek main renderer did not expose the diagnostics API',
  });
}

async function takeSample() {
  // Repo convention: async renderer work goes through executeAsync with a
  // done callback (see webview-navigation-runtime's readAccount). A
  // promise-returning browser.execute is not a reliable way to await IPC
  // here, so do not use it for this call.
  return browser.executeAsync((done) => {
    window.api.diagnostics.partitionMemorySample()
      .then(done)
      .catch((error) => done({ __error: String(error?.message || error) }));
  });
}

describe('partition memory sampling', () => {
  it('samples the active guest partition from a live app without value targets', async () => {
    await waitForHostApi();

    // The active account's guest materializes at startup; poll the sample
    // itself so renderer-process creation races resolve by waiting, not
    // by assuming a fixed delay. On timeout, print the last sample seen so
    // the CI log carries the evidence instead of just the timeout.
    let sample = null;
    let lastSeen = null;
    try {
      await browser.waitUntil(async () => {
        sample = await takeSample();
        if (sample?.__error) throw new Error(`partition memory sample failed: ${sample.__error}`);
        lastSeen = sample;
        const names = (sample?.partitions || []).map(part => part.partition);
        return names.includes(ACTIVE_PARTITION);
      }, {
        timeout: SAMPLE_TIMEOUT,
        interval: 500,
        timeoutMsg: `memory sample never listed ${ACTIVE_PARTITION}`,
      });
    } catch (error) {
      console.log(`E2E_PARTITION_MEMORY_LAST_SEEN ${JSON.stringify(lastSeen)}`);
      throw error;
    }

    assert.ok(Array.isArray(sample.partitions), 'sample must list partitions');
    for (const part of sample.partitions) {
      assert.equal(typeof part.partition, 'string');
      assert.ok(Number.isSafeInteger(part.processCount) && part.processCount >= 1,
        `partition ${part.partition} must attribute at least one process`);
      assert.ok(Number.isFinite(part.workingSetSize), `partition ${part.partition} workingSetSize must be finite`);
      assert.ok(Number.isFinite(part.privateBytes), `partition ${part.partition} privateBytes must be finite`);
      assert.ok(Array.isArray(part.processes) && part.processes.length === part.processCount,
        `partition ${part.partition} processes must match its process count`);
      for (const proc of part.processes) {
        // Live Electron reports guest renderers as 'Tab'; older releases
        // report 'renderer'. Either is a renderer for attribution purposes.
        assert.ok(['renderer', 'tab'].includes(String(proc.type || '').toLowerCase()),
          `partition ${part.partition} process type must be renderer-ish, got ${proc.type}`);
        assert.ok(Number.isSafeInteger(proc.pid) && proc.pid > 0, 'renderer pid must be a positive integer');
      }
    }

    // The browser process itself must land in shared, never in a partition.
    assert.ok(Number.isSafeInteger(sample.shared.processCount) && sample.shared.processCount >= 1,
      'shared bucket must hold the browser process');
    assert.ok(sample.shared.processes.every(proc => !['renderer', 'tab'].includes(String(proc.type || '').toLowerCase())),
      'shared bucket must not hold renderer processes');

    // Totals cover every bucket.
    const bucketSum = sample.partitions.reduce((sum, part) => sum + part.processCount, 0)
      + sample.shared.processCount + sample.unattributed.processCount;
    assert.equal(sample.totals.processCount, bucketSum, 'totals must cover every bucket');
    assert.ok(Number.isFinite(sample.totals.workingSetSize) && sample.totals.workingSetSize > 0,
      'total working set must be a positive number');

    console.log(`E2E_PARTITION_MEMORY ${JSON.stringify(sample)}`);
  });
});
