'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const PROXY_APPLY_FAILED = 'PROXY_APPLY_FAILED';
const PROXY_CONFIG_INVALID = 'PROXY_CONFIG_INVALID';

function createError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function canonicalHost(value) {
  let host = String(value || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host.toLowerCase();
}

function normalizeHost(value) {
  const raw = String(value || '').trim();
  if (!raw) throw createError('proxy host is required', PROXY_CONFIG_INVALID);
  if (/[\s;,=@/\\]/.test(raw)) throw createError('proxy host contains invalid characters', PROXY_CONFIG_INVALID);

  let host = raw;
  if (raw.startsWith('[') || raw.endsWith(']')) {
    if (!(raw.startsWith('[') && raw.endsWith(']'))) throw createError('proxy host has invalid brackets', PROXY_CONFIG_INVALID);
    const inner = raw.slice(1, -1);
    if (net.isIP(inner) !== 6) throw createError('proxy host has invalid IPv6 address', PROXY_CONFIG_INVALID);
    host = `[${inner}]`;
  } else if (raw.includes(':')) {
    if (net.isIP(raw) !== 6) throw createError('proxy host must not include a port', PROXY_CONFIG_INVALID);
    host = `[${raw}]`;
  }
  return host;
}

function normalizePort(value) {
  const raw = String(value || '').trim();
  if (!/^\d{1,5}$/.test(raw)) throw createError('proxy port is invalid', PROXY_CONFIG_INVALID);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw createError('proxy port is invalid', PROXY_CONFIG_INVALID);
  return port;
}

function normalizeProtocol(value) {
  return value === 'https' || value === 'socks4' || value === 'socks5' ? value : 'http';
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compileProxyConfig(config) {
  if (!config || config.openProxy !== true) {
    return {
      enabled: false,
      mode: 'direct',
      proxyRules: null,
      host: '',
      canonicalHost: '',
      port: 0,
      username: '',
      password: '',
      authFingerprint: null,
      fingerprint: fingerprint(['direct']),
    };
  }

  const protocol = normalizeProtocol(config.protocal);
  const host = normalizeHost(config.host);
  const canonical = canonicalHost(host);
  const port = normalizePort(config.port);
  const username = String(config.login || config.huser || '').trim();
  const password = String(config.password || config.hpwd || '');
  const endpoint = `${host}:${port}`;
  // The UI protocol selector describes the proxy server protocol. Electron's
  // optional `urlScheme=` prefix selects destination URL schemes, while the
  // proxy URL scheme selects HTTP/HTTPS/SOCKS transport to the proxy itself.
  // Use one explicit proxy URL so the selected server protocol applies to all
  // supported destinations instead of accidentally treating `https` as a URL filter.
  const proxyRules = `${protocol}://${endpoint}`;
  const authFingerprint = fingerprint([username, password]);

  return {
    enabled: true,
    mode: 'fixed_servers',
    proxyRules,
    host,
    canonicalHost: canonical,
    port,
    username,
    password,
    authFingerprint,
    fingerprint: fingerprint([protocol, canonical, port, authFingerprint]),
  };
}

function effectiveProxyConfig(account, globalConfig) {
  if (account?.openProxy === true) return account;
  if (globalConfig?.openProxy === true) return globalConfig;
  return null;
}

function createProxyRuntime(options = {}) {
  const app = options.app;
  const sessionModule = options.sessionModule;
  const accountState = options.accountState;
  const getGlobalConfig = options.getGlobalConfig;
  const onError = typeof options.onError === 'function' ? options.onError : () => {};

  if (!app || typeof app.on !== 'function') throw new TypeError('proxy runtime app is required');
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') throw new TypeError('proxy runtime session module is required');
  if (!accountState || typeof accountState.findByPartition !== 'function') throw new TypeError('proxy runtime account state is required');
  if (typeof getGlobalConfig !== 'function') throw new TypeError('proxy runtime global config resolver is required');

  const readiness = new Map();
  let authHandler = null;

  function report(error, partition, phase) {
    const code = typeof error?.code === 'string' ? error.code : PROXY_APPLY_FAILED;
    try { onError(error, { partition, phase, code }); } catch {}
    return code;
  }

  function compileForAccount(account, globalConfig = getGlobalConfig()) {
    return compileProxyConfig(effectiveProxyConfig(account, globalConfig));
  }

  function stateFor(partition) {
    const state = readiness.get(partition);
    return state ? { ...state } : null;
  }

  function lastAppliedProxy(previous, descriptor) {
    if (descriptor?.enabled === true) {
      return {
        lastProxyHost: descriptor.canonicalHost,
        lastProxyPort: descriptor.port,
        lastProxyAuthFingerprint: descriptor.authFingerprint,
      };
    }
    return {
      lastProxyHost: previous?.lastProxyHost || '',
      lastProxyPort: previous?.lastProxyPort || 0,
      lastProxyAuthFingerprint: previous?.lastProxyAuthFingerprint || null,
    };
  }

  function markFailed(partition, error, descriptor = null, phase = 'apply', previous = readiness.get(partition) || null) {
    const code = report(error, partition, phase);
    readiness.set(partition, {
      ready: false,
      fingerprint: descriptor?.fingerprint || null,
      enabled: descriptor?.enabled === true,
      host: descriptor?.canonicalHost || '',
      port: descriptor?.port || 0,
      errorCode: code,
      lastProxyHost: previous?.lastProxyHost || '',
      lastProxyPort: previous?.lastProxyPort || 0,
      lastProxyAuthFingerprint: previous?.lastProxyAuthFingerprint || null,
    });
    return { ok: false, changed: false, deduped: false, code };
  }

  async function applyPartition(partition, config) {
    if (typeof partition !== 'string' || !partition) {
      return markFailed(String(partition || ''), createError('proxy partition is required', PROXY_CONFIG_INVALID));
    }

    const previous = readiness.get(partition) || null;
    let descriptor;
    try {
      descriptor = compileProxyConfig(config);
    } catch (error) {
      return markFailed(partition, error, null, 'apply', previous);
    }

    if (previous?.ready === true && previous.fingerprint === descriptor.fingerprint) {
      return { ok: true, changed: false, deduped: true, enabled: descriptor.enabled };
    }

    // A fresh Electron Session is direct by default. Avoid a needless asynchronous
    // setProxy call when neither this runtime nor a prior live config has changed it.
    if (!descriptor.enabled && !previous) {
      readiness.set(partition, {
        ready: true,
        fingerprint: descriptor.fingerprint,
        enabled: false,
        host: '',
        port: 0,
        errorCode: null,
        ...lastAppliedProxy(null, descriptor),
      });
      return { ok: true, changed: false, deduped: false, enabled: false };
    }

    let ses;
    try {
      ses = sessionModule.fromPartition(partition, { cache: true });
      if (!ses || typeof ses.setProxy !== 'function') throw new Error('session setProxy is unavailable');
      if (descriptor.enabled) {
        await ses.setProxy({
          mode: 'fixed_servers',
          proxyRules: descriptor.proxyRules,
          proxyBypassRules: '<local>',
        });
      } else {
        await ses.setProxy({ mode: 'direct' });
      }

      const staleAuthForSameProxy = descriptor.enabled
        && previous?.lastProxyHost === descriptor.canonicalHost
        && previous?.lastProxyPort === descriptor.port
        && previous?.lastProxyAuthFingerprint
        && previous.lastProxyAuthFingerprint !== descriptor.authFingerprint;
      if (staleAuthForSameProxy && typeof ses.clearAuthCache === 'function') {
        await ses.clearAuthCache();
      }
      if (previous && previous.fingerprint !== descriptor.fingerprint && typeof ses.closeAllConnections === 'function') {
        await ses.closeAllConnections();
      }
    } catch (cause) {
      const error = createError('failed to apply account proxy', PROXY_APPLY_FAILED, cause);
      return markFailed(partition, error, descriptor, 'apply', previous);
    }

    readiness.set(partition, {
      ready: true,
      fingerprint: descriptor.fingerprint,
      enabled: descriptor.enabled,
      host: descriptor.canonicalHost,
      port: descriptor.port,
      errorCode: null,
      ...lastAppliedProxy(previous, descriptor),
    });
    return { ok: true, changed: true, deduped: false, enabled: descriptor.enabled };
  }

  async function applyAccount(account, globalConfig = getGlobalConfig()) {
    if (!account || typeof account.partition !== 'string' || !account.partition) {
      return markFailed('', createError('account partition is required', PROXY_CONFIG_INVALID));
    }
    return applyPartition(account.partition, effectiveProxyConfig(account, globalConfig));
  }

  async function applyAccounts(accounts, globalConfig = getGlobalConfig()) {
    const list = Array.isArray(accounts) ? accounts : [];
    return Promise.all(list.map(account => applyAccount(account, globalConfig)));
  }

  function isReadyForAccount(account, globalConfig = getGlobalConfig()) {
    if (!account || typeof account.partition !== 'string' || !account.partition) return false;
    let descriptor;
    try {
      descriptor = compileForAccount(account, globalConfig);
    } catch {
      return false;
    }
    const state = readiness.get(account.partition);
    return state?.ready === true && state.fingerprint === descriptor.fingerprint;
  }

  function forgetPartition(partition) {
    readiness.delete(partition);
  }

  function installAuthenticationHandler() {
    if (authHandler) return authHandler;
    authHandler = (event, webContents, responseDetails, authInfo, callback) => {
      if (!authInfo || authInfo.isProxy !== true) return;
      if (responseDetails?.firstAuthAttempt === false) return;
      const partition = webContents?.session?.partition;
      if (typeof partition !== 'string' || !partition) return;
      const account = accountState.findByPartition(partition);
      if (!account) return;

      let descriptor;
      try {
        descriptor = compileForAccount(account);
      } catch {
        return;
      }
      if (!descriptor.enabled || !descriptor.username) return;
      const state = readiness.get(partition);
      if (!state || state.ready !== true || state.fingerprint !== descriptor.fingerprint) return;
      if (canonicalHost(authInfo.host) !== descriptor.canonicalHost) return;
      if (Number(authInfo.port) !== descriptor.port) return;
      if (typeof event?.preventDefault !== 'function' || typeof callback !== 'function') return;

      event.preventDefault();
      callback(descriptor.username, descriptor.password);
    };
    app.on('login', authHandler);
    return authHandler;
  }

  return {
    applyAccount,
    applyAccounts,
    applyPartition,
    forgetPartition,
    installAuthenticationHandler,
    isReadyForAccount,
    stateFor,
  };
}

module.exports = {
  PROXY_APPLY_FAILED,
  PROXY_CONFIG_INVALID,
  compileProxyConfig,
  createProxyRuntime,
  effectiveProxyConfig,
};