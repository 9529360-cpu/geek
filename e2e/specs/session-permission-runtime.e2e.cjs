'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_ID = 'e2e-account-a';
const EXPECTED_PARTITION = `persist:webview-page-${ACCOUNT_ID}`;
const EXPECTED_ORIGIN = 'http://127.0.0.1:1843';
const RUNTIME_TIMEOUT = 15_000;

function runtimeDiagnostic(state) {
  return `category=${state?.category || 'UNKNOWN'} partition=${state?.partition || 'none'} origin=${state?.origin || 'none'}`;
}

async function readSyntheticWhatsAppAccount() {
  return browser.executeAsync((accountId, done) => {
    const clean = (value) => String(value || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'Error';
    window.api.accounts.list().then((state) => {
      const account = Array.isArray(state?.accounts)
        ? state.accounts.find(item => item?.id === accountId)
        : null;
      done(account ? {
        found: true,
        type: String(account.type || ''),
        partition: String(account.partition || ''),
      } : { found: false, errorCategory: 'ACCOUNT_NOT_FOUND' });
    }).catch((error) => done({
      found: false,
      errorCategory: clean(error?.name || 'Error'),
    }));
  }, ACCOUNT_ID);
}

async function waitForWhatsAppGuest(expectedPartition) {
  let lastState = {
    category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND',
    partition: expectedPartition,
    origin: '',
    webContentsId: 0,
  };

  try {
    await browser.waitUntil(async () => {
      const hostState = await browser.execute((partition) => {
        const matches = Array.from(document.querySelectorAll('webview'))
          .filter(webview => String(webview.getAttribute('partition') || webview.partition || '') === partition);
        if (matches.length !== 1) return { count: matches.length, webContentsId: 0 };
        try {
          return { count: 1, webContentsId: Number(matches[0].getWebContentsId()) || 0 };
        } catch {
          return { count: 1, webContentsId: 0 };
        }
      }, expectedPartition);

      if (hostState.count !== 1 || !hostState.webContentsId) {
        lastState = {
          category: hostState.count > 1 ? 'ACCOUNT_WEBCONTENTS_AMBIGUOUS' : 'ACCOUNT_WEBCONTENTS_NOT_FOUND',
          partition: expectedPartition,
          origin: '',
          webContentsId: 0,
        };
        return false;
      }

      lastState = await browser.electron.execute((electron, webContentsId, partition, origin) => {
        const target = electron.webContents.getAllWebContents()
          .find(contents => contents.id === webContentsId && !contents.isDestroyed());
        if (!target) {
          return {
            category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND',
            partition,
            origin: '',
            webContentsId: 0,
          };
        }

        const actualPartition = String(target.session?.partition || '');
        let actualOrigin = '';
        try {
          actualOrigin = new URL(target.getURL()).origin;
        } catch {}

        if (actualPartition !== partition) {
          return {
            category: 'PARTITION_MISMATCH',
            partition: actualPartition,
            origin: actualOrigin,
            webContentsId,
          };
        }
        if (String(target.getType?.() || '') !== 'webview') {
          return {
            category: 'ACCOUNT_WEBCONTENTS_NOT_GUEST',
            partition: actualPartition,
            origin: actualOrigin,
            webContentsId,
          };
        }
        if (actualOrigin !== origin) {
          return {
            category: 'ORIGIN_MISMATCH',
            partition: actualPartition,
            origin: actualOrigin,
            webContentsId,
          };
        }
        return {
          category: 'READY',
          partition: actualPartition,
          origin: actualOrigin,
          webContentsId,
        };
      }, hostState.webContentsId, expectedPartition, EXPECTED_ORIGIN);

      return lastState.category === 'READY';
    }, {
      timeout: RUNTIME_TIMEOUT,
      interval: 150,
      timeoutMsg: 'WhatsApp guest did not reach the persistent-storage runtime boundary',
    });
  } catch {
    throw new Error(`WhatsApp persistent-storage guest readiness failed ${runtimeDiagnostic(lastState)}`);
  }

  return lastState;
}

async function probePersistentStorage(guestState) {
  return browser.electron.execute(async (electron, webContentsId, expectedPartition, expectedOrigin) => {
    const clean = (value) => String(value || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'Error';
    const target = electron.webContents.getAllWebContents()
      .find(contents => contents.id === webContentsId && !contents.isDestroyed());
    if (!target) {
      return {
        category: 'ACCOUNT_WEBCONTENTS_NOT_FOUND',
        partition: expectedPartition,
        origin: '',
      };
    }

    const partition = String(target.session?.partition || '');
    let origin = '';
    try {
      origin = new URL(target.getURL()).origin;
    } catch {}
    if (partition !== expectedPartition) return { category: 'PARTITION_MISMATCH', partition, origin };
    if (String(target.getType?.() || '') !== 'webview') {
      return { category: 'ACCOUNT_WEBCONTENTS_NOT_GUEST', partition, origin };
    }
    if (origin !== expectedOrigin) return { category: 'ORIGIN_MISMATCH', partition, origin };

    try {
      // Keep this inside the real guest renderer. Calling Geek's policy helpers here
      // would miss Chromium -> Electron Session permission request/check plumbing.
      const rendererResult = await target.executeJavaScript(`(async () => {
        const clean = (value) => String(value || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'Error';
        const result = {
          secureContext: window.isSecureContext === true,
          persistApi: typeof navigator.storage?.persist === 'function',
          persistedApi: typeof navigator.storage?.persisted === 'function',
          persistGranted: false,
          persisted: false,
          errorCategory: '',
        };
        if (!result.secureContext || !result.persistApi || !result.persistedApi) return result;
        try {
          result.persistGranted = await navigator.storage.persist() === true;
          result.persisted = await navigator.storage.persisted() === true;
        } catch (error) {
          result.errorCategory = clean(error?.name || 'Error');
        }
        return result;
      })()`);

      return {
        category: rendererResult?.errorCategory ? 'STORAGE_API_ERROR' : 'STORAGE_PROBE_COMPLETE',
        partition,
        origin,
        secureContext: rendererResult?.secureContext === true,
        persistApi: rendererResult?.persistApi === true,
        persistedApi: rendererResult?.persistedApi === true,
        persistGranted: rendererResult?.persistGranted === true,
        persisted: rendererResult?.persisted === true,
        errorCategory: clean(rendererResult?.errorCategory || ''),
      };
    } catch (error) {
      return {
        category: 'GUEST_EXECUTION_FAILED',
        partition,
        origin,
        errorCategory: clean(error?.name || 'Error'),
      };
    }
  }, guestState.webContentsId, guestState.partition, guestState.origin);
}

describe('Geek WhatsApp persistent-storage runtime', () => {
  it('grants durable storage through the real account Session permission boundary', async () => {
    await browser.waitUntil(async () => browser.execute(() =>
      document.readyState === 'complete' && !!window.api?.accounts), {
      timeout: 10_000,
      timeoutMsg: 'Geek main renderer did not expose the account API',
    });

    const account = await readSyntheticWhatsAppAccount();
    assert.equal(account.found, true, `synthetic WhatsApp account unavailable: ${account.errorCategory || 'ACCOUNT_NOT_FOUND'}`);
    assert.equal(account.type, 'whatsapp', 'synthetic account must remain WhatsApp');
    assert.equal(account.partition, EXPECTED_PARTITION, `synthetic WhatsApp partition incorrect: ${account.partition || 'none'}`);

    const guestState = await waitForWhatsAppGuest(account.partition);
    assert.equal(guestState.partition, EXPECTED_PARTITION, `real WhatsApp guest partition incorrect: ${guestState.partition || 'none'}`);
    assert.equal(guestState.origin, EXPECTED_ORIGIN, `real WhatsApp guest origin incorrect: ${guestState.origin || 'none'}`);

    const probe = await probePersistentStorage(guestState);
    console.log(`E2E_WA_PERSISTENT_STORAGE partition=${probe.partition || 'none'} origin=${probe.origin || 'none'} secure=${probe.secureContext === true} persistApi=${probe.persistApi === true} persistedApi=${probe.persistedApi === true} persist=${probe.persistGranted === true} persisted=${probe.persisted === true} error=${probe.errorCategory || 'none'}`);

    assert.notEqual(probe.category, 'GUEST_EXECUTION_FAILED', `WhatsApp guest renderer execution failed: ${probe.errorCategory || 'Error'}`);
    assert.notEqual(probe.category, 'STORAGE_API_ERROR', `WhatsApp StorageManager execution failed: ${probe.errorCategory || 'Error'}`);
    assert.equal(probe.category, 'STORAGE_PROBE_COMPLETE', `WhatsApp persistent-storage runtime boundary failed ${runtimeDiagnostic(probe)}`);
    assert.equal(probe.secureContext, true, 'WhatsApp local bootstrap is not a secure context');
    assert.equal(probe.persistApi, true, 'navigator.storage.persist is unavailable in the WhatsApp guest');
    assert.equal(probe.persistedApi, true, 'navigator.storage.persisted is unavailable in the WhatsApp guest');
    assert.equal(probe.persistGranted, true, 'navigator.storage.persist() returned false for the WhatsApp account Session');
    assert.equal(probe.persisted, true, 'navigator.storage.persisted() returned false after the WhatsApp persistent-storage grant');
  });
});
