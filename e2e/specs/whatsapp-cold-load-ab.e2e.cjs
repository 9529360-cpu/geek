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

async function startLocalNetworkTrace() {
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

    const key = '__geekWaColdLoadTrace';
    const previous = globalThis[key];
    if (previous?.guest?.debugger && previous.listener) {
      try { previous.guest.debugger.removeListener('message', previous.listener); } catch {}
      if (previous.attachedByProbe) {
        try { previous.guest.debugger.detach(); } catch {}
      }
    }

    const wasAttached = guest.debugger.isAttached();
    if (!wasAttached) await guest.debugger.attach('1.3');
    const state = {
      guest,
      attachedByProbe: !wasAttached,
      requests: new Map(),
      responses: {},
      badResponses: [],
      failures: [],
      exceptions: {},
      listener: null,
    };
    const safeUrl = (value) => {
      try {
        const url = new URL(String(value || ''));
        return { host: url.host, pathname: url.pathname.slice(0, 300) };
      } catch {
        return { host: '', pathname: '' };
      }
    };
    const interestingType = (type) => ['Document', 'Script', 'Worker', 'Fetch', 'XHR', 'Manifest', 'Wasm'].includes(type);
    const interestingHost = (host) => host === '127.0.0.1:1843' || host === 'static.whatsapp.net' || host === 'web.whatsapp.com';
    state.listener = (_event, method, params = {}) => {
      if (method === 'Network.requestWillBeSent') {
        const type = String(params.type || '');
        const parts = safeUrl(params.request?.url);
        if (interestingType(type) && interestingHost(parts.host)) {
          state.requests.set(params.requestId, { type, ...parts });
        }
        return;
      }
      if (method === 'Network.responseReceived') {
        const type = String(params.type || '');
        const parts = safeUrl(params.response?.url);
        if (!interestingType(type) || !interestingHost(parts.host)) return;
        const status = Number(params.response?.status) || 0;
        const mimeType = String(params.response?.mimeType || '').slice(0, 80);
        const bucket = `${parts.host}|${type}|${status}|${mimeType}`;
        state.responses[bucket] = (state.responses[bucket] || 0) + 1;
        const executable = ['Script', 'Worker', 'Manifest', 'Wasm'].includes(type);
        if (status >= 400 || (parts.host === '127.0.0.1:1843' && executable && /text\/html/i.test(mimeType))) {
          if (state.badResponses.length < 30) state.badResponses.push({ type, host: parts.host, pathname: parts.pathname, status, mimeType });
        }
        return;
      }
      if (method === 'Network.loadingFailed') {
        const request = state.requests.get(params.requestId);
        if (request && state.failures.length < 30) {
          state.failures.push({ ...request, error: String(params.errorText || '').slice(0, 120), blockedReason: String(params.blockedReason || '').slice(0, 80) });
        }
        state.requests.delete(params.requestId);
        return;
      }
      if (method === 'Network.loadingFinished') {
        state.requests.delete(params.requestId);
        return;
      }
      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails || {};
        const text = String(details.exception?.description || details.text || '');
        let category = 'OTHER';
        if (/ChunkLoadError|Loading chunk|dynamically imported module/i.test(text)) category = 'CHUNK_LOAD';
        else if (/SyntaxError/i.test(text)) category = 'SYNTAX';
        else if (/ReferenceError/i.test(text)) category = 'REFERENCE';
        else if (/TypeError/i.test(text)) category = 'TYPE';
        else if (/NetworkError|Failed to fetch/i.test(text)) category = 'NETWORK';
        state.exceptions[category] = (state.exceptions[category] || 0) + 1;
      }
    };
    guest.debugger.on('message', state.listener);
    await guest.debugger.sendCommand('Network.enable');
    await guest.debugger.sendCommand('Runtime.enable');
    globalThis[key] = state;
    return { found: true, attachedByProbe: state.attachedByProbe };
  }, PARTITION);
}

async function finishLocalNetworkTrace() {
  return browser.electron.execute((electron) => {
    const key = '__geekWaColdLoadTrace';
    const state = globalThis[key];
    if (!state) return { found: false, responses: {}, badResponses: [], failures: [], exceptions: {} };
    try { state.guest.debugger.removeListener('message', state.listener); } catch {}
    if (state.attachedByProbe) {
      try { state.guest.debugger.detach(); } catch {}
    }
    const result = {
      found: true,
      responses: state.responses,
      badResponses: state.badResponses,
      failures: state.failures,
      exceptions: state.exceptions,
    };
    delete globalThis[key];
    return result;
  });
}

describe('WhatsApp cold-load source A/B', () => {
  it('compares Geek frozen localhost bootstrap with current official WhatsApp Web without login', async () => {
    await browser.waitUntil(async () => (await findGuestState()).found === true, {
      timeout: 10_000,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    const traceStart = await startLocalNetworkTrace();
    assert.equal(traceStart.found, true, 'network trace guest missing');

    const localStart = await startNavigation(LOCAL_URL);
    assert.equal(localStart.found, true, 'local arm guest missing');
    await browser.pause(SETTLE_MS);
    const local = await findGuestState();
    const localTrace = await finishLocalNetworkTrace();
    console.log(`WA_COLD_AB_LOCAL ${summarize(local)}`);
    console.log(`WA_COLD_AB_LOCAL_NETWORK ${JSON.stringify(localTrace)}`);

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
