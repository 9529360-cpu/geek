'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const ACCOUNT_B = 'e2e-account-b';
const JOB_A = 'e2e-command-center-a';
const JOB_B = 'e2e-command-center-b';
const STEP_TIMEOUT = 4000;

async function waitVisible(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function activateAccount(accountId) {
  const target = await waitVisible(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await target.click();
  await browser.waitUntil(async () => browser.execute((id) =>
    document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `account ${accountId} did not become active`,
  });
}

async function cleanupJobs() {
  await browser.execute((jobIds) => {
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    for (const id of jobIds) {
      const job = manager.get(id);
      if (!job) continue;
      if (!['completed', 'stopped', 'failed'].includes(job.state)) {
        try { manager.transition(id, 'stopped'); } catch (_) {}
      }
      try { manager.dismiss(id); } catch (_) {}
    }
  }, [JOB_A, JOB_B]);
}

describe('Broadcast command center', () => {
  it('keeps current-account compatibility while exposing cross-account task awareness', async () => {
    await activateAccount(ACCOUNT_A);
    await browser.waitUntil(async () => browser.execute(() =>
      typeof window.GeekBroadcastJobs?.register === 'function'
      && typeof window.GeekBroadcastWorkbench?.summarizeJobs === 'function'
      && !!document.getElementById('broadcast-task-center-button')), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'broadcast command center did not become ready',
    });

    await browser.execute((accountA, accountB, jobA, jobB) => {
      const manager = window.GeekBroadcastJobs;
      for (const accountId of [accountA, accountB]) {
        for (const job of manager.list(accountId)) {
          if (!['completed', 'stopped', 'failed'].includes(job.state)) {
            try { manager.transition(job.id, 'stopped'); } catch (_) {}
          }
        }
      }
      manager.register({
        id: jobA,
        accountId: accountA,
        accountName: 'E2E Alpha',
        platformFamily: 'whatsapp',
        state: 'running',
        total: 10,
        current: 4,
        ok: 4,
        fail: 0,
      });
      manager.register({
        id: jobB,
        accountId: accountB,
        accountName: 'E2E Beta',
        platformFamily: 'whatsapp',
        state: 'scheduled',
        scheduledAt: Date.now() + 10 * 60 * 1000,
        total: 5,
        current: 0,
        ok: 0,
        fail: 0,
      });
    }, ACCOUNT_A, ACCOUNT_B, JOB_A, JOB_B);

    const trigger = await waitVisible('#broadcast-task-center-button');
    await browser.waitUntil(async () => (await trigger.getAttribute('data-active-count')) === '2', {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'aggregate active-job badge did not update',
    });
    await trigger.click();
    await waitVisible('#broadcast-task-center-overlay:not(.hidden)');

    const current = await browser.execute((jobA, jobB) => ({
      currentPressed: document.querySelector('[data-scope="current"]')?.getAttribute('aria-pressed'),
      allPressed: document.querySelector('[data-scope="all"]')?.getAttribute('aria-pressed'),
      visibleJobA: !!document.querySelector(`.bc-task-row[data-job-id="${jobA}"]`),
      visibleJobB: !!document.querySelector(`.bc-task-row[data-job-id="${jobB}"]`),
      active: document.querySelector('[data-summary="active"]')?.textContent || '',
      running: document.querySelector('[data-summary="running"]')?.textContent || '',
    }), JOB_A, JOB_B);
    assert.equal(current.currentPressed, 'true');
    assert.equal(current.allPressed, 'false');
    assert.equal(current.visibleJobA, true, 'current-account mode must show account A job');
    assert.equal(current.visibleJobB, false, 'current-account mode must not leak account B job into A view');
    assert.equal(current.active, '1');
    assert.equal(current.running, '1');

    await (await waitVisible('[data-scope="all"]')).click();
    await browser.waitUntil(async () => browser.execute((jobId) =>
      !!document.querySelector(`.bc-task-row[data-job-id="${jobId}"]`), JOB_B), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'all-account mode did not render account B job',
    });

    const all = await browser.execute((jobA, jobB) => {
      const rowA = document.querySelector(`.bc-task-row[data-job-id="${jobA}"]`);
      const rowB = document.querySelector(`.bc-task-row[data-job-id="${jobB}"]`);
      const progress = rowA?.querySelector('[role="progressbar"]');
      return {
        allPressed: document.querySelector('[data-scope="all"]')?.getAttribute('aria-pressed'),
        active: document.querySelector('[data-summary="active"]')?.textContent || '',
        running: document.querySelector('[data-summary="running"]')?.textContent || '',
        pending: document.querySelector('[data-summary="pending"]')?.textContent || '',
        accountA: rowA?.querySelector('.bc-task-account-name')?.textContent || '',
        accountB: rowB?.querySelector('.bc-task-account-name')?.textContent || '',
        progressNow: progress?.getAttribute('aria-valuenow') || '',
        progressMax: progress?.getAttribute('aria-valuemax') || '',
        bHasViewAction: !!rowB?.querySelector('.bc-task-view-account'),
      };
    }, JOB_A, JOB_B);
    assert.equal(all.allPressed, 'true');
    assert.equal(all.active, '2');
    assert.equal(all.running, '1');
    assert.equal(all.pending, '1');
    assert.match(all.accountA, /E2E Alpha/);
    assert.match(all.accountB, /E2E Beta/);
    assert.equal(all.progressNow, '4');
    assert.equal(all.progressMax, '10');
    assert.equal(all.bHasViewAction, true);

    await (await waitVisible(`.bc-task-row[data-job-id="${JOB_B}"] .bc-task-view-account`)).click();
    await browser.waitUntil(async () => browser.execute((id) =>
      document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, ACCOUNT_B), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'view-account action did not activate the owning account',
    });
    const closed = await browser.execute(() =>
      document.getElementById('broadcast-task-center-overlay')?.classList.contains('hidden'));
    assert.equal(closed, true, 'account navigation should close the command center and return to the workspace');

    await cleanupJobs();
  });
});
