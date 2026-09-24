'use strict';

const assert = require('node:assert/strict');
const { WHATSAPP_WEB_ORIGIN, classifyWhatsAppBootstrap } = require('../support/whatsapp-bootstrap-oracle.cjs');

const PARTITION = 'persist:webview-page-e2e-account-a';
const LIVE_URL = WHATSAPP_WEB_ORIGIN + '/';
const GUEST_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 45_000;
const RENDERER_PROBE_TIMEOUT_MS = 2_000;

async function probeGuest() {
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
    if (guests.length !== 1) {
      return {
        found: false,
        platform: process.platform,
        guestCount: Math.min(guests.length, 9),
        guestErrorCategory: guests.length > 1 ? 'guest-ambiguous' : 'guest-missing',
      };
    }
    const guest = guests[0];

    let timeoutId;
    const pageProbe = guest.executeJavaScript(`(() => {
      const MAX_DIAGNOSTIC_COUNT = 99;
      const MAX_TEXT_NODES = 5000;
      const MAX_VISUAL_CANDIDATES = 50;
      const LOGIN_TEXT = /scan.{0,40}qr|qr.{0,40}code|link with phone number|log into whatsapp|use whatsapp on your computer|扫描.{0,30}二维码|使用电话号码|链接电话号码/i;

      const boundedCount = (value) => Math.min(Number(value) || 0, MAX_DIAGNOSTIC_COUNT);
      const viewport = () => ({
        width: Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0),
        height: Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0),
      });
      const isRendered = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (Number.parseFloat(style.opacity || '1') <= 0.01) return false;
        const rect = element.getBoundingClientRect();
        const view = viewport();
        return rect.width >= 2 && rect.height >= 2
          && rect.right > 0 && rect.bottom > 0
          && rect.left < view.width && rect.top < view.height;
      };
      const observableAtRect = (element, rect) => {
        if (!(element instanceof Element) || !rect || rect.width < 1 || rect.height < 1) return false;
        const view = viewport();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(view.width, rect.right);
        const bottom = Math.min(view.height, rect.bottom);
        if (right <= left || bottom <= top) return false;
        const points = [
          [(left + right) / 2, (top + bottom) / 2],
          [left + Math.min((right - left) / 4, 12), top + Math.min((bottom - top) / 2, 12)],
          [right - Math.min((right - left) / 4, 12), bottom - Math.min((bottom - top) / 2, 12)],
        ];
        return points.some(([x, y]) => {
          const stack = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(x, y)
            : [document.elementFromPoint(x, y)].filter(Boolean);
          const topElement = stack.find(candidate => isRendered(candidate));
          return !!topElement && (
            topElement === element
            || element.contains(topElement)
            || topElement.contains(element)
          );
        });
      };
      const elementIsObservable = (element) => isRendered(element)
        && observableAtRect(element, element.getBoundingClientRect());

      let loginTextPresent = false;
      let loginTextVisible = false;
      let scannedTextNodes = 0;
      if (document.body) {
        const walker = document.createTreeWalker(document.body, 4);
        let node = walker.nextNode();
        while (node && scannedTextNodes < MAX_TEXT_NODES && !loginTextVisible) {
          scannedTextNodes += 1;
          const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim().slice(0, 240);
          if (text && LOGIN_TEXT.test(text)) {
            loginTextPresent = true;
            const owner = node.parentElement;
            if (owner && isRendered(owner)) {
              const range = document.createRange();
              range.selectNodeContents(node);
              const rects = Array.from(range.getClientRects()).slice(0, 8);
              loginTextVisible = rects.some(rect => observableAtRect(owner, rect));
            }
          }
          node = walker.nextNode();
        }
      }

      const looksLikeQrGeometry = (element) => {
        if (!(element instanceof Element) || !isRendered(element)) return false;
        const rect = element.getBoundingClientRect();
        const ratio = rect.height > 0 ? rect.width / rect.height : 0;
        return rect.width >= 80 && rect.height >= 80 && ratio >= 0.6 && ratio <= 1.4;
      };
      const canvasCandidates = Array.from(document.querySelectorAll('canvas')).slice(0, MAX_VISUAL_CANDIDATES);
      const dataRefCandidates = Array.from(document.querySelectorAll('[data-ref]')).slice(0, MAX_VISUAL_CANDIDATES);
      const qrCanvasPresent = canvasCandidates.some(looksLikeQrGeometry);
      const qrDataRefPresent = dataRefCandidates.some(looksLikeQrGeometry);
      const qrCanvasVisible = canvasCandidates.some(element => looksLikeQrGeometry(element) && elementIsObservable(element));
      const qrDataRefVisible = dataRefCandidates.some(element => looksLikeQrGeometry(element) && elementIsObservable(element));

      const progressElements = Array.from(document.querySelectorAll('progress,[role="progressbar"]'));
      const visibleProgressCount = progressElements.slice(0, MAX_DIAGNOSTIC_COUNT).filter(isRendered).length;
      const loginShellPresent = loginTextPresent || qrCanvasPresent || qrDataRefPresent;
      const loginShellVisible = loginTextVisible || qrCanvasVisible || qrDataRefVisible;

      return {
        rendererProbeOk: true,
        url: location.href,
        readyState: document.readyState,
        progressCount: boundedCount(progressElements.length),
        visibleProgressCount: boundedCount(visibleProgressCount),
        loginShellPresent,
        loginShellVisible,
        metaRequire: typeof window.require === 'function',
        wppPresent: !!window.WPP,
        wppInjected: window.WPP?.isInjected === true,
        wppReady: window.WPP?.isReady === true,
        waPlusPresent: !!window.WAPLUS_WPP,
        waPlusChat: !!window.WAPLUS_WPP?.chat?.sendTextMessage,
      };
    })()`, true).catch(() => ({ rendererProbeFailed: true }));
    const probeTimeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ rendererProbeTimedOut: true }), probeTimeoutMs);
    });
    const page = await Promise.race([pageProbe, probeTimeout]);
    clearTimeout(timeoutId);

    return {
      found: true,
      platform: process.platform,
      mainUrl: guest.getURL(),
      backgroundThrottling: guest.getBackgroundThrottling?.() !== false,
      ...page,
    };
  }, PARTITION, RENDERER_PROBE_TIMEOUT_MS);
}

describe('WhatsApp current Web bootstrap', () => {
  it('reaches the user-visible logged-out QR shell without a WhatsApp login', async () => {
    let state = null;
    await browser.waitUntil(async () => {
      state = await probeGuest();
      return state.found === true;
    }, {
      timeout: GUEST_TIMEOUT_MS,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    let classification = classifyWhatsAppBootstrap(state);
    try {
      await browser.waitUntil(async () => {
        state = await probeGuest();
        classification = classifyWhatsAppBootstrap(state);
        return classification.ready;
      }, {
        timeout: BOOTSTRAP_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: 'current WhatsApp Web did not reach the user-visible logged-out terminal shell',
      });
    } catch (error) {
      throw new Error(`WhatsApp bootstrap terminal-state timeout: ${JSON.stringify(classification)}`, { cause: error });
    }

    const hostSource = await browser.execute((partition) => {
      const guest = [...document.querySelectorAll('webview')].find((element) => String(element.partition || element.getAttribute('partition') || '') === partition);
      return String(guest?.getAttribute('src') || guest?.src || '');
    }, PARTITION);

    const summary = classification.summary;
    console.log(`WA_LIVE_BOOTSTRAP ${JSON.stringify({ ...summary, hostSource, reason: classification.reason })}`);
    if (summary.platform === 'win32') {
      console.log(`WA_WINDOWS_BOOTSTRAP platform=win32 guestFound=${summary.guestFound} officialWeb=${summary.officialWeb} rendererResponsive=${summary.rendererResponsive} documentComplete=${summary.documentComplete} loginShell=${summary.loginShell} terminalBlocked=${summary.terminalBlocked} loadingProgress=${summary.loadingProgress} visibleLoadingProgress=${summary.visibleLoadingProgress}`);
    }

    assert.equal(summary.guestFound, true, 'exact synthetic WhatsApp guest was not found');
    assert.equal(summary.rendererResponsive, true, `WhatsApp renderer did not respond: ${summary.rendererErrorCategory}`);
    assert.equal(summary.officialWeb, true, 'WhatsApp guest and renderer did not use current official Web bootstrap');
    assert.equal(new URL(hostSource).origin, WHATSAPP_WEB_ORIGIN, 'shell WebView src must be the official WhatsApp origin, not a retired local snapshot');
    assert.equal(state.backgroundThrottling, true, 'WhatsApp guest must keep Chromium background scheduling enabled');
    assert.equal(summary.mainOrigin, new URL(LIVE_URL).origin, 'main-process WhatsApp guest origin changed');
    assert.equal(summary.rendererOrigin, new URL(LIVE_URL).origin, 'WhatsApp renderer origin changed');
    assert.equal(summary.documentComplete, true, 'WhatsApp document did not complete loading');
    assert.equal(summary.terminalBlocked, false, `WhatsApp terminal shell exists but is not user-observable: ${JSON.stringify(summary)}`);
    assert.equal(summary.loginShell, true, `current WhatsApp Web did not expose a user-visible QR/login shell: ${JSON.stringify(summary)}`);
    assert.equal(classification.ready, true, `WhatsApp bootstrap oracle did not accept the terminal state: ${classification.reason}`);

    // These are evidence, not the startup acceptance criterion. If they regress,
    // the next repair should target the injection owner rather than the bootstrap.
    console.log(`WA_LIVE_INJECTION wppPresent=${state.wppPresent} wppInjected=${state.wppInjected} wppReady=${state.wppReady} waPlusPresent=${state.waPlusPresent} waPlusChat=${state.waPlusChat} metaRequire=${state.metaRequire}`);
  });
});
