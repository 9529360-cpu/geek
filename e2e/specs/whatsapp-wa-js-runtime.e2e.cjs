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
        legacyRuntimeAbsent: typeof fallback === 'undefined',
        fallbackReady: typeof fallback?.chat?.sendTextMessage === 'function'
          && typeof fallback?.chat?.sendFileMessage === 'function'
          && typeof fallback?.contact?.getPnLidEntry === 'function'
          && typeof fallback?.group?.getParticipants === 'function'
          && !!fallback?.whatsapp?.ChatStore
          && !!fallback?.whatsapp?.UserPrefs,
        directComposerVersion: Number(directComposer?.version || 0),
        directComposerActive: directComposer?.active === true,
        directComposerOwnerReady: typeof directComposer?.submitThroughOwner === 'function',
        legacyNativeOwnerAbsent: typeof directComposer?.handleNativeSend !== 'function',
        legacyPolicyOwnerAbsent: typeof directComposer?.resolveTranslationSetting !== 'function'
          && typeof directComposer?.sameDirectIdentity !== 'function',
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
    && state?.legacyRuntimeAbsent === true
    && state?.directComposerVersion === 9
    && state?.directComposerActive === true
    && state?.directComposerOwnerReady === true
    && state?.legacyNativeOwnerAbsent === true
    && state?.legacyPolicyOwnerAbsent === true
    && state?.recoveryAbsent === true
    && state?.recoveryInactive === true
    && state?.legacyFallbackInactive === true;
}

async function probeTrustedSubmitInput() {
  return browser.execute(async (partition) => {
    const webview = Array.from(document.querySelectorAll('webview')).find(
      item => String(item.partition || item.getAttribute?.('partition') || '') === partition,
    ) || null;
    if (!webview) return { found: false };

    const readActiveChat = () => {
      try { return !!(window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.()); } catch { return false; }
    };
    const activeChatBefore = await webview.executeJavaScript('(' + readActiveChat.toString() + ')()', true).catch(() => false);
    let trustedSubmit = null;
    const onIpcMessage = (event) => {
      if (event?.channel !== 'geek-trusted-submit') return;
      const payload = event.args?.[0];
      if (payload?.platform !== 'whatsapp') return;
      trustedSubmit = {
        platform: String(payload.platform || ''),
        kind: String(payload.kind || ''),
        composerGeneration: Number(payload.composerGeneration || 0),
      };
    };
    webview.addEventListener('ipc-message', onIpcMessage);

    const cleanup = () => {
      document.querySelector('[data-geek-e2e-composer]')?.remove();
      document.querySelector('[data-geek-e2e-footer]')?.remove();
      document.querySelector('[data-geek-e2e-main]')?.remove();
      return true;
    };

    try {
      const sendInputReady = typeof webview.sendInputEvent === 'function';
      if (!sendInputReady) return { found: true, sendInputReady: false, activeChatBefore };
      webview.focus();
      const installComposer = () => {
        document.querySelector('[data-geek-e2e-composer]')?.remove();
        let main = document.querySelector('#main');
        if (!main) {
          main = document.createElement('div');
          main.id = 'main';
          main.setAttribute('data-geek-e2e-main', '1');
          document.body.appendChild(main);
        }
        let footer = main.querySelector('footer');
        if (!footer) {
          footer = document.createElement('footer');
          footer.setAttribute('data-geek-e2e-footer', '1');
          main.appendChild(footer);
        }
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        editor.setAttribute('data-testid', 'conversation-compose-box-input');
        editor.setAttribute('data-geek-e2e-composer', '1');
        editor.style.cssText = 'position:fixed;left:1px;top:1px;width:20px;height:20px;z-index:2147483647;';
        footer.appendChild(editor);
        editor.focus();
        return document.activeElement === editor;
      };
      const composerFocused = await webview.executeJavaScript('(' + installComposer.toString() + ')()', true);
      await webview.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER', modifiers: [] });
      await webview.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER', modifiers: [] });
      for (let index = 0; index < 20 && !trustedSubmit; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const activeChatAfter = await webview.executeJavaScript('(' + readActiveChat.toString() + ')()', true).catch(() => false);
      return {
        found: true,
        sendInputReady: true,
        composerFocused: composerFocused === true,
        activeChatBefore,
        activeChatAfter,
        submitSeen: !!trustedSubmit,
        platform: trustedSubmit?.platform || '',
        kind: trustedSubmit?.kind || '',
        composerGeneration: Number(trustedSubmit?.composerGeneration || 0),
      };
    } finally {
      webview.removeEventListener('ipc-message', onIpcMessage);
      await webview.executeJavaScript('(' + cleanup.toString() + ')()', true).catch(() => false);
    }
  }, PARTITION);
}

async function probeSyntheticSendIntent() {
  return browser.execute(async (partition) => {
    const webview = Array.from(document.querySelectorAll('webview')).find(
      item => String(item.partition || item.getAttribute?.('partition') || '') === partition,
    ) || null;
    if (!webview) return { found: false };
    if (typeof webview.sendInputEvent !== 'function') return { found: true, sendInputReady: false };

    const syntheticChatId = 'e2e-synthetic@c.us';
    const syntheticText = 'geek-send-intent-synthetic';
    const installSynthetic = (chatId, text) => {
      const existing = window.__geekE2ESyntheticSendIntent;
      try { existing?.cleanup?.(); } catch {}
      const previousW = window.W;
      const previousRequest = window.__geekTranslationRequest;
      const mainWasCreated = !document.querySelector('#main');
      let main = document.querySelector('#main');
      if (!main) {
        main = document.createElement('div');
        main.id = 'main';
        main.setAttribute('data-geek-e2e-main', '1');
        document.body.appendChild(main);
      }
      const footerWasCreated = !main.querySelector('footer');
      let footer = main.querySelector('footer');
      if (!footer) {
        footer = document.createElement('footer');
        footer.setAttribute('data-geek-e2e-footer', '1');
        main.appendChild(footer);
      }
      document.querySelector('[data-geek-e2e-send-intent-composer]')?.remove();
      document.querySelectorAll('[data-geek-e2e-send-intent-message]').forEach(node => node.remove());
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.setAttribute('data-testid', 'conversation-compose-box-input');
      editor.setAttribute('data-geek-e2e-send-intent-composer', '1');
      editor.replaceChildren(document.createTextNode(text));
      editor.style.cssText = 'position:fixed;left:1px;top:1px;width:40px;height:20px;z-index:2147483647;';
      footer.appendChild(editor);

      const priorChat = previousW?.chat && typeof previousW.chat === 'object' ? previousW.chat : {};
      window.W = Object.assign({}, previousW && typeof previousW === 'object' ? previousW : {}, {
        chat: Object.assign({}, priorChat, { getActive: () => ({ id: { _serialized: chatId } }) }),
      });

      window.__geekE2ESendIntentOutcome = null;
      if (typeof previousRequest === 'function') {
        const wrappedRequest = async function (payload) {
          try {
            const result = await previousRequest.call(this, payload);
            window.__geekE2ESendIntentOutcome = {
              owner: String(result?.delivery?.owner || ''),
              state: String(result?.delivery?.state || ''),
              mode: String(result?.mode || ''),
              textMatches: String(result?.text || '') === text,
              error: '',
            };
            return result;
          } catch (error) {
            window.__geekE2ESendIntentOutcome = {
              owner: '', state: '', mode: '', textMatches: false,
              error: String(error?.message || error || '').slice(0, 120),
            };
            throw error;
          }
        };
        try { Object.defineProperty(wrappedRequest, '__geekTranslationIntentTransport', { value: true }); } catch {}
        try { Object.defineProperty(wrappedRequest, '__geekTranslationIntentOriginal', { value: previousRequest }); } catch {}
        window.__geekTranslationRequest = wrappedRequest;
      }

      const commitHandler = event => {
        if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') !== '1') return;
        if (event?.isTrusted !== true || event.key !== 'Enter') return;
        const target = event.target?.closest?.('[data-geek-e2e-send-intent-composer]');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        target.replaceChildren();
        const row = document.createElement('div');
        row.setAttribute('data-testid', 'conv-msg-e2e-synthetic');
        row.setAttribute('data-geek-e2e-send-intent-message', '1');
        main.appendChild(row);
      };
      document.addEventListener('keydown', commitHandler, true);

      const cleanup = () => {
        try { document.removeEventListener('keydown', commitHandler, true); } catch {}
        try { document.querySelector('[data-geek-e2e-send-intent-composer]')?.remove(); } catch {}
        try { document.querySelectorAll('[data-geek-e2e-send-intent-message]').forEach(node => node.remove()); } catch {}
        try { if (footerWasCreated) document.querySelector('[data-geek-e2e-footer]')?.remove(); } catch {}
        try { if (mainWasCreated) document.querySelector('[data-geek-e2e-main]')?.remove(); } catch {}
        try { window.__geekTranslationRequest = previousRequest; } catch {}
        try { if (previousW === undefined) delete window.W; else window.W = previousW; } catch {}
        try { delete window.__geekE2ESendIntentOutcome; delete window.__geekE2ESyntheticSendIntent; } catch {}
        return true;
      };
      window.__geekE2ESyntheticSendIntent = { cleanup };
      editor.focus();
      return {
        installed: document.activeElement === editor,
        requestReady: typeof previousRequest === 'function',
        activeChat: String((window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.())?.id?._serialized || ''),
        composerTextMatches: editor.childNodes.length === 1 && editor.firstChild?.nodeValue === text,
      };
    };

    const readState = () => {
      const editor = document.querySelector('[data-geek-e2e-send-intent-composer]');
      return {
        outcome: window.__geekE2ESendIntentOutcome || null,
        composerEmpty: !!editor && editor.childNodes.length === 0,
        messageSeen: document.querySelectorAll('[data-geek-e2e-send-intent-message]').length === 1,
        activeChat: String((window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.())?.id?._serialized || ''),
      };
    };
    const cleanupSynthetic = () => {
      try { return window.__geekE2ESyntheticSendIntent?.cleanup?.() === true; } catch { return false; }
    };
    const readRealActive = () => {
      try { return !!(window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.()); } catch { return false; }
    };

    const realActiveBefore = await webview.executeJavaScript('(' + readRealActive.toString() + ')()', true).catch(() => false);
    try {
      webview.focus();
      const installed = await webview.executeJavaScript('(' + installSynthetic.toString() + ')(' + JSON.stringify(syntheticChatId) + ',' + JSON.stringify(syntheticText) + ')', true);
      if (!installed?.installed || !installed?.requestReady || installed.activeChat !== syntheticChatId || installed.composerTextMatches !== true) {
        return { found: true, sendInputReady: true, installed: false, realActiveBefore };
      }
      await webview.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER', modifiers: [] });
      await webview.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER', modifiers: [] });

      let state = null;
      for (let index = 0; index < 120; index += 1) {
        state = await webview.executeJavaScript('(' + readState.toString() + ')()', true).catch(() => null);
        if (state?.outcome?.state === 'sent' && state?.composerEmpty === true && state?.messageSeen === true) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return {
        found: true,
        sendInputReady: true,
        installed: true,
        realActiveBefore,
        owner: String(state?.outcome?.owner || ''),
        state: String(state?.outcome?.state || ''),
        mode: String(state?.outcome?.mode || ''),
        textMatches: state?.outcome?.textMatches === true,
        error: String(state?.outcome?.error || ''),
        composerEmpty: state?.composerEmpty === true,
        messageSeen: state?.messageSeen === true,
        syntheticChatBound: state?.activeChat === syntheticChatId,
      };
    } finally {
      await webview.executeJavaScript('(' + cleanupSynthetic.toString() + ')()', true).catch(() => false);
    }
  }, PARTITION).then(async result => {
    const realActiveAfter = await browser.execute(async (partition) => {
      const webview = Array.from(document.querySelectorAll('webview')).find(
        item => String(item.partition || item.getAttribute?.('partition') || '') === partition,
      ) || null;
      if (!webview) return false;
      const readRealActive = () => {
        try { return !!(window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.()); } catch { return false; }
      };
      return webview.executeJavaScript('(' + readRealActive.toString() + ')()', true).catch(() => false);
    }, PARTITION);
    return { ...result, realActiveAfter };
  });
}

describe('WhatsApp WA-JS 4.6 runtime compatibility', () => {
  it('settles WA-JS injection with one SendIntent composer owner and no legacy send recovery', async () => {
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
      timeoutMsg: 'WA-JS 4.6 + SendIntent composer owner did not become ready',
    });

    assert.equal(state.version, '4.6.0');
    assert.equal(state.wppInjected, true);
    assert.equal(state.wppReady, true);
    assert.equal(state.loaderReady, true);
    assert.equal(state.legacyRuntimeAbsent, true, 'a second legacy runtime must not patch shared native sending');
    assert.equal(state.directComposerVersion, 9, 'WhatsApp composer owner must match the tested SendIntent generation');
    assert.equal(state.directComposerActive, true);
    assert.equal(state.directComposerOwnerReady, true, 'trusted composer gestures must delegate to SendIntent');
    assert.equal(state.legacyNativeOwnerAbsent, true, 'controller must not own WA-JS native send');
    assert.equal(state.legacyPolicyOwnerAbsent, true, 'controller must not own translation policy or LID/PN selection');
    assert.equal(state.recoveryAbsent, true, 'legacy recovery module must not bootstrap into a fresh WhatsApp guest');
    assert.equal(state.recoveryInactive, true);
    assert.equal(state.legacyFallbackInactive, true);
    for (const key of ['chatReady', 'lidGroupReady', 'storesReady', 'fallbackReady']) {
      assert.equal(typeof state[key], 'boolean', key + ' must remain bounded diagnostic evidence');
    }
    console.log(`WA_JS_RUNTIME version=${state.version} injected=${state.wppInjected} ready=${state.wppReady} loader=${state.loaderReady} chat=${state.chatReady} lidGroup=${state.lidGroupReady} stores=${state.storesReady} fallback=${state.fallbackReady} directComposer=${state.directComposerVersion} sendIntentOwner=${state.directComposerOwnerReady} recoveryAbsent=${state.recoveryAbsent}`);
  });
  it('emits a trusted WhatsApp keyboard submit from native WebView input without opening a chat', async () => {
    const state = await probeTrustedSubmitInput();
    assert.equal(state.found, true);
    assert.equal(state.sendInputReady, true, 'Electron WebView must expose native input delivery');
    assert.equal(state.composerFocused, true, 'isolated fake composer must own guest focus before Enter');
    assert.equal(state.activeChatBefore, false, 'isolated runtime must not start with a real active chat');
    assert.equal(state.activeChatAfter, false, 'trusted-submit probe must not open or mutate a real chat');
    assert.equal(state.submitSeen, true, 'trusted WebView Enter must reach the WhatsApp preload observer');
    assert.equal(state.platform, 'whatsapp');
    assert.equal(state.kind, 'keyboard');
    assert.ok(state.composerGeneration >= 1, 'trusted submit must carry a bounded composer generation');
    console.log('WA_TRUSTED_SUBMIT nativeInput=true platform=' + state.platform + ' kind=' + state.kind + ' generation=' + state.composerGeneration + ' noActiveChat=' + (!state.activeChatAfter));
  });
  it('routes a trusted synthetic WhatsApp send through the shared SendIntent owner to native commit', async () => {
    const state = await probeSyntheticSendIntent();
    assert.equal(state.found, true);
    assert.equal(state.sendInputReady, true);
    assert.equal(state.installed, true, 'isolated synthetic chat/composer must be installed before submit');
    assert.equal(state.realActiveBefore, false, 'synthetic SendIntent proof must not start from a real chat');
    assert.equal(state.owner, 'send-intent', 'interactive WhatsApp text send must terminate in the shared SendIntent owner');
    assert.equal(state.state, 'sent');
    assert.equal(state.mode, 'identity', 'default synthetic account must exercise ordinary identity-send semantics');
    assert.equal(state.textMatches, true);
    assert.equal(state.composerEmpty, true, 'native commit must clear the committed composer');
    assert.equal(state.messageSeen, true, 'native commit must advance the synthetic message surface exactly once');
    assert.equal(state.syntheticChatBound, true, 'commit must remain bound to the admitted synthetic conversation');
    assert.equal(state.error, '');
    assert.equal(state.realActiveAfter, false, 'synthetic proof must restore the unauthenticated runtime without opening a real chat');
    console.log('WA_SEND_INTENT_SYNTHETIC owner=' + state.owner + ' state=' + state.state + ' mode=' + state.mode + ' nativeCommit=true noRealChat=' + (!state.realActiveAfter));
  });
});
