'use strict';

const assert = require('node:assert/strict');

const WHATSAPP_ACCOUNT_ID = 'e2e-account-a';
const WHATSAPP_PARTITION = `persist:webview-page-${WHATSAPP_ACCOUNT_ID}`;
const WHATSAPP_STORAGE_LEAF = `webview-page-${WHATSAPP_ACCOUNT_ID}`;
const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';
const TELEGRAM_TARGET = 'https://web.telegram.org/a';
const WEBSITE_A_URL = 'https://example.com/';
const WEBSITE_A_CONTROL_URL = 'https://example.com/navigation-control';
const WEBSITE_B_URL = 'https://example.org/';
const RUNTIME_TIMEOUT = 15_000;
const UI_TIMEOUT = 10_000;

let websiteFixtureIds = [];

function diagnostic(state) {
  return [
    `category=${state?.category || 'UNKNOWN'}`,
    `partition=${state?.partition || 'none'}`,
    `storageLeaf=${state?.storageLeaf || 'none'}`,
    `origin=${state?.origin || 'none'}`,
    `hostname=${state?.hostname || 'none'}`,
    `type=${state?.type || 'none'}`,
    `destroyed=${state?.destroyed === true}`,
    `id=${Number(state?.webContentsId) || 0}`,
  ].join(' ');
}

async function waitVisible(selector, timeout = UI_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function waitHidden(selector, timeout = UI_TIMEOUT) {
  const element = await $(selector);
  await browser.waitUntil(async () => !(await element.isDisplayed()), {
    timeout,
    interval: 100,
    timeoutMsg: `${selector} remained visible`,
  });
}

async function waitForHostApi() {
  await browser.waitUntil(async () => browser.execute(() =>
    document.readyState === 'complete' && !!window.api?.accounts), {
    timeout: UI_TIMEOUT,
    interval: 100,
    timeoutMsg: 'Geek main renderer did not expose the account API',
  });
}

async function readAccount(accountId) {
  return browser.executeAsync((id, done) => {
    const clean = (value) => String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    window.api.accounts.list().then((state) => {
      const account = Array.isArray(state?.accounts)
        ? state.accounts.find(item => item?.id === id)
        : null;
      done(account ? {
        found: true,
        id: String(account.id || ''),
        type: String(account.type || ''),
        partition: String(account.partition || ''),
        customOrigin: account.customUrl ? new URL(account.customUrl).origin : '',
      } : { found: false, errorCategory: 'ACCOUNT_NOT_FOUND' });
    }).catch((error) => done({
      found: false,
      errorCategory: clean(error?.name) || 'Error',
    }));
  }, accountId);
}

async function createWebsiteThroughAppCenter(name, customUrl) {
  const before = await browser.executeAsync((done) => {
    window.api.accounts.list().then((state) => done({
      ids: (state.accounts || []).map(account => String(account.id || '')),
    })).catch(() => done({ ids: [] }));
  });
  const beforeIds = new Set(before.ids);

  await (await waitVisible('#btn-app-center')).click();
  await waitVisible('#add-overlay:not(.hidden)');
  await (await waitVisible('.add-platform-card[data-type="website"]')).click();
  await (await waitVisible('#add-custom-url')).setValue(customUrl);
  await (await waitVisible('#add-name')).setValue(name);
  await (await waitVisible('#add-count')).setValue('1');
  await (await waitVisible('#add-confirm')).click();
  await waitHidden('#add-overlay');

  let created = null;
  await browser.waitUntil(async () => {
    const state = await browser.executeAsync((done) => {
      window.api.accounts.list().then((value) => done({
        accounts: (value.accounts || []).map(account => ({
          id: String(account.id || ''),
          name: String(account.name || ''),
          type: String(account.type || ''),
          partition: String(account.partition || ''),
          customOrigin: account.customUrl ? new URL(account.customUrl).origin : '',
        })),
      })).catch(() => done({ accounts: [] }));
    });
    const candidates = state.accounts.filter(account => account.type === 'website' && !beforeIds.has(account.id));
    if (candidates.length !== 1) return false;
    created = candidates[0];
    const host = await hostWebviewIdForPartition(created.partition);
    return host.count === 1 && host.webContentsId > 0;
  }, {
    timeout: UI_TIMEOUT,
    interval: 150,
    timeoutMsg: `Renderer did not materialize the temporary Website guest for ${name}`,
  });

  assert.ok(created, `temporary Website account missing for ${name}`);
  assert.equal(created.partition, `persist:webview-page-${created.id}`);
  return created;
}

async function createWebsiteFixtures() {
  const websiteA = await createWebsiteThroughAppCenter('E2E Navigation Website A', WEBSITE_A_URL);
  websiteFixtureIds.push(websiteA.id);
  const websiteB = await createWebsiteThroughAppCenter('E2E Navigation Website B', WEBSITE_B_URL);
  websiteFixtureIds.push(websiteB.id);

  assert.equal(websiteA.customOrigin, 'https://example.com');
  assert.equal(websiteB.customOrigin, 'https://example.org');
  assert.notEqual(websiteA.id, websiteB.id, 'Website fixtures must have different account owners');
  assert.notEqual(websiteA.partition, websiteB.partition, 'Website fixtures must use different persistent Sessions');
  return { websiteA, websiteB };
}

async function hostWebviewIdForPartition(partition) {
  return browser.execute((expectedPartition) => {
    const matches = Array.from(document.querySelectorAll('webview'))
      .filter(webview => String(webview.getAttribute('partition') || webview.partition || '') === expectedPartition);
    if (matches.length !== 1) return { count: matches.length, webContentsId: 0 };
    try {
      return { count: 1, webContentsId: Number(matches[0].getWebContentsId()) || 0 };
    } catch {
      return { count: 1, webContentsId: 0 };
    }
  }, partition);
}

async function waitForGuest(account, expectedOrigin) {
  const expectedStorageLeaf = String(account.partition || '').replace(/^persist:/, '');
  let lastState = {
    category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND',
    partition: account.partition,
    storageLeaf: '',
    origin: '',
    hostname: '',
    type: '',
    destroyed: false,
    webContentsId: 0,
  };

  try {
    await browser.waitUntil(async () => {
      const host = await hostWebviewIdForPartition(account.partition);
      if (host.count !== 1 || !host.webContentsId) {
        lastState.category = host.count > 1 ? 'ACCOUNT_WEBCONTENTS_AMBIGUOUS' : 'ACCOUNT_WEBCONTENTS_NOT_FOUND';
        return false;
      }

      lastState = await browser.electron.execute((electron, webContentsId, expectedPartition, storageLeaf, origin) => {
        const target = electron.webContents.getAllWebContents().find(contents => contents.id === webContentsId);
        if (!target) return {
          category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND', partition: expectedPartition, storageLeaf: '', origin: '', hostname: '', type: '', destroyed: false, webContentsId: 0,
        };
        const destroyed = target.isDestroyed() === true;
        if (destroyed) return {
          category: 'ACCOUNT_WEBCONTENTS_DESTROYED', partition: expectedPartition, storageLeaf: '', origin: '', hostname: '', type: '', destroyed: true, webContentsId,
        };

        const partition = String(target.session?.partition || '');
        let storagePath = '';
        try {
          if (typeof target.session?.storagePath === 'string') storagePath = target.session.storagePath;
          else if (typeof target.session?.getStoragePath === 'function') storagePath = target.session.getStoragePath() || '';
        } catch {}
        const actualStorageLeaf = String(storagePath).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || '';
        const type = String(target.getType?.() || '');
        let actualOrigin = '';
        let hostname = '';
        try {
          const current = new URL(target.getURL());
          actualOrigin = current.origin;
          hostname = current.hostname;
        } catch {}

        let category = 'READY';
        if (partition !== expectedPartition) category = 'PARTITION_MISMATCH';
        else if (actualStorageLeaf !== storageLeaf) category = 'STORAGE_PATH_MISMATCH';
        else if (type !== 'webview') category = 'ACCOUNT_WEBCONTENTS_NOT_GUEST';
        else if (actualOrigin !== origin) category = 'ORIGIN_MISMATCH';
        return { category, partition, storageLeaf: actualStorageLeaf, origin: actualOrigin, hostname, type, destroyed: false, webContentsId };
      }, host.webContentsId, account.partition, expectedStorageLeaf, expectedOrigin);

      return lastState.category === 'READY';
    }, {
      timeout: RUNTIME_TIMEOUT,
      interval: 150,
      timeoutMsg: `Guest did not become ready for synthetic account ${account.id}`,
    });
  } catch {
    throw new Error(`guest readiness failed ${diagnostic(lastState)}`);
  }
  return lastState;
}

async function observePageNavigation(guest, targetUrl, expectedStartOrigin, requireCompletion) {
  return browser.electron.execute(async (electron, webContentsId, target, startOrigin, shouldComplete) => {
    const contents = electron.webContents.getAllWebContents().find(item => item.id === webContentsId);
    if (!contents || contents.isDestroyed()) return { category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND' };

    const sanitize = (value) => {
      try {
        const parsed = new URL(String(value || ''));
        return { origin: parsed.origin, hostname: parsed.hostname };
      } catch {
        return { origin: '', hostname: '' };
      }
    };
    const beforeWindowIds = electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).map(win => win.id).sort((a, b) => a - b);
    const observed = { willNavigate: false, targetOrigin: '', targetHostname: '', mainFrame: false, didNavigate: false, didOrigin: '', didHostname: '' };

    let finishWillNavigate;
    const willNavigate = new Promise(resolve => { finishWillNavigate = resolve; });
    let finishDidNavigate;
    const didNavigate = new Promise(resolve => { finishDidNavigate = resolve; });

    const onWillNavigate = (details, deprecatedUrl, _isInPlace, deprecatedIsMainFrame) => {
      const destination = sanitize(typeof details?.url === 'string' ? details.url : deprecatedUrl);
      observed.willNavigate = true;
      observed.targetOrigin = destination.origin;
      observed.targetHostname = destination.hostname;
      observed.mainFrame = typeof details?.isMainFrame === 'boolean' ? details.isMainFrame : deprecatedIsMainFrame === true;
      finishWillNavigate(true);
    };
    const onDidNavigate = (_event, url) => {
      const destination = sanitize(url);
      observed.didNavigate = true;
      observed.didOrigin = destination.origin;
      observed.didHostname = destination.hostname;
      finishDidNavigate(true);
    };

    contents.once('will-navigate', onWillNavigate);
    contents.once('did-navigate', onDidNavigate);
    try {
      await contents.executeJavaScript(`location.assign(${JSON.stringify(target)}); true`);
    } catch {}

    const willObserved = await Promise.race([
      willNavigate,
      new Promise(resolve => setTimeout(() => resolve(false), 3000)),
    ]);
    if (willObserved) {
      await Promise.race([
        didNavigate,
        new Promise(resolve => setTimeout(() => resolve(false), shouldComplete ? 8000 : 2500)),
      ]);
    }

    contents.removeListener('will-navigate', onWillNavigate);
    contents.removeListener('did-navigate', onDidNavigate);

    const afterWindowIds = electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed()).map(win => win.id).sort((a, b) => a - b);
    const sameContents = electron.webContents.getAllWebContents().find(item => item.id === webContentsId);
    const destroyed = !sameContents || sameContents.isDestroyed() === true;
    const partition = destroyed ? '' : String(sameContents.session?.partition || '');
    let storagePath = '';
    try {
      if (!destroyed && typeof sameContents.session?.storagePath === 'string') storagePath = sameContents.session.storagePath;
      else if (!destroyed && typeof sameContents.session?.getStoragePath === 'function') storagePath = sameContents.session.getStoragePath() || '';
    } catch {}
    const storageLeaf = String(storagePath).replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || '';
    const type = destroyed ? '' : String(sameContents.getType?.() || '');
    const current = destroyed ? { origin: '', hostname: '' } : sanitize(sameContents.getURL());

    return {
      category: willObserved ? 'NAVIGATION_ATTEMPT_OBSERVED' : 'WILL_NAVIGATE_NOT_OBSERVED',
      ...observed,
      partition,
      storageLeaf,
      origin: current.origin,
      hostname: current.hostname,
      type,
      destroyed,
      webContentsId,
      sameStartOrigin: current.origin === startOrigin,
      beforeWindowIds,
      afterWindowIds,
    };
  }, guest.webContentsId, targetUrl, expectedStartOrigin, requireCompletion === true);
}

async function assertHostStillBound(partition, webContentsId) {
  const host = await hostWebviewIdForPartition(partition);
  assert.equal(host.count, 1, `host must retain one WebView for ${partition}`);
  assert.equal(host.webContentsId, webContentsId, 'host WebView must remain bound to the exact original guest WebContents');
}

async function cleanupWebsiteFixtures() {
  if (!websiteFixtureIds.length) return;
  const ids = websiteFixtureIds.slice();
  websiteFixtureIds = [];
  const result = await browser.executeAsync((accountIds, fallbackId, done) => {
    const clean = (value) => String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    (async () => {
      for (const id of accountIds) await window.api.accounts.remove(id);
      await window.api.accounts.switch(fallbackId);
      const state = await window.api.accounts.list();
      done({
        ok: true,
        ids: (state.accounts || []).map(account => String(account.id || '')),
        websiteCount: (state.accounts || []).filter(account => account.type === 'website').length,
        activeAccountId: String(state.activeAccountId || ''),
      });
    })().catch((error) => done({ ok: false, errorCategory: clean(error?.name) || 'Error' }));
  }, ids, WHATSAPP_ACCOUNT_ID);
  assert.equal(result.ok, true, `Website fixture cleanup failed: ${result.errorCategory || 'Error'}`);
  assert.deepEqual(result.ids, ['e2e-account-a', 'e2e-account-b'], 'navigation runtime cleanup must restore the original two-account fixture');
  assert.equal(result.websiteCount, 0, 'temporary Website accounts must be removed');
  assert.equal(result.activeAccountId, WHATSAPP_ACCOUNT_ID, 'cleanup must restore the original active synthetic account');
}

describe('Geek account-scoped WebView navigation runtime', () => {
  after(async () => {
    await cleanupWebsiteFixtures();
  });

  it('blocks WhatsApp guest page navigation into Telegram without changing owner Session', async () => {
    await waitForHostApi();
    const account = await readAccount(WHATSAPP_ACCOUNT_ID);
    assert.equal(account.found, true, `synthetic WhatsApp account unavailable: ${account.errorCategory || 'ACCOUNT_NOT_FOUND'}`);
    assert.equal(account.type, 'whatsapp');
    assert.equal(account.partition, WHATSAPP_PARTITION);

    const guest = await waitForGuest(account, WHATSAPP_ORIGIN);
    assert.equal(guest.storageLeaf, WHATSAPP_STORAGE_LEAF);
    assert.equal(guest.type, 'webview');
    assert.equal(guest.destroyed, false);

    const attempt = await observePageNavigation(guest, TELEGRAM_TARGET, WHATSAPP_ORIGIN, false);
    console.log(`E2E_NAV_WA_TG observed=${attempt.willNavigate === true} mainFrame=${attempt.mainFrame === true} didNavigate=${attempt.didNavigate === true} partition=${attempt.partition || 'none'} storageLeaf=${attempt.storageLeaf || 'none'} origin=${attempt.origin || 'none'} type=${attempt.type || 'none'} destroyed=${attempt.destroyed === true} sameWindowSet=${JSON.stringify(attempt.beforeWindowIds) === JSON.stringify(attempt.afterWindowIds)}`);

    assert.equal(attempt.category, 'NAVIGATION_ATTEMPT_OBSERVED', 'real WhatsApp guest did not emit main-process will-navigate');
    assert.equal(attempt.willNavigate, true);
    assert.equal(attempt.mainFrame, true, 'navigation attempt must target the guest main frame');
    assert.equal(attempt.targetOrigin, 'https://web.telegram.org', 'observed target must be the synthetic Telegram cross-platform destination');
    assert.equal(
      attempt.didNavigate,
      false,
      'blocked WhatsApp -> Telegram navigation must never commit a main-frame document',
    );
    assert.equal(attempt.destroyed, false, 'WhatsApp guest must remain alive after the blocked navigation');
    assert.equal(attempt.type, 'webview');
    assert.equal(attempt.partition, WHATSAPP_PARTITION, 'blocked navigation must retain the WhatsApp account Session');
    assert.equal(attempt.storageLeaf, WHATSAPP_STORAGE_LEAF, 'blocked navigation must retain the WhatsApp storage owner');
    assert.equal(attempt.origin, WHATSAPP_ORIGIN, 'Telegram must not become the WhatsApp guest final origin');
    assert.deepEqual(attempt.afterWindowIds, attempt.beforeWindowIds, 'cross-platform navigation must not create an escape BrowserWindow');
    await assertHostStillBound(WHATSAPP_PARTITION, guest.webContentsId);
  });

  it('blocks Website A from Website B while allowing same-owner document navigation', async () => {
    await waitForHostApi();
    const { websiteA, websiteB } = await createWebsiteFixtures();
    assert.equal(websiteA.type, 'website');
    assert.equal(websiteB.type, 'website');

    const guestA = await waitForGuest(websiteA, 'https://example.com');
    const guestB = await waitForGuest(websiteB, 'https://example.org');
    assert.equal(guestA.type, 'webview');
    assert.equal(guestB.type, 'webview');
    assert.notEqual(guestA.webContentsId, guestB.webContentsId, 'Website accounts must own distinct guest WebContents');

    const allowed = await observePageNavigation(guestA, WEBSITE_A_CONTROL_URL, 'https://example.com', true);
    console.log(`E2E_NAV_WEBSITE_ALLOWED observed=${allowed.willNavigate === true} didNavigate=${allowed.didNavigate === true} partition=${allowed.partition || 'none'} storageLeaf=${allowed.storageLeaf || 'none'} origin=${allowed.origin || 'none'} hostname=${allowed.hostname || 'none'} type=${allowed.type || 'none'} destroyed=${allowed.destroyed === true}`);
    assert.equal(allowed.category, 'NAVIGATION_ATTEMPT_OBSERVED', 'same-owner control did not emit will-navigate');
    assert.equal(allowed.willNavigate, true);
    assert.equal(allowed.mainFrame, true);
    assert.equal(allowed.targetHostname, 'example.com');
    assert.equal(allowed.didNavigate, true, 'same-owner Website navigation must complete; a blanket navigation block must fail this control');
    assert.equal(allowed.didHostname, 'example.com');
    assert.equal(allowed.destroyed, false);
    assert.equal(allowed.partition, websiteA.partition);
    assert.equal(allowed.storageLeaf, websiteA.partition.replace(/^persist:/, ''));
    assert.equal(allowed.origin, 'https://example.com');
    await assertHostStillBound(websiteA.partition, guestA.webContentsId);

    const refreshedA = await waitForGuest(websiteA, 'https://example.com');
    assert.equal(refreshedA.webContentsId, guestA.webContentsId, 'allowed navigation must keep the original Website A guest');
    const blocked = await observePageNavigation(refreshedA, WEBSITE_B_URL, 'https://example.com', false);
    console.log(`E2E_NAV_WEBSITE_CROSS observed=${blocked.willNavigate === true} mainFrame=${blocked.mainFrame === true} didNavigate=${blocked.didNavigate === true} partition=${blocked.partition || 'none'} storageLeaf=${blocked.storageLeaf || 'none'} origin=${blocked.origin || 'none'} hostname=${blocked.hostname || 'none'} type=${blocked.type || 'none'} destroyed=${blocked.destroyed === true} sameWindowSet=${JSON.stringify(blocked.beforeWindowIds) === JSON.stringify(blocked.afterWindowIds)}`);

    assert.equal(blocked.category, 'NAVIGATION_ATTEMPT_OBSERVED', 'Website A cross-account attempt did not emit main-process will-navigate');
    assert.equal(blocked.willNavigate, true);
    assert.equal(blocked.mainFrame, true);
    assert.equal(blocked.targetOrigin, 'https://example.org', 'observed target must be Website B');
    assert.equal(
      blocked.didNavigate,
      false,
      'blocked Website A -> Website B navigation must never commit a main-frame document',
    );
    assert.equal(blocked.destroyed, false, 'Website A guest must remain alive after the blocked navigation');
    assert.equal(blocked.type, 'webview');
    assert.equal(blocked.partition, websiteA.partition, 'Website A must retain its fixed account Session');
    assert.equal(blocked.storageLeaf, websiteA.partition.replace(/^persist:/, ''), 'Website A storage owner must remain unchanged');
    assert.equal(blocked.origin, 'https://example.com', 'Website B must not become Website A final origin');
    assert.notEqual(blocked.origin, websiteB.customOrigin, 'Website A partition must not carry Website B origin');
    assert.deepEqual(blocked.afterWindowIds, blocked.beforeWindowIds, 'cross-account navigation must not create an escape BrowserWindow');
    await assertHostStillBound(websiteA.partition, guestA.webContentsId);
  });
});
