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
    (async () => {
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

      await document.fonts.ready;

      const fontRuleSources = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
rules = Array.from(sheet.cssRules || []);
        } catch {
continue;
        }
        for (const rule of rules) {
if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
const family = String(rule.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '');
if (family !== 'Inter') continue;
const src = String(rule.style.getPropertyValue('src') || '');
const urlMatch = src.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
if (urlMatch?.[2]) {
  fontRuleSources.push(new URL(urlMatch[2], sheet.href || document.baseURI).href);
}
        }
      }

      const loadedFaces = await document.fonts.load('16px "Inter"', 'Geek');
      await new Promise(resolve => setTimeout(resolve, 100));
      const resources = performance.getEntriesByType('resource').map(entry => String(entry.name || ''));
      const fontResources = resources.filter(name => /InterVariable\.woff2(?:$|[?#])/i.test(name));
      window.removeEventListener('securitypolicyviolation', onViolation);
      script.remove();
      done({
        executed: window.__geekCspProbe === true,
        violations,
        googleResources: resources.filter(name => /fonts\.(?:googleapis|gstatic)\.com/i.test(name)),
        interAvailable: document.fonts.check('16px "Inter"'),
        fontRuleSources,
        loadedFaceCount: loadedFaces.length,
        loadedFaceStatuses: loadedFaces.map(face => String(face.status || '')),
        fontResources,
      });
    })().catch((error) => done({ probeError: String(error?.name || 'Error').slice(0, 80) }));
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

async function probeMalformedAccountPayloads() {
  return browser.executeAsync((done) => {
    (async () => {
      const before = await window.api.accounts.list();
      const results = [];
      for (const payload of [null, []]) {
        let message = '';
        try {
          await window.api.accounts.add(payload);
        } catch (error) {
          message = String(error?.message || error || '');
        }
        results.push({ rejected: message.includes('ACCOUNT_PAYLOAD_INVALID') });
      }
      const after = await window.api.accounts.list();
      done({
        rejected: results.every(item => item.rejected),
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


async function createWebsiteAccountsThroughAppCenter() {
  await (await waitVisible('#btn-app-center')).click();
  await waitVisible('#add-overlay:not(.hidden)');
  const websiteCard = await waitVisible('.add-platform-card[data-type="website"]');
  assert.match(await websiteCard.getText(), /自定义网站|网站/, 'App Center must expose the Website platform card');
  await websiteCard.click();

  const urlInput = await waitVisible('#add-custom-url');
  const nameInput = await waitVisible('#add-name');
  const countInput = await waitVisible('#add-count');
  await urlInput.setValue('http://example.com/not-allowed');
  await nameInput.setValue('E2E Website');
  await countInput.setValue('2');

  const before = await browser.executeAsync((done) => window.api.accounts.list().then(done).catch(error => done({ error: String(error?.message || error) })));
  await (await waitVisible('#add-confirm')).click();
  const status = await waitVisible('#add-status');
  assert.match(await status.getText(), /HTTPS/, 'invalid Website URL must be rejected inside the add dialog');
  const afterInvalid = await browser.executeAsync((done) => window.api.accounts.list().then(done).catch(error => done({ error: String(error?.message || error) })));
  assert.deepEqual(afterInvalid.accounts.map(account => account.id), before.accounts.map(account => account.id), 'invalid Website URL must not create an account');

  await urlInput.setValue('https://example.com/app');
  await (await waitVisible('#add-confirm')).click();
  await waitHidden('#add-overlay', 10_000);

  await browser.waitUntil(async () => browser.executeAsync((done) => {
    window.api.accounts.list().then((state) => done(state.accounts.filter(account => account.type === 'website').length === 2)).catch(() => done(false));
  }), { timeout: 10_000, timeoutMsg: 'Website accounts were not created through App Center' });

  const state = await browser.executeAsync((done) => window.api.accounts.list().then(done).catch(error => done({ error: String(error?.message || error) })));
  const websites = state.accounts.filter(account => account.type === 'website');
  assert.equal(websites.length, 2);
  assert.deepEqual(websites.map(account => account.name), ['E2E Website 1', 'E2E Website 2']);
  assert.ok(websites.every(account => account.customUrl === 'https://example.com/app'), 'Website customUrl must persist on both instances');
  assert.notEqual(websites[0].id, websites[1].id, 'same Website URL must create different account ids');
  assert.notEqual(websites[0].partition, websites[1].partition, 'same Website URL must create different persistent partitions');
  assert.ok(websites.every(account => account.partition === `persist:webview-page-${account.id}`));

  const ui = await browser.execute((ids) => {
    const tabs = Array.from(document.querySelectorAll('.tab-item')).map(el => ({ platform: el.dataset.platform, title: el.title }));
    const rows = ids.map((id) => {
      const wv = Array.from(document.querySelectorAll('webview')).find(item => item.partition === `persist:webview-page-${id}`);
      return wv ? {
        id,
        src: wv.getAttribute('src') || wv.src || '',
        partition: wv.getAttribute('partition') || wv.partition || '',
        preload: wv.getAttribute('preload'),
        allowpopups: wv.hasAttribute('allowpopups'),
      } : { id, missing: true };
    });
    return {
      tabs,
      rows,
      activePlatform: document.querySelector('.tab-item.active')?.dataset.platform || '',
      broadcastHidden: document.getElementById('btn-broadcast')?.classList.contains('hidden') === true,
      translationHidden: document.getElementById('btn-translation')?.classList.contains('hidden') === true,
      notesHidden: document.getElementById('btn-contact-notes')?.classList.contains('hidden') === true,
    };
  }, websites.map(account => account.id));

  assert.ok(ui.tabs.some(tab => tab.platform === 'website' && tab.title === '网站'), 'Website must render as its own platform family');
  assert.equal(ui.activePlatform, 'website');
  assert.equal(ui.broadcastHidden, true, 'Website must hide broadcast capability');
  assert.equal(ui.translationHidden, true, 'Website must hide translation capability');
  assert.equal(ui.notesHidden, true, 'Website must hide contact-note capability');
  for (const row of ui.rows) {
    assert.equal(row.missing, undefined, `Website webview missing for ${row.id}`);
    assert.equal(row.src, 'https://example.com/app');
    assert.equal(row.partition, `persist:webview-page-${row.id}`);
    assert.equal(row.preload, null, 'Website renderer must not attach Geek preload');
    assert.equal(row.allowpopups, false, 'Website renderer must not opt into popups');
  }

  const guestState = await browser.electron.execute((electron, partitions) => {
    const guests = electron.webContents.getAllWebContents().filter(contents => partitions.includes(String(contents.session?.partition || '')));
    return guests.map(contents => ({ partition: String(contents.session?.partition || ''), destroyed: contents.isDestroyed() }));
  }, websites.map(account => account.partition));
  assert.equal(new Set(guestState.filter(item => !item.destroyed).map(item => item.partition)).size, 2, 'real Electron guests must exist in two independent Website sessions');

  console.log(`E2E_WEBSITE created=${websites.length} partitions=${new Set(websites.map(account => account.partition)).size} noPreload=${ui.rows.every(row => row.preload === null)} enhancementsHidden=${ui.broadcastHidden && ui.translationHidden && ui.notesHidden}`);
  await heartbeat('website-app-center');


// All specs intentionally share one isolated synthetic userData directory.
// Restore the original fixture after this mutation-heavy smoke so the
// unrelated broadcast specs start from their documented two-account state.
const cleanup = await browser.executeAsync((ids, fallbackId, done) => {
  (async () => {
    for (const id of ids) await window.api.accounts.remove(id);
    await window.api.accounts.switch(fallbackId);
    const state = await window.api.accounts.list();
    done({
      ids: state.accounts.map(account => account.id),
      activeAccountId: state.activeAccountId,
      websiteCount: state.accounts.filter(account => account.type === 'website').length,
    });
  })().catch((error) => done({ error: String(error?.message || error || 'cleanup failed') }));
}, websites.map(account => account.id), ACCOUNT_A);
assert.equal(cleanup.error, undefined, `Website cleanup failed: ${cleanup.error || ''}`);
assert.deepEqual(cleanup.ids, [ACCOUNT_A, ACCOUNT_B], 'Website E2E cleanup must restore the shared synthetic fixture');
assert.equal(cleanup.activeAccountId, ACCOUNT_A);
assert.equal(cleanup.websiteCount, 0);
await heartbeat('website-cleanup');
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
  console.log(`E2E_MAIN_CSP blocked=${cspProbe.executed !== true} violations=${cspProbe.violations?.length || 0} google=${cspProbe.googleResources?.length || 0} rules=${cspProbe.fontRuleSources?.length || 0} loadedFaces=${cspProbe.loadedFaceCount || 0} resourceEntries=${cspProbe.fontResources?.length || 0}`);
  assert.equal(cspProbe.probeError, undefined, `main renderer CSP/font probe failed: ${cspProbe.probeError || 'unknown'}`);
  assert.equal(cspProbe.executed, false, 'main renderer CSP must block a data: script probe');
  assert.ok(cspProbe.violations.some(item => item.effectiveDirective.startsWith('script-src') && item.blockedURI === 'data'), 'main renderer must report the data: script as a script-src CSP violation');
  assert.deepEqual(cspProbe.googleResources, [], 'main renderer must not request Google Fonts resources');
  assert.equal(cspProbe.interAvailable, true, 'Inter must be available after document.fonts.ready');
assert.ok(cspProbe.fontRuleSources.length >= 1, 'main renderer must register an Inter @font-face rule');
assert.ok(cspProbe.fontRuleSources.every(name => /^file:\/\//i.test(name) && /\/ui\/fonts\/InterVariable\.woff2(?:$|[?#])/i.test(name)), `Inter @font-face must resolve to local ui/fonts bytes: ${JSON.stringify(cspProbe.fontRuleSources)}`);
assert.ok(cspProbe.loadedFaceCount >= 1, 'document.fonts.load must resolve at least one CSS-backed Inter FontFace');
assert.ok(cspProbe.loadedFaceStatuses.every(status => status === 'loaded'), `matched Inter FontFace must be loaded: ${JSON.stringify(cspProbe.loadedFaceStatuses)}`);
assert.ok(cspProbe.fontResources.every(name => /^file:\/\//i.test(name) && /\/ui\/fonts\/InterVariable\.woff2(?:$|[?#])/i.test(name)), `any reported Inter resource must remain local: ${JSON.stringify(cspProbe.fontResources)}`);

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

    const malformedPayloadProbe = await probeMalformedAccountPayloads();
    console.log(`E2E_ACCOUNT_PAYLOAD rejected=${malformedPayloadProbe.rejected === true} stateUnchanged=${JSON.stringify(malformedPayloadProbe.beforeIds) === JSON.stringify(malformedPayloadProbe.afterIds) && malformedPayloadProbe.beforeActive === malformedPayloadProbe.afterActive}`);
    assert.equal(malformedPayloadProbe.rejected, true, `real accounts:add did not reject malformed payloads: ${malformedPayloadProbe.probeError || 'unknown'}`);
    assert.deepEqual(malformedPayloadProbe.afterIds, malformedPayloadProbe.beforeIds, 'malformed account payload must not create or remove account state');
    assert.equal(malformedPayloadProbe.afterActive, malformedPayloadProbe.beforeActive, 'malformed account payload must not switch active account state');

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

    await createWebsiteAccountsThroughAppCenter();
  });
});
