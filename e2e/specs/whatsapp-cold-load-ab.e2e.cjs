'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const LOCAL_URL = 'http://127.0.0.1:1843/';
const LIVE_URL = 'https://web.whatsapp.com/';
const SETTLE_MS = 20_000;
const RENDERER_PROBE_MS = 1_500;

function summarize(result) {
  return JSON.stringify({
    found: result.found,
    mainUrl: result.mainUrl,
    responsive: result.responsive,
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

async function findGuestState() {
  return browser.electron.execute(async (electron, partition, probeMs) => {
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
    if (!guest) return { found: false, responsive: false, mainUrl: '' };

    const timeout = new Promise(resolve => setTimeout(() => resolve({ responsive: false }), probeMs));
    const pageProbe = guest.executeJavaScript(`(() => {
      const text = String(document.body?.innerText || '').slice(0, 6000);
      const loginHint = /scan.{0,40}qr|qr.{0,40}code|link with phone number|log into whatsapp|扫描.{0,30}二维码|使用电话号码|链接电话号码/i.test(text);
      return {
        responsive: true,
        url: location.href,
        readyState: document.readyState,
        progressCount: document.querySelectorAll('progress,[role="progressbar"]').length,
        qrCanvas: document.querySelectorAll('canvas').length,
        qrDataRef: document.querySelectorAll('[data-ref]').length,
        loginHint,
        bodyChildren: document.body?.children?.length || 0,
        metaRequire: typeof window.require === 'function',
      };
    })()`, true).catch(() => ({ responsive: false }));

    const page = await Promise.race([pageProbe, timeout]);
    return { found: true, mainUrl: guest.getURL(), ...page };
  }, PARTITION, RENDERER_PROBE_MS);
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
    const beforeUrl = guest.getURL();
    guest.stop();
    guest.loadURL(targetUrl).catch(() => {});
    return { found: true, beforeUrl };
  }, PARTITION, url);
}

describe('WhatsApp cold-load source A/B', () => {
  it('compares Geek frozen localhost bootstrap with current official WhatsApp Web without login', async () => {
    await browser.waitUntil(async () => (await findGuestState()).found === true, {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    const localStart = await startNavigation(LOCAL_URL);
    assert.equal(localStart.found, true, 'local arm guest missing');
    await browser.pause(SETTLE_MS);
    const local = await findGuestState();
    console.log(`WA_COLD_AB_LOCAL ${summarize(local)}`);

    // Even if the frozen renderer is wedged, main-process WebContents APIs remain the
    // control plane. Stop it and navigate the exact same guest/partition to live WA.
    const liveStart = await startNavigation(LIVE_URL);
    assert.equal(liveStart.found, true, 'live arm guest missing');
    await browser.pause(SETTLE_MS);
    const live = await findGuestState();
    console.log(`WA_COLD_AB_LIVE ${summarize(live)}`);

    assert.equal(local.mainUrl.startsWith(LOCAL_URL), true, 'local arm did not exercise Geek frozen bootstrap');
    assert.equal(live.mainUrl.startsWith(LIVE_URL), true, 'live arm did not exercise official WhatsApp Web');

    const localLooksLoggedOut = local.responsive && (local.loginHint || local.qrCanvas > 0 || local.qrDataRef > 0);
    const liveLooksLoggedOut = live.responsive && (live.loginHint || live.qrCanvas > 0 || live.qrDataRef > 0);
    console.log(`WA_COLD_AB_RESULT localResponsive=${local.responsive} liveResponsive=${live.responsive} localLoginShell=${localLooksLoggedOut} liveLoginShell=${liveLooksLoggedOut} localProgress=${local.progressCount ?? -1} liveProgress=${live.progressCount ?? -1}`);

    assert.equal(live.responsive, true, `official WhatsApp Web renderer was not responsive: ${summarize(live)}`);
    assert.equal(liveLooksLoggedOut, true, `official WhatsApp Web did not reach a logged-out/QR shell: ${summarize(live)}`);

    await startNavigation(LOCAL_URL);
  });
});
