'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const LIVE_URL = 'http://127.0.0.1:1843/';
const GUEST_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 45_000;
const RENDERER_PROBE_TIMEOUT_MS = 2_000;

function safeOrigin(value) {
  try { return new URL(String(value || '')).origin; } catch { return ''; }
}

function summarizeState(state) {
  const loginShell = state.loginHint === true || state.qrCanvas > 0 || state.qrDataRef > 0;
  return {
    platform: String(state.platform || ''),
    guestFound: state.found === true,
    mainOrigin: safeOrigin(state.mainUrl),
    rendererOrigin: safeOrigin(state.url),
    officialWeb: state.mainUrl?.startsWith(LIVE_URL) === true && state.url?.startsWith(LIVE_URL) === true,
    documentComplete: state.readyState === 'complete',
    loginShell,
    loadingProgress: Number.isInteger(state.progressCount) ? state.progressCount : -1,
    rendererResponsive: state.rendererProbeTimedOut !== true && state.rendererProbeFailed !== true,
  };
}

async function probeGuest() {
  return browser.electron.execute(async (electron, partition, probeTimeoutMs) => {
    const leaf = String(partition).split(':').pop();
    const guest = electron.webContents.getAllWebContents().find((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
        return storagePath.split(/[\\/]/).pop() === leaf && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (!guest) return { found: false, platform: process.platform };

    const pageProbe = guest.executeJavaScript(`(() => {
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
    })()`, true).catch(() => ({ rendererProbeFailed: true }));
    const probeTimeout = new Promise(resolve => setTimeout(() => resolve({ rendererProbeTimedOut: true }), probeTimeoutMs));
    const page = await Promise.race([pageProbe, probeTimeout]);

    return { found: true, platform: process.platform, mainUrl: guest.getURL(), ...page };
  }, PARTITION, RENDERER_PROBE_TIMEOUT_MS);
}

describe('WhatsApp current Web bootstrap', () => {
  it('reaches the logged-out QR shell without a WhatsApp login', async () => {
    await browser.waitUntil(async () => (await probeGuest()).found === true, {
      timeout: GUEST_TIMEOUT_MS,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    let state = await probeGuest();
    try {
      await browser.waitUntil(async () => {
        state = await probeGuest();
        const summary = summarizeState(state);
        return summary.guestFound
          && summary.officialWeb
          && summary.documentComplete
          && summary.loginShell
          && summary.loadingProgress === 0;
      }, {
        timeout: BOOTSTRAP_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: 'current WhatsApp Web did not reach the logged-out terminal shell',
      });
    } catch (error) {
      state = await probeGuest();
      throw new Error(`WhatsApp bootstrap terminal-state timeout: ${JSON.stringify(summarizeState(state))}`, { cause: error });
    }

    state = await probeGuest();
    const summary = summarizeState(state);
    console.log(`WA_LIVE_BOOTSTRAP ${JSON.stringify(summary)}`);
    if (summary.platform === 'win32') {
      console.log(`WA_WINDOWS_BOOTSTRAP platform=win32 guestFound=${summary.guestFound} officialWeb=${summary.officialWeb} documentComplete=${summary.documentComplete} loginShell=${summary.loginShell} loadingProgress=${summary.loadingProgress}`);
    }

    assert.equal(summary.officialWeb, true, 'WhatsApp guest and renderer did not use current official Web bootstrap');
    assert.equal(summary.documentComplete, true, 'WhatsApp document did not complete loading');
    assert.equal(summary.loginShell, true, `current WhatsApp Web did not reach QR/login shell: ${JSON.stringify(summary)}`);
    assert.equal(summary.loadingProgress, 0, `WhatsApp remained on loading progress: ${JSON.stringify(summary)}`);

    // These are evidence, not the startup acceptance criterion. If they regress,
    // the next repair should target the injection owner rather than the bootstrap.
    console.log(`WA_LIVE_INJECTION wppPresent=${state.wppPresent} wppInjected=${state.wppInjected} wppReady=${state.wppReady} waPlusPresent=${state.waPlusPresent} waPlusChat=${state.waPlusChat} metaRequire=${state.metaRequire}`);
  });
});
