'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const LOCAL_URL = 'http://127.0.0.1:1843/';
const LIVE_URL = 'https://web.whatsapp.com/';
const SETTLE_MS = 20_000;

function summarize(result) {
  return JSON.stringify({
    url: result.url,
    readyState: result.readyState,
    progressCount: result.progressCount,
    qrCanvas: result.qrCanvas,
    qrDataRef: result.qrDataRef,
    loginHint: result.loginHint,
    bodyChildren: result.bodyChildren,
    metaRequire: result.metaRequire,
  });
}

async function findGuestSnapshot() {
  return browser.electron.execute(async (electron, partition) => {
    const leaf = String(partition).split(':').pop();
    const guest = electron.webContents.getAllWebContents().find((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
        const storageLeaf = storagePath.split(/[\\/]/).pop();
        return storageLeaf === leaf && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (!guest) return { found: false };
    const page = await guest.executeJavaScript(`(() => {
      const text = String(document.body?.innerText || '').slice(0, 6000);
      const loginHint = /scan.{0,40}qr|qr.{0,40}code|link with phone number|log into whatsapp|扫描.{0,30}二维码|使用电话号码|链接电话号码/i.test(text);
      return {
        url: location.href,
        readyState: document.readyState,
        progressCount: document.querySelectorAll('progress,[role="progressbar"]').length,
        qrCanvas: document.querySelectorAll('canvas').length,
        qrDataRef: document.querySelectorAll('[data-ref]').length,
        loginHint,
        bodyChildren: document.body?.children?.length || 0,
        metaRequire: typeof window.require === 'function',
      };
    })()`, true);
    return { found: true, ...page };
  }, PARTITION);
}

async function startNavigation(url) {
  return browser.electron.execute((electron, partition, targetUrl) => {
    const leaf = String(partition).split(':').pop();
    const guest = electron.webContents.getAllWebContents().find((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
        const storageLeaf = storagePath.split(/[\\/]/).pop();
        return storageLeaf === leaf && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (!guest) return { found: false };
    guest.loadURL(targetUrl).catch(() => {});
    return { found: true, beforeUrl: guest.getURL() };
  }, PARTITION, url);
}

describe('WhatsApp cold-load source A/B', () => {
  it('compares Geek frozen localhost bootstrap with current official WhatsApp Web without login', async () => {
    await browser.waitUntil(async () => (await findGuestSnapshot()).found === true, {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    // A: exact Geek source used by the failing client. Keep the wait in WDIO, not
    // inside browser.electron.execute(), whose transport has a much shorter RPC timeout.
    const localStart = await startNavigation(LOCAL_URL);
    assert.equal(localStart.found, true, 'local arm guest missing');
    await browser.pause(SETTLE_MS);
    const local = await findGuestSnapshot();

    // B: same Electron guest and persistent partition; only source URL changes.
    const liveStart = await startNavigation(LIVE_URL);
    assert.equal(liveStart.found, true, 'live arm guest missing');
    await browser.pause(SETTLE_MS);
    const live = await findGuestSnapshot();

    console.log(`WA_COLD_AB_LOCAL ${summarize(local)}`);
    console.log(`WA_COLD_AB_LIVE ${summarize(live)}`);

    assert.equal(local.url.startsWith(LOCAL_URL), true, 'local arm did not exercise Geek frozen bootstrap');
    assert.equal(live.url.startsWith(LIVE_URL), true, 'live arm did not exercise official WhatsApp Web');

    const localLooksLoggedOut = local.loginHint || local.qrCanvas > 0 || local.qrDataRef > 0;
    const liveLooksLoggedOut = live.loginHint || live.qrCanvas > 0 || live.qrDataRef > 0;
    console.log(`WA_COLD_AB_RESULT localLoginShell=${localLooksLoggedOut} liveLoginShell=${liveLooksLoggedOut} localProgress=${local.progressCount} liveProgress=${live.progressCount}`);

    // The live arm is the control. If it reaches the logged-out shell while local does
    // not, the frozen bootstrap is isolated as the failure variable without any login.
    assert.equal(liveLooksLoggedOut, true, `official WhatsApp Web did not reach a logged-out/QR shell: ${summarize(live)}`);

    // Restore the actual product source for later specs sharing this isolated process.
    await startNavigation(LOCAL_URL);
  });
});
