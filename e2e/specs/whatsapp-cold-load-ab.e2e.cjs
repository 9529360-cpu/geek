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
    localScriptHtmlResponses: result.localScriptHtmlResponses,
    networkFailures: result.networkFailures,
    runtimeExceptions: result.runtimeExceptions,
  });
}

describe('WhatsApp cold-load source A/B', () => {
  it('compares Geek frozen localhost bootstrap with current official WhatsApp Web without login', async () => {
    const result = await browser.electron.execute(async (electron, partition, localUrl, liveUrl, settleMs) => {
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const leaf = String(partition).split(':').pop();
      const findGuest = () => electron.webContents.getAllWebContents().find((contents) => {
        try {
          const storagePath = String(contents.session?.storagePath || '').replace(/[\\/]+$/, '');
          const storageLeaf = storagePath.split(/[\\/]/).pop();
          return storageLeaf === leaf && !contents.isDestroyed();
        } catch {
          return false;
        }
      });

      let guest = null;
      for (let i = 0; i < 100 && !guest; i += 1) {
        guest = findGuest();
        if (!guest) await sleep(100);
      }
      if (!guest) throw new Error('WA_AB_GUEST_NOT_FOUND');

      const wasAttached = guest.debugger.isAttached();
      if (!wasAttached) await guest.debugger.attach('1.3');

      const requests = new Map();
      let phase = 'local';
      const traces = {
        local: { localScriptHtmlResponses: [], networkFailures: [], runtimeExceptions: [] },
        live: { localScriptHtmlResponses: [], networkFailures: [], runtimeExceptions: [] },
      };
      const safeUrl = (value) => {
        try {
          const url = new URL(String(value || ''));
          return { host: url.host, pathname: url.pathname.slice(0, 300) };
        } catch {
          return { host: '', pathname: '' };
        }
      };
      const onMessage = (_event, method, params = {}) => {
        const target = traces[phase];
        if (!target) return;
        if (method === 'Network.requestWillBeSent') {
          const type = String(params.type || '');
          if (!['Document', 'Script', 'Worker', 'Fetch', 'XHR', 'Manifest', 'Wasm'].includes(type)) return;
          const safe = safeUrl(params.request?.url);
          requests.set(params.requestId, { phase, type, ...safe });
          return;
        }
        if (method === 'Network.responseReceived') {
          const known = requests.get(params.requestId);
          if (!known || known.phase !== phase) return;
          const response = params.response || {};
          if (known.host === '127.0.0.1:1843' && ['Script', 'Worker', 'Manifest', 'Wasm'].includes(known.type) && /text\/html/i.test(String(response.mimeType || ''))) {
            target.localScriptHtmlResponses.push({ type: known.type, pathname: known.pathname, status: Number(response.status) || 0, mimeType: String(response.mimeType || '').slice(0, 80) });
          }
          return;
        }
        if (method === 'Network.loadingFailed') {
          const known = requests.get(params.requestId);
          if (!known || known.phase !== phase) return;
          target.networkFailures.push({ type: known.type, host: known.host, pathname: known.pathname, error: String(params.errorText || '').slice(0, 120) });
          requests.delete(params.requestId);
          return;
        }
        if (method === 'Network.loadingFinished') {
          requests.delete(params.requestId);
          return;
        }
        if (method === 'Runtime.exceptionThrown') {
          const details = params.exceptionDetails || {};
          const description = String(details.exception?.description || details.text || '');
          let category = 'OTHER';
          if (/ChunkLoadError|Loading chunk|dynamically imported module/i.test(description)) category = 'CHUNK_LOAD';
          else if (/SyntaxError/i.test(description)) category = 'SYNTAX';
          else if (/ReferenceError/i.test(description)) category = 'REFERENCE';
          else if (/TypeError/i.test(description)) category = 'TYPE';
          else if (/NetworkError|Failed to fetch/i.test(description)) category = 'NETWORK';
          target.runtimeExceptions.push(category);
        }
      };

      guest.debugger.on('message', onMessage);
      try {
        await guest.debugger.sendCommand('Network.enable');
        await guest.debugger.sendCommand('Runtime.enable');

        const snapshot = async () => guest.executeJavaScript(`(() => {
          const text = String(document.body?.innerText || '').slice(0, 4000);
          const loginHint = /scan.{0,30}qr|qr.{0,30}code|link with phone number|log into whatsapp|扫描.{0,20}二维码|使用电话号码|链接电话号码/i.test(text);
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

        // A: the exact Geek bootstrap used by the failing client.
        if (!String(guest.getURL()).startsWith(localUrl)) await guest.loadURL(localUrl);
        phase = 'local';
        requests.clear();
        await sleep(settleMs);
        const local = { ...(await snapshot()), ...traces.local };

        // B: same Electron guest, same persistent partition, same Chromium runtime;
        // only change the source from Geek's frozen localhost HTML to official WA Web.
        phase = 'live';
        requests.clear();
        await guest.loadURL(liveUrl);
        await sleep(settleMs);
        const live = { ...(await snapshot()), ...traces.live };

        // Restore the real product source for later E2E specs sharing this process.
        phase = 'restore';
        await guest.loadURL(localUrl);
        return { local, live };
      } finally {
        guest.debugger.removeListener('message', onMessage);
        if (!wasAttached && guest.debugger.isAttached()) guest.debugger.detach();
      }
    }, PARTITION, LOCAL_URL, LIVE_URL, SETTLE_MS);

    console.log(`WA_COLD_AB_LOCAL ${summarize(result.local)}`);
    console.log(`WA_COLD_AB_LIVE ${summarize(result.live)}`);

    assert.equal(result.local.url.startsWith(LOCAL_URL), true, 'local arm did not exercise Geek frozen bootstrap');
    assert.equal(result.live.url.startsWith(LIVE_URL), true, 'live arm did not exercise official WhatsApp Web');

    const localLooksLoggedOut = result.local.loginHint || result.local.qrCanvas > 0 || result.local.qrDataRef > 0;
    const liveLooksLoggedOut = result.live.loginHint || result.live.qrCanvas > 0 || result.live.qrDataRef > 0;
    console.log(`WA_COLD_AB_RESULT localLoginShell=${localLooksLoggedOut} liveLoginShell=${liveLooksLoggedOut} localProgress=${result.local.progressCount} liveProgress=${result.live.progressCount} localhostWrongMime=${result.local.localScriptHtmlResponses.length}`);

    // The official arm is the control: hosted CI must be able to reach the logged-out
    // WhatsApp shell for this A/B to be meaningful. The local arm is intentionally not
    // asserted yet: its observed state is the diagnostic result we need.
    assert.equal(liveLooksLoggedOut, true, `official WhatsApp Web did not reach a logged-out/QR shell: ${summarize(result.live)}`);
  });
});
