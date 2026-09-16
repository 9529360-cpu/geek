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
      const directComposer = window.__geekWhatsAppDirectComposerController;
      const recovery = window.__geekWhatsAppSendRecovery;
      const legacyFallback = window.__geekWhatsAppPublicComposerFallback;
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
        directComposerVersion: Number(directComposer?.version || 0),
        directComposerNativeReady: typeof directComposer?.handleNativeSend === 'function',
        directComposerSettingReady: typeof directComposer?.resolveTranslationSetting === 'function',
        directComposerIdentityReady: typeof directComposer?.sameDirectIdentity === 'function',
        directComposerGestureOwner: typeof directComposer?.handleGesture === 'function',
        recoveryAbsent: !recovery,
        recoveryInactive: !recovery?.controller || recovery.controller.signal?.aborted === true,
        legacyFallbackInactive: !legacyFallback?.controller || legacyFallback.controller.signal?.aborted === true,
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
  const waJsReady = state?.found === true
    && state?.rendererProbeOk === true
    && state?.version === '4.6.0'
    && state?.wppInjected === true
    && state?.wppReady === true
    && state?.loaderReady === true;
  return waJsReady
    && state?.directComposerVersion === 7
    && state?.directComposerNativeReady === true
    && state?.directComposerSettingReady === true
    && state?.directComposerIdentityReady === true
    && state?.directComposerGestureOwner === false
    && state?.recoveryAbsent === true
    && state?.recoveryInactive === true
    && state?.legacyFallbackInactive === true;
}

describe('WhatsApp WA-JS 4.6 runtime compatibility', () => {
  it('settles WA-JS injection with one thin identity-safe native translation adapter', async () => {
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
      timeoutMsg: 'WA-JS 4.6 + identity-safe native translation adapter did not become ready',
    });

    assert.equal(state.version, '4.6.0', 'injected WA-JS version must match the exact dependency pin');
    assert.equal(state.wppInjected, true, 'WA-JS bundle must report injected before the partition is owned');
    assert.equal(state.wppReady, true, 'WA-JS official readiness must settle');
    assert.equal(state.loaderReady, true, 'WA-JS loader/module metadata required by compatibility paths is missing');
    assert.equal(state.directComposerVersion, 7, 'thin translation adapter must match the tested owner generation');
    assert.equal(state.directComposerNativeReady, true, 'native private-send adapter must be injected into the WhatsApp guest');
    assert.equal(state.directComposerSettingReady, true, 'chat-scoped translation configuration resolver must be injected');
    assert.equal(state.directComposerIdentityReady, true, 'WhatsApp LID/PN identity verifier must be injected');
    assert.equal(state.directComposerGestureOwner, false, 'WhatsApp translation adapter must not own a second DOM gesture path');
    assert.equal(state.recoveryAbsent, true, 'legacy recovery module must not bootstrap into a fresh WhatsApp guest');
    assert.equal(state.recoveryInactive, true, 'legacy recovery capture listener must remain retired');
    assert.equal(state.legacyFallbackInactive, true, 'superseded composer fallback must not remain an active owner');
    for (const key of ['chatReady', 'lidGroupReady', 'storesReady', 'fallbackReady']) {
      assert.equal(typeof state[key], 'boolean', key + ' must remain bounded diagnostic evidence');
    }
    console.log(`WA_JS_RUNTIME version=${state.version} injected=${state.wppInjected} ready=${state.wppReady} loader=${state.loaderReady} chat=${state.chatReady} lidGroup=${state.lidGroupReady} stores=${state.storesReady} fallback=${state.fallbackReady} directComposer=${state.directComposerVersion} native=${state.directComposerNativeReady} identity=${state.directComposerIdentityReady} gestureOwner=${state.directComposerGestureOwner} recoveryAbsent=${state.recoveryAbsent}`);
  });
});