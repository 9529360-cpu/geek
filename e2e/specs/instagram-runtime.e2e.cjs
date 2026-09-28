'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_NAME = 'E2E Instagram Runtime';
const SYNTHETIC_THREAD = '/direct/t/geek-e2e-synthetic-thread';
const SYNTHETIC_TEXT = 'geek-instagram-send-intent-synthetic';
const READY_TIMEOUT_MS = 30_000;

async function addInstagramAccount() {
  const result = await browser.executeAsync((name, done) => {
    (async () => {
      const added = await window.api.accounts.add({ name, type: 'instagram' });
      const state = await window.api.accounts.list();
      const account = state.accounts.find(item => item.type === 'instagram' && item.name === name)
        || added?.account
        || null;
      done(account ? { id: account.id, partition: account.partition, url: account.url } : { error: 'ACCOUNT_NOT_CREATED' });
    })().catch(error => done({ error: String(error?.message || error || 'ACCOUNT_ADD_FAILED') }));
  }, ACCOUNT_NAME);
  assert.equal(result?.error, undefined, result?.error || 'Instagram account creation failed');
  assert.ok(result?.id);
  assert.equal(result.partition, 'persist:webview-page-' + result.id);
  assert.equal(result.url, 'https://www.instagram.com/direct/inbox/');
  await browser.refresh();
  return result;
}

async function waitInstagramWebview(partition) {
  await browser.waitUntil(async () => browser.execute((expectedPartition) => {
    return Array.from(document.querySelectorAll('webview')).some(
      item => String(item.partition || item.getAttribute?.('partition') || '') === expectedPartition,
    );
  }, partition), {
    timeout: READY_TIMEOUT_MS,
    interval: 250,
    timeoutMsg: 'Instagram WebView partition did not appear',
  });
  const state = await browser.execute((expectedPartition) => {
    const webview = Array.from(document.querySelectorAll('webview')).find(
      item => String(item.partition || item.getAttribute?.('partition') || '') === expectedPartition,
    ) || null;
    if (!webview) return { found: false, src: '', currentUrl: '' };
    let currentUrl = '';
    try { currentUrl = String(webview.getURL?.() || ''); } catch {}
    return {
      found: true,
      src: String(webview.getAttribute('src') || webview.src || ''),
      currentUrl,
    };
  }, partition);
  assert.equal(state.found, true);
  assert.match(state.currentUrl || state.src, /^https:\/\/(?:www\.)?instagram\.com\//, 'Instagram runtime must stay on an Instagram origin even when logged out');
  return state;
}

async function probeSyntheticSend(partition, accountId) {
  return browser.execute(async (expectedPartition, expectedAccountId, threadId, messageText) => {
    const webview = Array.from(document.querySelectorAll('webview')).find(
      item => String(item.partition || item.getAttribute?.('partition') || '') === expectedPartition,
    ) || null;
    if (!webview) return { found: false };

    let trustedSubmit = null;
    const onIpcMessage = event => {
      if (event?.channel !== 'geek-trusted-submit') return;
      const payload = event.args?.[0];
      if (payload?.platform !== 'instagram') return;
      trustedSubmit = {
        platform: String(payload.platform || ''),
        kind: String(payload.kind || ''),
        generation: Number(payload.composerGeneration || 0),
      };
    };
    webview.addEventListener('ipc-message', onIpcMessage);

    const installSynthetic = (syntheticThread, syntheticText) => {
      try { window.__geekE2EInstagramSynthetic?.cleanup?.(); } catch {}
      const previousPath = String(location.pathname || '/direct/inbox/');
      const previousRequest = window.__geekTranslationRequest;
      document.querySelector('[data-geek-e2e-instagram-main]')?.remove();

      try { history.replaceState(history.state, '', syntheticThread); }
      catch { return { installed: false, reason: 'HISTORY_FAILED' }; }

      const main = document.createElement('div');
      main.setAttribute('role', 'main');
      main.setAttribute('data-geek-e2e-instagram-main', '1');
      const region = document.createElement('div');
      region.setAttribute('role', 'region');
      const log = document.createElement('div');
      log.setAttribute('role', 'log');
      log.setAttribute('data-scope', 'messages_table');
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('data-geek-e2e-instagram-composer', '1');
      editor.replaceChildren(document.createTextNode(syntheticText));
      editor.style.cssText = 'position:fixed;left:1px;top:1px;width:40px;height:20px;z-index:2147483647;';
      region.appendChild(editor);
      main.appendChild(log);
      main.appendChild(region);
      document.body.appendChild(main);

      window.__geekE2EInstagramOutcome = null;
      if (typeof previousRequest === 'function') {
        const wrappedRequest = async function (payload) {
          try {
            const result = await previousRequest.call(this, payload);
            window.__geekE2EInstagramOutcome = {
              owner: String(result?.delivery?.owner || ''),
              state: String(result?.delivery?.state || ''),
              mode: String(result?.mode || ''),
              textMatches: String(result?.text || '') === syntheticText,
              error: '',
            };
            return result;
          } catch (error) {
            window.__geekE2EInstagramOutcome = {
              owner: '',
              state: '',
              mode: '',
              textMatches: false,
              error: String(error?.message || error || '').slice(0, 120),
            };
            throw error;
          }
        };
        window.__geekTranslationRequest = wrappedRequest;
      }

      const commitHandler = event => {
        if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') !== '1') return;
        if (event?.isTrusted !== true || event.key !== 'Enter') return;
        if (!event.target?.closest?.('[data-geek-e2e-instagram-composer]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        editor.replaceChildren();
        const row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.setAttribute('data-geek-e2e-instagram-message', '1');
        row.textContent = syntheticText;
        log.appendChild(row);
      };
      document.addEventListener('keydown', commitHandler, true);

      const cleanup = () => {
        try { document.removeEventListener('keydown', commitHandler, true); } catch {}
        try { main.remove(); } catch {}
        try { window.__geekTranslationRequest = previousRequest; } catch {}
        try { history.replaceState(history.state, '', previousPath); } catch {}
        try { delete window.__geekE2EInstagramOutcome; delete window.__geekE2EInstagramSynthetic; } catch {}
        return true;
      };
      window.__geekE2EInstagramSynthetic = { cleanup };
      editor.focus();
      return {
        installed: document.activeElement === editor,
        requestReady: typeof previousRequest === 'function',
        controllerVersion: Number(window.__geekInstagramSendIntentController?.version || 0),
        controllerActive: window.__geekInstagramSendIntentController?.active === true,
        bridgeReady: typeof window.__geekTranslationRequest === 'function'
          && typeof window.__geekTranslationBridgeToken === 'string'
          && window.__geekTranslationBridgeToken.length > 0,
        pathMatches: String(location.pathname || '') === syntheticThread,
      };
    };

    const readState = () => {
      const editor = document.querySelector('[data-geek-e2e-instagram-composer]');
      return {
        outcome: window.__geekE2EInstagramOutcome || null,
        composerEmpty: !!editor && editor.childNodes.length === 0,
        messageSeen: document.querySelectorAll('[data-geek-e2e-instagram-message]').length === 1,
        marker: document.documentElement?.getAttribute?.('data-geek-native-submit-commit') || '',
        path: String(location.pathname || ''),
      };
    };

    const cleanupSynthetic = () => {
      try { return window.__geekE2EInstagramSynthetic?.cleanup?.() === true; } catch { return false; }
    };

    try {
      webview.focus();
      const expression = '(' + installSynthetic.toString() + ')('
        + JSON.stringify(threadId) + ',' + JSON.stringify(messageText) + ')';
      const installed = await webview.executeJavaScript(expression, true);
      if (!installed?.installed || !installed?.requestReady || !installed?.bridgeReady || !installed?.pathMatches) {
        return { found: true, installed: false, installState: installed || null };
      }

      const bridgeToken = await webview.executeJavaScript("String(window.__geekTranslationBridgeToken || '')", true);
      const clearResult = await window.api.webviewInput.clearText(
        expectedAccountId,
        webview.getWebContentsId(),
        bridgeToken,
        threadId,
      );
      const clearedText = await webview.executeJavaScript(
        "String(document.querySelector('[data-geek-e2e-instagram-composer]')?.innerText || document.querySelector('[data-geek-e2e-instagram-composer]')?.textContent || '').replace(/\\u200b/g,'').trim()",
        true,
      );
      if (clearResult !== 'CLEARED' || clearedText !== '') {
        return { found: true, installed: true, nativeClear: false, clearResult, clearedText };
      }
      const insertResult = await window.api.webviewInput.insertText(
        expectedAccountId,
        webview.getWebContentsId(),
        messageText,
        bridgeToken,
        threadId,
      );
      const restoredText = await webview.executeJavaScript(
        "String(document.querySelector('[data-geek-e2e-instagram-composer]')?.innerText || document.querySelector('[data-geek-e2e-instagram-composer]')?.textContent || '').replace(/\\u200b/g,'').trim()",
        true,
      );
      if (insertResult !== true || restoredText !== messageText) {
        return { found: true, installed: true, nativeClear: true, nativeRestore: false, insertResult, restoredText };
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
        installed: true,
        controllerVersion: Number(installed.controllerVersion || 0),
        controllerActive: installed.controllerActive === true,
        nativeClear: true,
        nativeRestore: true,
        clearResult,
        trustedSubmitSeen: !!trustedSubmit,
        trustedPlatform: trustedSubmit?.platform || '',
        trustedKind: trustedSubmit?.kind || '',
        trustedGeneration: Number(trustedSubmit?.generation || 0),
        owner: String(state?.outcome?.owner || ''),
        state: String(state?.outcome?.state || ''),
        mode: String(state?.outcome?.mode || ''),
        textMatches: state?.outcome?.textMatches === true,
        error: String(state?.outcome?.error || ''),
        composerEmpty: state?.composerEmpty === true,
        messageSeen: state?.messageSeen === true,
        markerCleared: String(state?.marker || '') === '',
        syntheticPathBound: state?.path === threadId,
      };
    } finally {
      webview.removeEventListener('ipc-message', onIpcMessage);
      await webview.executeJavaScript('(' + cleanupSynthetic.toString() + ')()', true).catch(() => false);
    }
  }, partition, accountId, SYNTHETIC_THREAD, SYNTHETIC_TEXT);
}

async function removeInstagramAccount(id) {
  await browser.setTimeout({ script: 15_000 });
  return browser.executeAsync((accountId, done) => {
    window.api.accounts.remove(accountId)
      .then(() => window.api.accounts.list())
      .then(state => done({ instagramCount: state.accounts.filter(account => account.type === 'instagram').length }))
      .catch(error => done({ error: String(error?.message || error || 'ACCOUNT_REMOVE_FAILED') }));
  }, id);
}

describe('Instagram synthetic SendIntent runtime', () => {
  it('routes trusted native input through the shared SendIntent owner without a real message', async () => {
    const account = await addInstagramAccount();
    try {
      await waitInstagramWebview(account.partition);
      const guestReadyExpression = "(() => ({ready:document.readyState!=='loading',controllerVersion:Number(window.__geekInstagramSendIntentController?.version||0),controllerActive:window.__geekInstagramSendIntentController?.active===true,bridgeReady:typeof window.__geekTranslationRequest==='function'&&typeof window.__geekTranslationBridgeToken==='string'&&window.__geekTranslationBridgeToken.length>0}))()";
      await browser.waitUntil(async () => {
        const state = await browser.execute(async (expectedPartition, expression) => {
          const webview = Array.from(document.querySelectorAll('webview')).find(
            item => String(item.partition || item.getAttribute?.('partition') || '') === expectedPartition,
          ) || null;
          if (!webview) return { ready: false };
          return webview.executeJavaScript(expression, true).catch(() => ({ ready: false }));
        }, account.partition, guestReadyExpression);
        return state?.ready === true && state?.controllerVersion === 1 && state?.controllerActive === true && state?.bridgeReady === true;
      }, {
        timeout: READY_TIMEOUT_MS,
        interval: 300,
        timeoutMsg: 'Instagram bridge/controller did not become ready in the isolated WebView',
      });

      const state = await probeSyntheticSend(account.partition, account.id);
      assert.equal(state.found, true);
      assert.equal(state.installed, true);
      assert.equal(state.controllerVersion, 1);
      assert.equal(state.controllerActive, true);
      assert.equal(state.nativeClear, true, 'controlled Instagram composer must clear through the bounded main-process native owner');
      assert.equal(state.nativeRestore, true, 'synthetic composer must be restored through the same bounded native input owner before submit');
      assert.equal(state.clearResult, 'CLEARED');
      assert.equal(state.trustedSubmitSeen, true, 'native WebView Enter must reach the Instagram trusted-submit preload');
      assert.equal(state.trustedPlatform, 'instagram');
      assert.equal(state.trustedKind, 'keyboard');
      assert.ok(state.trustedGeneration >= 1);
      assert.equal(state.owner, 'send-intent');
      assert.equal(state.state, 'sent');
      assert.equal(state.mode, 'identity');
      assert.equal(state.textMatches, true);
      assert.equal(state.composerEmpty, true);
      assert.equal(state.messageSeen, true);
      assert.equal(state.markerCleared, true);
      assert.equal(state.syntheticPathBound, true);
      assert.equal(state.error, '');
      console.log('INSTAGRAM_SEND_INTENT_SYNTHETIC trusted=true owner=' + state.owner + ' state=' + state.state + ' mode=' + state.mode + ' nativeClear=true nativeCommit=true noRealMessage=true');
    } finally {
      const cleanup = await removeInstagramAccount(account.id);
      assert.equal(cleanup?.error, undefined, cleanup?.error || 'Instagram E2E cleanup failed');
      assert.equal(cleanup?.instagramCount, 0);
    }
  });
});
