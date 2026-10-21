'use strict';

// Multi-account memory baseline skeleton (Issue #787 follow-up: 1/3/5-account
// baselines). The E2E app seeds two accounts (e2e-account-a active,
// e2e-account-b), so the ladder this spec can record in one app instance is
// 2 -> 3 -> 5 accounts; the 1-account shape stays a real-client item. This
// spec grows the account count through the real user path (App Center UI
// adds), asserts sample-shape invariants, and prints the per-stage
// partition sets (E2E_PARTITION_MEMORY_MULTI) so the run itself becomes the
// record of multi-account guest memory.
//
// Mechanism, established across the PR #799/#800 runs — read before
// touching this spec:
// - accounts.add over IPC alone does NOT refresh the renderer: main sends
//   accounts:changed, but no renderer listener exists, so the sidebar list
//   and webviews stay stale. PR #799's add-only run therefore showed no
//   new guests, and nav entries for IPC-added accounts never appeared, so
//   nav-click activation could not even be attempted (PR #800 first cut).
// - The App Center add flow (add-confirm handler) calls accounts.add and
//   then loadAccounts(), which re-renders the sidebar AND creates a
//   webview for every account ("原版多开模型：所有账号的 webview 全部常驻").
//   That is the trigger that materializes guests, and it is what this
//   spec drives. This is not a product bug to fix here: the product's own
//   add path already refreshes; only direct IPC adds bypass it.
// - No value targets: sampled numbers are printed, never thresholded.
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

async function addAccountsViaAppCenter({ name, count, beforeIds }) {
  // Drive the real user path: App Center dialog -> platform card -> name
  // and count -> confirm. The confirm handler calls accounts.add and then
  // loadAccounts(), which is what re-renders the sidebar and creates a
  // webview for every account. Returns the new account ids.
  const appCenter = await $('#btn-app-center');
  await appCenter.waitForDisplayed({ timeout: 5000 });
  await appCenter.click();
  const card = await $('.add-platform-card[data-type="whatsapp"]');
  await card.waitForDisplayed({ timeout: 5000 });
  await card.click();
  const nameInput = await $('#add-name');
  await nameInput.waitForDisplayed({ timeout: 5000 });
  await nameInput.setValue(name);
  const countInput = await $('#add-count');
  await countInput.setValue(String(count));
  const confirm = await $('#add-confirm');
  await confirm.click();
  // Wait for the dialog to close and the backend list to grow; the
  // webviews themselves materialize asynchronously and are covered by the
  // stable-set poll below, so this wait only proves the add landed.
  let after = null;
  await browser.waitUntil(async () => {
    after = await listAccounts();
    if (after?.__error) return false;
    const dialogHidden = await browser.execute(() =>
      document.getElementById('add-overlay')?.classList.contains('hidden') ?? true);
    return dialogHidden && after.accounts.length === beforeIds.length + count;
  }, {
    timeout: 10000,
    interval: 500,
    timeoutMsg: `App Center add of ${count} account(s) did not land`,
  });
  return after.accounts.map((account) => account.id).filter((id) => !beforeIds.includes(id));
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
  it('records the sample shape as the account count grows 2 -> 3 -> 5 via App Center adds', async () => {
    await waitForHostApi();

    const baseline = await waitForSeededGuest();
    assertSampleShape(baseline);
    const baselinePartitions = partitionNames(baseline);

    const before = await listAccounts();
    assert.ok(!before?.__error, `accounts list failed: ${before?.__error || ''}`);
    const beforeIds = before.accounts.map((account) => account.id);
    assert.ok(beforeIds.includes(SEEDED_A), 'seeded account-a must be listed');
    assert.ok(beforeIds.includes(SEEDED_B), 'seeded account-b must be listed');

    // 2 -> 3 accounts through the App Center UI (add + loadAccounts).
    const addedFirst = await addAccountsViaAppCenter({ name: 'E2E Memory', count: 1, beforeIds });
    assert.equal(addedFirst.length, 1, 'App Center add of 1 must yield exactly one new account id');
    const threeAccountSample = await takeSample();
    assertSampleShape(threeAccountSample);
    const threeAccountPartitions = partitionNames(threeAccountSample);

    // 3 -> 5 accounts through the App Center UI.
    const threeIds = [...beforeIds, ...addedFirst];
    const addedRest = await addAccountsViaAppCenter({ name: 'E2E Memory', count: 2, beforeIds: threeIds });
    assert.equal(addedRest.length, 2, 'App Center add of 2 must yield exactly two new account ids');

    const after = await listAccounts();
    assert.ok(!after?.__error, `accounts list failed: ${after?.__error || ''}`);
    assert.equal(after.accounts.length, before.accounts.length + 3, 'account count must grow by exactly the three added accounts');

    // 5-account add sample, then the stable-set poll for guest creation.
    const fiveAccountSample = await takeSample();
    assertSampleShape(fiveAccountSample);
    const fiveAccountPartitions = partitionNames(fiveAccountSample);

    const final = await waitForStablePartitionSet();
    assertSampleShape(final);
    const finalPartitions = partitionNames(final);

    const allIds = [...beforeIds, ...addedFirst, ...addedRest];
    const expectedPartitions = allIds.map((id) => `${PARTITION_PREFIX}${id}`);
    const matchedExpected = expectedPartitions.filter((name) => finalPartitions.includes(name));
    // The product model keeps every account's webview resident
    // (loadAccounts creates one per account), so after App Center adds and
    // a settle poll, every account's partition must be present. A missing
    // partition here is a real product signal, not a skeleton gap.
    assert.deepEqual(
      matchedExpected.slice().sort(),
      expectedPartitions.slice().sort(),
      `all account partitions must materialize after App Center adds; final set: ${finalPartitions.join(', ')}`,
    );

    console.log(`E2E_PARTITION_MEMORY_MULTI ${JSON.stringify({
      seededAccounts: [SEEDED_A, SEEDED_B],
      accountCount: after.accounts.length,
      addedVia: 'app-center-ui',
      baselinePartitions,
      threeAccountPartitions,
      fiveAccountPartitions,
      finalPartitions,
      matchedExpected,
      sample: final,
    })}`);
  });
});
