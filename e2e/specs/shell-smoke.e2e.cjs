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

async function probeMainRendererCspAndFont() {
  return browser.executeAsync((done) => {
    const violations = [];
    const onViolation = (event) => {
      violations.push({
        effectiveDirective: String(event.effectiveDirective || ''),
        blockedURI: String(event.blockedURI || ''),
      });
    };
    window.addEventListener('securitypolicyviolation', onViolation);
    window.__geekCspProbe = false;
    const script = document.createElement('script');
    script.src = 'data:text/javascript,window.__geekCspProbe%20%3D%20true';
    document.head.appendChild(script);

    document.fonts.ready.then(() => {
      setTimeout(() => {
        const resources = performance.getEntriesByType('resource').map(entry => String(entry.name || ''));
        const fontResources = resources.filter(name => /InterVariable\.woff2(?:$|[?#])/i.test(name));
        window.removeEventListener('securitypolicyviolation', onViolation);
        script.remove();
        done({
executed: window.__geekCspProbe === true,
violations,
googleResources: resources.filter(name => /fonts\.(?:googleapis|gstatic)\.com/i.test(name)),
interAvailable: document.fonts.check('16px "Inter"'),
fontResources,
        });
      }, 100);
    }).catch((error) => done({ probeError: String(error?.name || 'Error').slice(0, 80) }));
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

async function probeSafeStorage() {
  return browser.electron.execute((electron) => {
    let backend = 'not-linux';
    let roundTrip = false;
    let errorName = '';
    try {
      if (process.platform === 'linux') backend = electron.safeStorage.getSelectedStorageBackend();
      const encrypted = electron.safeStorage.encryptString('geek-e2e-probe');
      roundTrip = electron.safeStorage.decryptString(encrypted) === 'geek-e2e-probe';
    } catch (error) {
      errorName = String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'Error';
    }
    return {
      platform: process.platform,
      available: electron.safeStorage.isEncryptionAvailable(),
      backend,
      roundTrip,
      errorName,
    };
  });
}

async function probeAccountData(accountId) {
  return browser.executeAsync((id, done) => {
    const knownCodes = [
      'SECURE_STORAGE_UNAVAILABLE',
      'SECURE_STORAGE_ENCRYPT_FAILED',
      'ACCOUNT_DATA_ACCOUNT_INVALID',
      'ACCOUNT_DATA_ACCOUNT_STATE_UNAVAILABLE',
      'ACCOUNT_DATA_ACCOUNT_MISSING',
      'ACCOUNT_DATA_PARTITION_MISMATCH',
      'ACCOUNT_DATA_SENDER_INVALID',
      'ACCOUNT_DATA_LOG_CORRUPT',
      'ACCOUNT_DATA_RECORD_TOO_LARGE',
    ];
    window.api.accountData.getAll(id).then((value) => {
      done({
        ok: true,
        keyCount: value && typeof value === 'object' ? Object.keys(value).length : -1,
        hasSchema: value?.__schema === '1',
      });
    }).catch((error) => {
      const message = String(error?.message || error || '');
      done({
        ok: false,
        code: knownCodes.find(code => message.includes(code)) || String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'Error',
      });
    });
  }, accountId);
}

async function probeRejectedAccountType() {
  return browser.executeAsync((done) => {
    (async () => {
      const before = await window.api.accounts.list();
      let message = '';
      try {
        await window.api.accounts.add({ name: 'E2E invalid type', type: 'telegrm' });
      } catch (error) {
        message = String(error?.message || error || '');
      }
      const after = await window.api.accounts.list();
      done({
        rejected: message.includes('ACCOUNT_TYPE_UNSUPPORTED'),
        beforeIds: Array.isArray(before?.accounts) ? before.accounts.map(account => account.id) : [],
        afterIds: Array.isArray(after?.accounts) ? after.accounts.map(account => account.id) : [],
        beforeActive: String(before?.activeAccountId || ''),
        afterActive: String(after?.activeAccountId || ''),
      });
    })().catch((error) => done({ rejected: false, probeError: String(error?.name || 'Error').slice(0, 80) }));
  });
}

async function activationSnapshot(accountId) {
  return browser.executeAsync((id, done) => {
    const target = document.querySelector(`.nav-account[data-id="${id}"] .nav-account-main`);
    const domActive = document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
    window.api.accounts.list().then((result) => {
      const backendActive = result?.activeAccountId || '';
      done({
        domState: domActive === id ? 'target' : domActive ? 'other' : 'none',
        backendState: backendActive === id ? 'target' : backendActive ? 'other' : 'none',
        targetConnected: target?.isConnected === true,
        targetHandler: typeof target?.onclick === 'function',
      });
    }).catch(() => done({
      domState: domActive === id ? 'target' : domActive ? 'other' : 'none',
      backendState: 'list-error',
      targetConnected: target?.isConnected === true,
      targetHandler: typeof target?.onclick === 'function',
    }));
  }, accountId);
}

async function activateAccount(accountId) {
  const button = await waitVisible(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await button.click();
  try {
    await browser.waitUntil(async () => browser.execute((id) =>
      document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: `account ${accountId} did not become active`,
    });
  } catch (error) {
    const snapshot = await activationSnapshot(accountId);
    throw new Error(`account activation failed dom=${snapshot.domState} backend=${snapshot.backendState} connected=${snapshot.targetConnected} handler=${snapshot.targetHandler}`);
  }
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
    const hostContentSize = await browser.electron.execute((electron) => {
      const windows = electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
      const hostWindow = electron.BrowserWindow.getFocusedWindow() || windows[0];
      if (!hostWindow) return null;
      hostWindow.setContentSize(1280, 820);
      return hostWindow.getContentSize();
    });
    assert.deepEqual(hostContentSize, [1280, 820], 'Geek host BrowserWindow did not accept the E2E content viewport size');

    await browser.waitUntil(async () => browser.execute(() => document.readyState === 'complete' && !!document.body), {
      timeout: 10_000,
      timeoutMsg: 'Geek main renderer did not load',
    });
    await installErrorWatch();

  const cspProbe = await probeMainRendererCspAndFont();
  console.log(`E2E_MAIN_CSP blocked=${cspProbe.executed !== true} violations=${cspProbe.violations?.length || 0} google=${cspProbe.googleResources?.length || 0} localFonts=${cspProbe.fontResources?.length || 0}`);
  assert.equal(cspProbe.probeError, undefined, `main renderer CSP/font probe failed: ${cspProbe.probeError || 'unknown'}`);
  assert.equal(cspProbe.executed, false, 'main renderer CSP must block a data: script probe');
  assert.ok(cspProbe.violations.some(item => item.effectiveDirective.startsWith('script-src') && item.blockedURI === 'data'), 'main renderer must report the data: script as a script-src CSP violation');
  assert.deepEqual(cspProbe.googleResources, [], 'main renderer must not request Google Fonts resources');
  assert.equal(cspProbe.interAvailable, true, 'Inter must be available after document.fonts.ready');
  assert.ok(cspProbe.fontResources.length >= 1, 'Inter availability must be backed by an actual WOFF2 resource load');
  assert.ok(cspProbe.fontResources.every(name => /^file:\/\//i.test(name) && /\/ui\/fonts\/InterVariable\.woff2(?:$|[?#])/i.test(name)), `Inter must load from packaged local ui/fonts bytes: ${JSON.stringify(cspProbe.fontResources)}`);

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

    const storageProbe = await probeSafeStorage();
    console.log(`E2E_SAFE_STORAGE platform=${storageProbe.platform} available=${storageProbe.available} backend=${storageProbe.backend} roundTrip=${storageProbe.roundTrip} error=${storageProbe.errorName || 'none'}`);
    assert.equal(storageProbe.available, true, 'hosted Electron safeStorage must be available');
    assert.notEqual(storageProbe.backend, 'basic_text', 'hosted Linux E2E must not fall back to basic_text safeStorage');
    assert.equal(storageProbe.roundTrip, true, `hosted Electron safeStorage round trip failed: ${storageProbe.errorName || 'unknown'}`);

    const accountDataProbe = await probeAccountData(ACCOUNT_B);
    console.log(`E2E_ACCOUNT_DATA getAll=${accountDataProbe.ok ? 'ok' : accountDataProbe.code} keyCount=${accountDataProbe.keyCount ?? -1} hasSchema=${accountDataProbe.hasSchema === true}`);
    assert.equal(accountDataProbe.ok, true, `accountData.getAll failed: ${accountDataProbe.code || 'unknown'}`);

    const rejectedTypeProbe = await probeRejectedAccountType();
    console.log(`E2E_ACCOUNT_TYPE rejected=${rejectedTypeProbe.rejected === true} stateUnchanged=${JSON.stringify(rejectedTypeProbe.beforeIds) === JSON.stringify(rejectedTypeProbe.afterIds) && rejectedTypeProbe.beforeActive === rejectedTypeProbe.afterActive}`);
    assert.equal(rejectedTypeProbe.rejected, true, `real accounts:add did not reject explicit unknown type: ${rejectedTypeProbe.probeError || 'unknown'}`);
    assert.deepEqual(rejectedTypeProbe.afterIds, rejectedTypeProbe.beforeIds, 'rejected account type must not create or remove account state');
    assert.equal(rejectedTypeProbe.afterActive, rejectedTypeProbe.beforeActive, 'rejected account type must not switch active account state');

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
