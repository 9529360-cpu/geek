'use strict';

const EXTERNAL_DEBUG_URL = 'http://127.0.0.1:9344/json';

function externalDebuggingRequested({ argv = [] } = {}) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || '') === '--remote-debugging-port=9344');
}

function isExternalDebugProbeTarget(input) {
  try {
    const url = input instanceof URL ? input : new URL(String(input || ''));
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.port === '9344'
      && url.pathname === '/json';
  } catch {
    return false;
  }
}

function installExternalDebuggingProbeGuard({ httpModule } = {}) {
  const http = httpModule || require('node:http');
  if (!http || typeof http.get !== 'function') throw new TypeError('http.get is required');
  const originalGet = http.get;
  function guardedGet(input, ...args) {
    if (isExternalDebugProbeTarget(input)) {
      const error = new Error('EXTERNAL_BROADCAST_CDP_DISABLED');
      error.code = 'EXTERNAL_BROADCAST_CDP_DISABLED';
      throw error;
    }
    return originalGet.call(this, input, ...args);
  }
  http.get = guardedGet;
  return Object.freeze({
    installed: true,
    restore() {
      if (http.get === guardedGet) http.get = originalGet;
    },
  });
}

module.exports = {
  EXTERNAL_DEBUG_URL,
  externalDebuggingRequested,
  isExternalDebugProbeTarget,
  installExternalDebuggingProbeGuard,
};
