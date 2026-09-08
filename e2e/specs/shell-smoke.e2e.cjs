'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const ACCOUNT_B = 'e2e-account-b';
const STEP_TIMEOUT = 3000;

async function waitVisible(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function waitHidden(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await browser.waitUntil(async () => !(await element.isDisplayed()), {
    timeout,
    timeoutMsg: `${selector} remained visible`,
  });
}

async function installErrorWatch() {
  await browser.execute(() => {
    if (window.__geekE2EErrorWatchInstalled) return;
    window.__geekE2EErrorWatchInstalled = true;
    window.__geekE2EErrors = [];
    window.addEventListener('error', (event) => {
      window.__geekE2EErrors.push({ kind: 'error', name: String(event.error?.name || 'Error').slice(0, 80) });
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.__geekE2EErrors.push({ kind: 'unhandledrejection', name: String(event.reason?.name || 'Error').slice(0, 80) });
    });
  });
}

async function heartbeat(label) {
  await browser.setTimeout({ script: 2500 });
  const result = await browser.executeAsync((done) => {
    setTimeout(() => done({ ready: document.readyState, body: !!document.body }), 0);
  });
  assert.equal(result?.body, true, `${label}: renderer body disappeared`);
  assert.notEqual(result?.ready, 'loading', `${label}: renderer never became ready`);

  const errors = await browser.execute(() => Array.isArray(window.__geekE2EErrors) ? window.__geekE2EErrors.slice() : []);
  assert.deepEqual(errors, [], `${label}: uncaught renderer application error`);

  const processState = await browser.electron.execute((electron) => ({
    windowCount: electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).length,
    focusedDestroyed: electron.BrowserWindow.getFocusedWindow()?.isDestroyed() ?? false,
  }));
  assert.ok(processState.windowCount >= 1, `${label}: application window was destroyed`);
  assert.equal(processState.focusedDestroyed, false, `${label}: focused window was destroyed`);
}

async function activateAccount(accountId) {
  const button = await waitVisible(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await button.click();
  await browser.waitUntil(async () => browser.execute((id) =>
    document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `account ${accountId} did not become active`,
  });
}

async function rightClick(element) {
  await browser.action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ origin: element })
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
}

async function openAndCloseAccountSettings(iteration) {
  await activateAccount(ACCOUNT_A);
  const target = await waitVisible(`.nav-account[data-id="${ACCOUNT_B}"]`);
  await rightClick(target);
  await waitVisible('#ctx-menu:not(.hidden)');
  const contextTarget = await browser.execute(() => document.getElementById('ctx-menu')?.dataset.accountId || '');
  assert.equal(contextTarget, ACCOUNT_B, `context menu iteration ${iteration} bound the wrong account`);

  await (await waitVisible('#ctx-menu [data-act="edit"]')).click();
  await waitVisible('#account-settings-overlay:not(.hidden)');
  const label = await $('#account-settings-target');
  assert.match(await label.getText(), /E2E Beta/, `settings iteration ${iteration} opened the wrong account`);
  await heartbeat(`account-settings-open-${iteration}`);

  await (await waitVisible('#account-settings-close')).click();
  await waitHidden('#account-settings-overlay');
  await heartbeat(`account-settings-close-${iteration}`);
}

async function openAndCloseBroadcast(iteration) {
  await (await waitVisible('#btn-broadcast')).click();
  await waitVisible('#broadcast-menu:not(.hidden)');
  await (await waitVisible('#bc-menu-send')).click();
  await waitVisible('#broadcast-overlay:not(.hidden)');
  const message = await waitVisible('#broadcast-message');
  await message.click();
  await heartbeat(`broadcast-open-${iteration}`);
  await (await waitVisible('#broadcast-close')).click();
  await waitHidden('#broadcast-overlay');
  await heartbeat(`broadcast-close-${iteration}`);
}

describe('Geek Electron shell smoke', () => {
  it('launches the real Electron entry and keeps core UI interactions responsive', async () => {
    await browser.setWindowSize(1280, 820);
    await browser.waitUntil(async () => browser.execute(() => document.readyState === 'complete' && !!document.body), {
      timeout: 10_000,
      timeoutMsg: 'Geek main renderer did not load',
    });
    await installErrorWatch();

    const appInfo = await browser.electron.execute((electron) => ({
      name: electron.app.getName(),
      packaged: electron.app.isPackaged,
      windows: electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).length,
    }));
    assert.equal(appInfo.packaged, false, 'E2E must exercise the unpackaged development Electron runtime');
    assert.ok(appInfo.windows >= 1, 'Electron launched without a usable window');
    const bodyText = await (await $('body')).getText();
    assert.ok(bodyText.trim(), 'main page rendered blank');
    await heartbeat('startup');

    const accounts = await $$('.nav-account');
    assert.equal(accounts.length, 2, 'isolated fixture must render exactly two fake accounts');
    await activateAccount(ACCOUNT_A);
    await heartbeat('account-a');
    await activateAccount(ACCOUNT_B);
    await heartbeat('account-b');
    await activateAccount(ACCOUNT_A);
    await heartbeat('account-a-return');

    for (let iteration = 1; iteration <= 3; iteration += 1) {
      await openAndCloseAccountSettings(iteration);
    }

    for (let iteration = 1; iteration <= 3; iteration += 1) {
      await openAndCloseBroadcast(iteration);
    }
  });
});
