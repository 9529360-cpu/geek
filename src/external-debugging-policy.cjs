'use strict';

const EXTERNAL_DEBUG_URL = 'http://127.0.0.1:9344/json';

function externalDebuggingRequested({ argv = [] } = {}) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || '') === '--remote-debugging-port=9344');
}

function normalizeHttpGetTarget(input, overrideOptions) {
  let target;
  if (input instanceof URL || typeof input === 'string') {
    let url;
    try {
      url = input instanceof URL ? input : new URL(String(input || ''));
    } catch {
      return null;
    }
    target = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
    };
  } else if (input && typeof input === 'object') {
    target = input;
  } else {
    return null;
  }

  if (overrideOptions && typeof overrideOptions === 'object' && !(overrideOptions instanceof URL)) {
    target = { ...target, ...overrideOptions };
  }

  const protocol = String(target.protocol ?? 'http:');
  const hostname = String(target.hostname ?? target.host ?? 'localhost');
  const port = target.port == null || target.port === ''
    ? (protocol === 'http:' ? '80' : '')
    : String(target.port);
  const path = String(target.path ?? '/');
  const pathname = path.split(/[?#]/, 1)[0];
  return { protocol, hostname, port, pathname };
}

function isExternalDebugProbeTarget(input, overrideOptions) {
  try {
    const target = normalizeHttpGetTarget(input, overrideOptions);
    return Boolean(target
      && target.protocol === 'http:'
      && target.hostname === '127.0.0.1'
      && target.port === '9344'
      && target.pathname === '/json');
  } catch {
    return false;
  }
}

function installExternalDebuggingProbeGuard({ httpModule } = {}) {
  const http = httpModule || require('node:http');
  if (!http || typeof http.get !== 'function') throw new TypeError('http.get is required');
  const originalGet = http.get;
  function guardedGet(input, ...args) {
    const overrideOptions = args[0] && typeof args[0] === 'object' ? args[0] : undefined;
    if (isExternalDebugProbeTarget(input, overrideOptions)) {
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
