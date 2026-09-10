'use strict';

const path = require('node:path');
const { createDiagnostics } = require('./diagnostics.cjs');
const { isNavigationAllowed } = require('./webview-navigation-boundary.cjs');

const DEFAULT_PROBE_DELAYS = Object.freeze([0, 1000, 3000, 8000, 15000]);
const attachedContents = new WeakSet();

const WA_PROBE_SOURCE = String.raw`(async () => {
  const W = window.WPP;
  let connMainReady = null;
  let storagePersisted = null;
  let serviceWorkerRegistrations = null;
  let metaModuleCount = null;
  try {
    if (W?.conn && typeof W.conn.isMainReady === 'function') connMainReady = !!W.conn.isMainReady();
  } catch {}
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      storagePersisted = await navigator.storage.persisted();
    }
  } catch {}
  try {
    if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
      serviceWorkerRegistrations = (await navigator.serviceWorker.getRegistrations()).length;
    }
  } catch {}
  try {
    if (typeof window.require === 'function') {
      const debugModule = window.require('__debug');
      const modulesMap = debugModule && debugModule.modulesMap;
      if (modulesMap && typeof modulesMap === 'object') metaModuleCount = Object.keys(modulesMap).length;
    }
  } catch {}
  let localStorageLength = null;
  try { localStorageLength = localStorage.length; } catch {}
  return {
    readyState: String(document.readyState || ''),
    secureContext: window.isSecureContext === true,
    metaRequirePresent: typeof window.require === 'function',
    metaDefinePresent: typeof window.__d === 'function',
    metaModuleCount,
    wppPresent: !!W,
    wppInjected: W?.isInjected === true,
    wppReady: W?.isReady === true,
    wppFullReady: W?.isFullReady === true,
    connMainReady,
    waPlusPresent: !!window.WAPLUS_WPP,
    chatApiPresent: typeof window.WAPLUS_WPP?.chat?.sendTextMessage === 'function',
    bridgeReady: document.documentElement?.getAttribute('data-geek-bridge') === '1',
    storagePersistApi: typeof navigator.storage?.persisted === 'function',
    storagePersisted,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    serviceWorkerRegistrations,
    indexedDbSupported: !!window.indexedDB,
    localStorageLength
  };
})()`;

function classifyConsoleMessage(message) {
  const value = String(message || '');
  if (/Module\s+.+\s+(?:was\s+)?not\s+found/i.test(value) || /module not found/i.test(value)) return 'MODULE_NOT_FOUND';
  if (/Cannot read properties of undefined.*reading ['"]on['"]/i.test(value)) return 'UNDEFINED_ON';
  if (/ChunkLoadError|Loading chunk\s+.+\s+failed/i.test(value)) return 'CHUNK_LOAD_FAILED';
  if (/Failed to fetch|NetworkError|ERR_[A-Z_]+/i.test(value)) return 'NETWORK_ERROR';
  if (/uncaught|unhandledrejection/i.test(value)) return 'UNCAUGHT_ERROR';
  return '';
}

function normalizeProbe(result) {
  if (!result || typeof result !== 'object') return null;
  const boolOrNull = (value) => value === true ? true : value === false ? false : null;
  const countOrNull = (value) => Number.isInteger(value) && value >= 0 && value <= 1000000 ? value : null;
  const readyState = ['loading', 'interactive', 'complete'].includes(result.readyState) ? result.readyState : 'unknown';
  return Object.freeze({
    readyState,
    secureContext: result.secureContext === true,
    metaRequirePresent: result.metaRequirePresent === true,
    metaDefinePresent: result.metaDefinePresent === true,
    metaModuleCount: countOrNull(result.metaModuleCount),
    wppPresent: result.wppPresent === true,
    wppInjected: result.wppInjected === true,
    wppReady: result.wppReady === true,
    wppFullReady: result.wppFullReady === true,
    connMainReady: boolOrNull(result.connMainReady),
    waPlusPresent: result.waPlusPresent === true,
    chatApiPresent: result.chatApiPresent === true,
    bridgeReady: result.bridgeReady === true,
    storagePersistApi: result.storagePersistApi === true,
    storagePersisted: boolOrNull(result.storagePersisted),
    serviceWorkerSupported: result.serviceWorkerSupported === true,
    serviceWorkerControlled: result.serviceWorkerControlled === true,
    serviceWorkerRegistrations: countOrNull(result.serviceWorkerRegistrations),
    indexedDbSupported: result.indexedDbSupported === true,
    localStorageLength: countOrNull(result.localStorageLength),
  });
}

function installWhatsAppStartupDiagnostics({
  app,
  getUserDataDir,
  resolvePolicyForPartition,
  probeDelays = DEFAULT_PROBE_DELAYS,
  createDiagnosticsFn = createDiagnostics,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app.on is required');
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');
  if (typeof resolvePolicyForPartition !== 'function') throw new TypeError('resolvePolicyForPartition is required');

  const diagnostics = createDiagnosticsFn({
    dir: path.join(getUserDataDir(), 'diagnostics', 'wa-startup'),
    maxBytes: 512 * 1024,
    maxFiles: 3,
  });

  function scopeFor(contents) {
    try {
      if (!contents || contents.isDestroyed?.()) return null;
      const partition = String(contents.session?.partition || '');
      if (!partition.startsWith('persist:webview-page-')) return null;
      const policy = resolvePolicyForPartition(partition);
      if (!policy || policy.kind !== 'whatsapp') return null;
      const url = String(contents.getURL?.() || '');
      if (!isNavigationAllowed(policy, url)) return null;
      const parsed = new URL(url);
      return { partition, origin: parsed.origin };
    } catch {
      return null;
    }
  }

  function attach(contents) {
    if (!contents || attachedContents.has(contents)) return;
    attachedContents.add(contents);

    let generation = 0;
    const timers = new Set();
    const clearTimers = () => {
      for (const timer of timers) clearTimeoutFn(timer);
      timers.clear();
    };

    contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame === false) return;
      generation += 1;
      clearTimers();
      const scope = scopeFor(contents);
      if (scope) diagnostics.log('wa-startup-navigation', { origin: scope.origin, generation });
    });

    contents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame === false) return;
      const scope = scopeFor(contents);
      if (scope) diagnostics.log('wa-startup-load-failed', { origin: scope.origin, generation, errorCode });
    });

    contents.on('console-message', (_event, _level, message) => {
      const category = classifyConsoleMessage(message);
      if (!category) return;
      const scope = scopeFor(contents);
      if (scope) diagnostics.log('wa-startup-console-error', { origin: scope.origin, generation, category });
    });

    contents.on('render-process-gone', (_event, details) => {
      const scope = scopeFor(contents);
      if (scope) diagnostics.log('wa-startup-render-gone', {
        origin: scope.origin,
        generation,
        reason: String(details?.reason || 'unknown').slice(0, 40),
      });
      generation += 1;
      clearTimers();
    });

    contents.on('destroyed', () => {
      generation += 1;
      clearTimers();
    });

    contents.on('did-finish-load', () => {
      const scope = scopeFor(contents);
      if (!scope) return;
      const probeGeneration = generation;
      diagnostics.log('wa-startup-load-finished', { origin: scope.origin, generation: probeGeneration });

      for (const delay of probeDelays) {
        const timer = setTimeoutFn(async () => {
          timers.delete(timer);
          if (generation !== probeGeneration || contents.isDestroyed?.()) return;
          const freshScope = scopeFor(contents);
          if (!freshScope || freshScope.origin !== scope.origin) return;
          try {
            const raw = await contents.executeJavaScript(WA_PROBE_SOURCE, true);
            if (generation !== probeGeneration || contents.isDestroyed?.()) return;
            const normalized = normalizeProbe(raw);
            if (!normalized) return;
            diagnostics.log('wa-startup-probe', {
              origin: freshScope.origin,
              generation: probeGeneration,
              delayMs: delay,
              ...normalized,
            });
          } catch (error) {
            if (generation !== probeGeneration) return;
            diagnostics.log('wa-startup-probe-failed', {
              origin: freshScope.origin,
              generation: probeGeneration,
              delayMs: delay,
              category: String(error?.name || 'EXECUTE_FAILED').slice(0, 40),
            });
          }
        }, delay);
        timers.add(timer);
      }
    });
  }

  app.on('web-contents-created', (_event, contents) => attach(contents));
  return Object.freeze({ attach });
}

module.exports = {
  DEFAULT_PROBE_DELAYS,
  WA_PROBE_SOURCE,
  classifyConsoleMessage,
  normalizeProbe,
  installWhatsAppStartupDiagnostics,
};
