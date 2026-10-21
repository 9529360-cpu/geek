'use strict';

// Multi-account memory baseline skeleton (Issue #787 follow-up: 1/3/5-account
// baselines). The E2E app seeds two accounts (e2e-account-a active,
// e2e-account-b), so the ladder this spec can record in one app instance is
// 2 -> 3 -> 5 accounts; the 1-account shape stays a real-client item. This
// spec grows the account count, asserts only sample-shape invariants that
// hold regardless of guest lifecycle, and prints the per-stage partition
// sets (E2E_PARTITION_MEMORY_MULTI) so the run itself becomes the record of
// how guest materialization behaves as accounts are added and activated.
//
// What the first run (PR #799) already established: accounts.add alone does
// NOT materialize a guest for the new account — the partition set stayed
// [a, b, unpartitioned] at 3 and at 5 accounts. This version therefore also
// UI-activates each added account (the shell-smoke nav-account click
// pattern) and re-samples, to test whether activation is the trigger that
// materializes the guest.
//
// Deliberately NOT asserted (yet): any partition-count target. Whether an
// inactive account's guest stays alive after another account activates is
// what these runs characterize; tightening the assertion comes after the
// mechanism is observed, not before it. No value targets either: sampled
// numbers are printed, never thresholded. Activation results are recorded,
// not asserted: a failed activation is data about the mechanism, and the
// final sample still records.
//
// Runs last in the smoke suite (see wdio.conf.cjs) so the accounts it adds
// cannot disturb earlier specs; the isolated E2E userData directory is
// discarded after the run, so no cleanup is needed here.

const assert = require('node:assert/strict');

const PARTITION_PREFIX = 'persist:webview-page-';
const SEEDED_A = 'e2e-account-a';
const SEEDED_B = 'e2e-account-b';
const UI_TIMEOUT = 10_000;
const BASELINE_TIMEOUT = 10_000;
const FINAL_TIMEOUT = 15_000;

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
  // done callback (see partition-memory-sample's takeSample).
  return browser.executeAsync((done) => {
    window.api.diagnostics.partitionMemorySample()
      .then(done)
      .catch((error) => done({ __error: String(error?.message || error) }));
  });
}

async function listAccounts() {
  return browser.executeAsync((done) => {
    window.api.accounts.list()
      .then((result) => done({ accounts: result?.accounts || [], activeAccountId: result?.activeAccountId || '' }))
      .catch((error) => done({ __error: String(error?.message || error) }));
  });
}

async function addAccount(name) {
  return browser.executeAsync((accountName, done) => {
    window.api.accounts.add({ name: accountName, type: 'whatsapp' })
      .then((result) => done({ id: result?.account?.id || '' }))
      .catch((error) => done({ __error: String(error?.message || error) }));
  }, name);
}

async function activateAccountUi(accountId) {
  // Shell-smoke nav-account activation pattern: click the account's nav
  // entry, then wait for the active class. Returns a record, never throws:
  // whether activation materializes the guest is the question under test,
  // so a failed activation is data, not a spec failure.
  try {
    const button = await $(`.nav-account[data-id="${accountId}"] .nav-account-main`);
    await button.waitForDisplayed({ timeout: 5000 });
    await button.click();
    await browser.waitUntil(async () => browser.execute((id) =>
      document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
      timeout: 5000,
      timeoutMsg: `account ${accountId} did not become active`,
    });
    return { accountId, activated: true };
  } catch (error) {
    return { accountId, activated: false, error: String(error?.message || error).slice(0, 120) };
  }
}

function partitionNames(sample) {
  return (sample?.partitions || []).map((part) => part.partition);
}

function assertSampleShape(sample) {
  assert.ok(!sample?.__error, `partition memory sample failed: ${sample?.__error || ''}`);
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
  assert.ok(Number.isSafeInteger(sample.shared.processCount) && sample.shared.processCount >= 1,
    'shared bucket must hold the browser process');
  assert.ok(sample.shared.processes.every((proc) => !['renderer', 'tab'].includes(String(proc.type || '').toLowerCase())),
    'shared bucket must not hold renderer processes');
  const bucketSum = sample.partitions.reduce((sum, part) => sum + part.processCount, 0)
    + sample.shared.processCount + sample.unattributed.processCount;
  assert.equal(sample.totals.processCount, bucketSum, 'totals must cover every bucket');
  assert.ok(Number.isFinite(sample.totals.workingSetSize) && sample.totals.workingSetSize > 0,
    'total working set must be a positive number');
}

async function waitForSeededGuest() {
  let sample = null;
  let lastSeen = null;
  try {
    await browser.waitUntil(async () => {
      sample = await takeSample();
      if (sample?.__error) throw new Error(`partition memory sample failed: ${sample.__error}`);
      lastSeen = sample;
      return partitionNames(sample).includes(`${PARTITION_PREFIX}${SEEDED_A}`);
    }, {
      timeout: BASELINE_TIMEOUT,
      interval: 500,
      timeoutMsg: `memory sample never listed ${PARTITION_PREFIX}${SEEDED_A}`,
    });
  } catch (error) {
    console.log(`E2E_PARTITION_MEMORY_MULTI_LAST_SEEN ${JSON.stringify(lastSeen)}`);
    throw error;
  }
  return sample;
}

async function waitForStablePartitionSet() {
  // Poll until the partition set is identical on two consecutive samples
  // (guests finished materializing) or the timeout hits; either way the
  // last sample is the record. Never fail on the set itself: guest
  // lifecycle for inactive accounts is what this run characterizes.
  let previous = null;
  let sample = null;
  const started = Date.now();
  while (Date.now() - started < FINAL_TIMEOUT) {
    sample = await takeSample();
    if (sample?.__error) throw new Error(`partition memory sample failed: ${sample.__error}`);
    const current = partitionNames(sample).slice().sort().join(',');
    if (previous !== null && previous === current) return sample;
    previous = current;
    await browser.pause(500);
  }
  return sample;
}

describe('partition memory multi-account skeleton', () => {
  it('records the sample shape as the account count grows 2 -> 3 -> 5, then after UI activation', async () => {
    await waitForHostApi();

    const baseline = await waitForSeededGuest();
    assertSampleShape(baseline);
    const baselinePartitions = partitionNames(baseline);

    const before = await listAccounts();
    assert.ok(!before?.__error, `accounts list failed: ${before?.__error || ''}`);
    const beforeIds = before.accounts.map((account) => account.id);
    assert.ok(beforeIds.includes(SEEDED_A), 'seeded account-a must be listed');
    assert.ok(beforeIds.includes(SEEDED_B), 'seeded account-b must be listed');

    // 2 -> 3 accounts (add only; PR #799 showed this alone materializes
    // no new guest).
    const addedC = await addAccount('E2E Memory C');
    assert.ok(!addedC?.__error && addedC.id, `adding account C failed: ${addedC?.__error || 'no id'}`);
    const threeAccountSample = await takeSample();
    assertSampleShape(threeAccountSample);
    const threeAccountPartitions = partitionNames(threeAccountSample);

    // 3 -> 5 accounts. Each add activates the new account (accountState.add
    // sets activeAccountId), so no UI activation step is needed for the
    // add-only stage.
    const addedD = await addAccount('E2E Memory D');
    assert.ok(!addedD?.__error && addedD.id, `adding account D failed: ${addedD?.__error || 'no id'}`);
    const addedE = await addAccount('E2E Memory E');
    assert.ok(!addedE?.__error && addedE.id, `adding account E failed: ${addedE?.__error || 'no id'}`);

    const after = await listAccounts();
    assert.ok(!after?.__error, `accounts list failed: ${after?.__error || ''}`);
    assert.equal(after.accounts.length, before.accounts.length + 3, 'account count must grow by exactly the three added accounts');
    assert.equal(after.activeAccountId, addedE.id, 'the last added account must be active');

    // 5-account add-only sample, for direct comparison with the
    // post-activation sample below.
    const fiveAccountSample = await takeSample();
    assertSampleShape(fiveAccountSample);
    const fiveAccountPartitions = partitionNames(fiveAccountSample);

    // UI-activate each added account in turn, then re-sample: this tests
    // whether activation (not add) is the trigger that materializes a
    // guest. Guests load in parallel after the clicks; the stable-set poll
    // covers creation timing, so no fixed delay is assumed.
    const activationResults = [];
    for (const added of [addedC, addedD, addedE]) {
      activationResults.push(await activateAccountUi(added.id));
    }

    const final = await waitForStablePartitionSet();
    assertSampleShape(final);
    const finalPartitions = partitionNames(final);

    const allIds = [...beforeIds, addedC.id, addedD.id, addedE.id];
    const expectedPartitions = allIds.map((id) => `${PARTITION_PREFIX}${id}`);
    const matchedExpected = expectedPartitions.filter((name) => finalPartitions.includes(name));

    console.log(`E2E_PARTITION_MEMORY_MULTI ${JSON.stringify({
      seededAccounts: [SEEDED_A, SEEDED_B],
      accountCount: after.accounts.length,
      baselinePartitions,
      threeAccountPartitions,
      fiveAccountPartitions,
      postActivationPartitions: finalPartitions,
      activationResults,
      matchedExpected,
      sample: final,
    })}`);
  });
});
