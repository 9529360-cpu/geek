'use strict';

const path = require('node:path');
const { createDiagnostics } = require('./diagnostics.cjs');
const { isNavigationAllowed } = require('./webview-navigation-boundary.cjs');

const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';
const TRACE_HOSTS = new Set(['127.0.0.1', 'static.whatsapp.net', 'web.whatsapp.com']);
const TRACE_TYPES = new Set(['Document', 'Script', 'Stylesheet', 'Worker', 'Fetch', 'XHR', 'Manifest', 'Wasm']);

function safeUrlParts(value) {
  try {
    const url = new URL(String(value || ''));
    return {
      origin: url.origin,
      host: url.host,
      pathname: url.pathname.slice(0, 500),
    };
  } catch {
    return { origin: '', host: '', pathname: '' };
  }
}

function shouldTraceRequest(url, type) {
  const parts = safeUrlParts(url);
  return TRACE_HOSTS.has(parts.host) && TRACE_TYPES.has(String(type || ''));
}

function classifyRuntimeException(description) {
  const value = String(description || '');
  if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(value)) return 'CHUNK_LOAD';
  if (/SyntaxError/i.test(value)) return 'SYNTAX';
  if (/ReferenceError/i.test(value)) return 'REFERENCE';
  if (/TypeError/i.test(value)) return 'TYPE';
  if (/NetworkError|Failed to fetch/i.test(value)) return 'NETWORK';
  return 'OTHER';
}

function accountPartition(contents) {
  try {
    const partition = String(contents?.session?.partition || '');
    return partition.startsWith(ACCOUNT_PARTITION_PREFIX) ? partition : '';
  } catch {
    return '';
  }
}

function installWhatsAppBrowserChainDiagnostics({
  app,
  userDataDir,
  resolvePolicyForPartition,
  diagnosticsFactory = createDiagnostics,
} = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app.on is required');
  if (typeof resolvePolicyForPartition !== 'function') throw new TypeError('resolvePolicyForPartition is required');

  const log = diagnosticsFactory({
    dir: path.join(userDataDir, 'diagnostics', 'wa-browser'),
    maxBytes: 5 * 1024 * 1024,
    maxFiles: 5,
  });
  const attached = new WeakSet();

  app.on('web-contents-created', (_event, contents) => {
    if (!contents || attached.has(contents)) return;
    const partition = accountPartition(contents);
    if (!partition) return;

    let policy = null;
    try { policy = resolvePolicyForPartition(partition) || null; } catch { policy = null; }
    if (!policy || policy.kind !== 'whatsapp') return;
    attached.add(contents);

    const requests = new Map();
    let generation = 0;
    let debuggerOwned = false;

    const scopeAllowed = () => {
      try { return isNavigationAllowed(policy, contents.getURL()); } catch { return false; }
    };

    const write = (event, metadata = {}) => {
      if (!scopeAllowed() && event !== 'wa-browser-navigation') return;
      log.log(event, { generation, ...metadata });
    };

    const onDebuggerMessage = (_event, method, params = {}) => {
      if (method === 'Network.requestWillBeSent') {
        const url = params.request?.url;
        const type = String(params.type || '');
        if (!shouldTraceRequest(url, type)) return;
        const safe = safeUrlParts(url);
        requests.set(params.requestId, { type, ...safe });
        write('wa-browser-request', { type, host: safe.host, pathname: safe.pathname });
        return;
      }

      if (method === 'Network.responseReceived') {
        const known = requests.get(params.requestId);
        if (!known) return;
        const response = params.response || {};
        write('wa-browser-response', {
          type: known.type,
          host: known.host,
          pathname: known.pathname,
          status: Number(response.status) || 0,
          mimeType: String(response.mimeType || '').slice(0, 120),
          fromDiskCache: response.fromDiskCache === true,
          fromServiceWorker: response.fromServiceWorker === true,
        });
        return;
      }

      if (method === 'Network.loadingFailed') {
        const known = requests.get(params.requestId);
        if (!known) return;
        write('wa-browser-loading-failed', {
          type: known.type,
          host: known.host,
          pathname: known.pathname,
          errorCode: String(params.errorText || '').slice(0, 160),
          canceled: params.canceled === true,
          blockedReason: String(params.blockedReason || '').slice(0, 80),
        });
        requests.delete(params.requestId);
        return;
      }

      if (method === 'Network.loadingFinished') {
        requests.delete(params.requestId);
        return;
      }

      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails || {};
        const description = details.exception?.description || details.text || '';
        const frame = details.stackTrace?.callFrames?.[0];
        const safe = safeUrlParts(frame?.url || details.url || '');
        write('wa-browser-runtime-exception', {
          category: classifyRuntimeException(description),
          host: safe.host,
          pathname: safe.pathname,
          line: Number(details.lineNumber) || 0,
          column: Number(details.columnNumber) || 0,
        });
        return;
      }

      if (method === 'ServiceWorker.workerRegistrationUpdated') {
        for (const registration of params.registrations || []) {
          const safe = safeUrlParts(registration.scopeURL || '');
          if (!TRACE_HOSTS.has(safe.host)) continue;
          write('wa-browser-sw-registration', {
            host: safe.host,
            pathname: safe.pathname,
            deleted: registration.isDeleted === true,
          });
        }
        return;
      }

      if (method === 'ServiceWorker.workerVersionUpdated') {
        for (const version of params.versions || []) {
          const safe = safeUrlParts(version.scriptURL || '');
          if (!TRACE_HOSTS.has(safe.host)) continue;
          write('wa-browser-sw-version', {
            host: safe.host,
            pathname: safe.pathname,
            status: String(version.status || '').slice(0, 80),
            runningStatus: String(version.runningStatus || '').slice(0, 80),
          });
        }
        return;
      }

      if (method === 'ServiceWorker.workerErrorReported') {
        const info = params.errorMessage || {};
        const safe = safeUrlParts(info.sourceURL || '');
        write('wa-browser-sw-error', {
          host: safe.host,
          pathname: safe.pathname,
          line: Number(info.lineNumber) || 0,
          column: Number(info.columnNumber) || 0,
        });
      }
    };

    async function attachDebugger() {
      try {
        if (!contents.debugger?.isAttached?.()) {
          await contents.debugger.attach('1.3');
          debuggerOwned = true;
        }
        contents.debugger.addListener('message', onDebuggerMessage);
        await contents.debugger.sendCommand('Network.enable');
        await contents.debugger.sendCommand('Runtime.enable');
        await contents.debugger.sendCommand('ServiceWorker.enable').catch(() => null);
        write('wa-browser-debugger-attached', { attached: true });
      } catch (error) {
        write('wa-browser-debugger-failed', {
          errorCode: String(error?.code || error?.name || 'ATTACH_FAILED').slice(0, 80),
        });
      }
    }

    function detachDebugger() {
      try { contents.debugger?.removeListener?.('message', onDebuggerMessage); } catch {}
      if (debuggerOwned) {
        try { contents.debugger?.detach?.(); } catch {}
      }
      debuggerOwned = false;
      requests.clear();
    }

    contents.on?.('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame === false) return;
      generation += 1;
      requests.clear();
      const safe = safeUrlParts(typeof url === 'string' ? url : url?.url || '');
      log.log('wa-browser-navigation', {
        generation,
        host: safe.host,
        pathname: safe.pathname,
      });
    });
    contents.on?.('did-finish-load', () => write('wa-browser-load-finished', { ready: true }));
    contents.on?.('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      const safe = safeUrlParts(validatedURL || '');
      write('wa-browser-load-failed', {
        errorCode: Number(errorCode) || 0,
        host: safe.host,
        pathname: safe.pathname,
        isMainFrame: isMainFrame !== false,
      });
    });
    contents.on?.('render-process-gone', (_event, details = {}) => {
      write('wa-browser-render-gone', {
        reason: String(details.reason || '').slice(0, 80),
        exitCode: Number(details.exitCode) || 0,
      });
    });
    contents.on?.('unresponsive', () => write('wa-browser-unresponsive', { unresponsive: true }));
    contents.once?.('destroyed', detachDebugger);

    void attachDebugger();
  });

  return Object.freeze({ installed: true });
}

module.exports = {
  safeUrlParts,
  shouldTraceRequest,
  classifyRuntimeException,
  installWhatsAppBrowserChainDiagnostics,
};
