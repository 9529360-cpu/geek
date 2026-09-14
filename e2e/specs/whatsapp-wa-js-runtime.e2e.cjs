'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const GUEST_TIMEOUT_MS = 10_000;
const RUNTIME_TIMEOUT_MS = 45_000;
const RENDERER_PROBE_TIMEOUT_MS = 2_000;

async function probeGuestRuntime() {
  return browser.electron.execute(async (electron, partition, probeTimeoutMs) => {
    const leaf = String(partition).split(':').pop();
    const guests = electron.webContents.getAllWebContents().filter((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
        return String(contents.session?.partition || '') === partition
          && storagePath.split(/[\\/]/).pop() === leaf
          && contents.getType?.() === 'webview'
          && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (guests.length !== 1) return { found: false, guestCount: Math.min(guests.length, 9) };

    const guest = guests[0];
    let timeoutId;
    const pageProbe = guest.executeJavaScript(`(() => {
      const W = window.WPP;
      const fallback = window.WAPLUS_WPP;
      return {
        rendererProbeOk: true,
        version: String(W?.version || ''),
        wppInjected: W?.isInjected === true,
        wppReady: W?.isReady === true,
        loaderReady: typeof W?.loader?.moduleRequire === 'function'
          && typeof W?.whatsapp?._moduleIdMap?.get === 'function',
        chatReady: typeof W?.chat?.sendTextMessage === 'function'
          && typeof W?.chat?.sendFileMessage === 'function'
          && typeof W?.chat?.getActiveChat === 'function',
        lidGroupReady: typeof W?.contact?.getPnLidEntry === 'function'
          && typeof W?.group?.getParticipants === 'function',
        storesReady: !!W?.whatsapp?.ChatStore && !!W?.whatsapp?.UserPrefs,
        fallbackReady: typeof fallback?.chat?.sendTextMessage === 'function'
          && typeof fallback?.chat?.sendFileMessage === 'function'
          && typeof fallback?.contact?.getPnLidEntry === 'function'
          && typeof fallback?.group?.getParticipants === 'function'
          && !!fallback?.whatsapp?.ChatStore
          && !!fallback?.whatsapp?.UserPrefs,
      };
    })()`, true).catch(() => ({ rendererProbeFailed: true }));
    const probeTimeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ rendererProbeTimedOut: true }), probeTimeoutMs);
    });
    const page = await Promise.race([pageProbe, probeTimeout]);
    clearTimeout(timeoutId);
    return { found: true, ...page };
  }, PARTITION, RENDERER_PROBE_TIMEOUT_MS);
}

function injectionReady(state) {
  return state?.found === true
    && state?.rendererProbeOk === true
    && state?.version === '4.6.0'
    && state?.wppInjected === true
    && state?.wppReady === true
    && state?.loaderReady === true;
}

describe('WhatsApp WA-JS 4.6 runtime compatibility', () => {
  it('settles WA-JS injection independently from authenticated capabilities and WAPLUS fallback', async () => {
    let state = null;
    await browser.waitUntil(async () => {
      state = await probeGuestRuntime();
      return state.found === true;
    }, {
      timeout: GUEST_TIMEOUT_MS,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    await browser.waitUntil(async () => {
      state = await probeGuestRuntime();
      return injectionReady(state);
    }, {
      timeout: RUNTIME_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: 'WA-JS 4.6 injection boundary did not become ready',
    });

    assert.equal(state.version, '4.6.0', 'injected WA-JS version must match the exact dependency pin');
    assert.equal(state.wppInjected, true, 'WA-JS bundle must report injected before the partition is owned');
    assert.equal(state.wppReady, true, 'WA-JS official readiness must settle');
    assert.equal(state.loaderReady, true, 'WA-JS loader/module metadata required by composer recovery is missing');
    for (const key of ['chatReady', 'lidGroupReady', 'storesReady', 'fallbackReady']) {
      assert.equal(typeof state[key], 'boolean', key + ' must remain bounded diagnostic evidence');
    }
    console.log(`WA_JS_RUNTIME version=${state.version} injected=${state.wppInjected} ready=${state.wppReady} loader=${state.loaderReady} chat=${state.chatReady} lidGroup=${state.lidGroupReady} stores=${state.storesReady} fallback=${state.fallbackReady}`);
  });
});
