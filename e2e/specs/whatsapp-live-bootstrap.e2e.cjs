'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const LIVE_URL = 'https://web.whatsapp.com/';
const SETTLE_MS = 20_000;

async function probeGuest() {
  return browser.electron.execute(async (electron, partition) => {
    const leaf = String(partition).split(':').pop();
    const guest = electron.webContents.getAllWebContents().find((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
        return storagePath.split(/[\\/]/).pop() === leaf && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (!guest) return { found: false };

    const page = await guest.executeJavaScript(`(() => {
      const text = String(document.body?.innerText || '').slice(0, 6000);
      return {
        url: location.href,
        readyState: document.readyState,
        progressCount: document.querySelectorAll('progress,[role="progressbar"]').length,
        qrCanvas: document.querySelectorAll('canvas').length,
        qrDataRef: document.querySelectorAll('[data-ref]').length,
        loginHint: /scan.{0,40}qr|qr.{0,40}code|link with phone number|log into whatsapp|扫描.{0,30}二维码|使用电话号码|链接电话号码/i.test(text),
        metaRequire: typeof window.require === 'function',
        wppPresent: !!window.WPP,
        wppInjected: window.WPP?.isInjected === true,
        wppReady: window.WPP?.isReady === true,
        waPlusPresent: !!window.WAPLUS_WPP,
        waPlusChat: !!window.WAPLUS_WPP?.chat?.sendTextMessage,
      };
    })()`, true).catch(() => null);

    return { found: true, mainUrl: guest.getURL(), ...(page || { rendererProbeFailed: true }) };
  }, PARTITION);
}

describe('WhatsApp current Web bootstrap', () => {
  it('reaches the logged-out QR shell without a WhatsApp login', async () => {
    await browser.waitUntil(async () => (await probeGuest()).found === true, {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    await browser.pause(SETTLE_MS);
    const state = await probeGuest();
    console.log(`WA_LIVE_BOOTSTRAP ${JSON.stringify(state)}`);

    assert.equal(state.mainUrl?.startsWith(LIVE_URL), true, 'WhatsApp guest did not use current official Web bootstrap');
    assert.equal(state.url?.startsWith(LIVE_URL), true, 'renderer did not finish on current official WhatsApp Web');
    assert.equal(state.readyState, 'complete', 'WhatsApp document did not complete loading');

    const loggedOutShell = state.loginHint || state.qrCanvas > 0 || state.qrDataRef > 0;
    assert.equal(loggedOutShell, true, `current WhatsApp Web did not reach QR/login shell: ${JSON.stringify(state)}`);
    assert.equal(state.progressCount, 0, `WhatsApp remained on loading progress: ${JSON.stringify(state)}`);

    // These are evidence, not the startup acceptance criterion. If they regress,
    // the next repair should target the injection owner rather than the bootstrap.
    console.log(`WA_LIVE_INJECTION wppPresent=${state.wppPresent} wppInjected=${state.wppInjected} wppReady=${state.wppReady} waPlusPresent=${state.waPlusPresent} waPlusChat=${state.waPlusChat} metaRequire=${state.metaRequire}`);
  });
});
