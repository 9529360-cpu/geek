'use strict';

const crypto = require('node:crypto');
const { resolvePersistPartition } = require('./session-partition-compat.cjs');

const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';

function normalizeProtocol(value) {
  if (value === 'https' || value === 'socks4' || value === 'socks5') return value;
  return 'http';
}

function normalizeHost(value) {
  let host = String(value || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

function formatProxyHost(value) {
  const host = normalizeHost(value);
  if (!host) return '';
  return host.includes(':') ? `[${host}]` : host;
}

function normalizePort(value) {
  const port = Number(String(value == null ? '' : value).trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function proxyEndpoint(config) {
  if (!config || config.openProxy !== true) return null;
  const host = normalizeHost(config.host);
  const port = normalizePort(config.port);
  if (!host || port == null) return null;
  return Object.freeze({
    protocol: normalizeProtocol(config.protocal),
    host,
    port,
  });
}

function proxyRulesFor(config) {
  const endpoint = proxyEndpoint(config);
  if (!endpoint) return null;
  const host = formatProxyHost(endpoint.host);
  return `${endpoint.protocol}://${host}:${endpoint.port}`;
}

function sessionProxyConfig(config) {
  const rules = proxyRulesFor(config);
  if (config?.openProxy === true && !rules) {
    const error = new Error('enabled proxy requires a valid host and port');
    error.code = 'PROXY_CONFIG_INVALID';
    throw error;
  }
  if (!rules) return Object.freeze({ mode: 'direct' });
  return Object.freeze({
    mode: 'fixed_servers',
    proxyRules: rules,
    proxyBypassRules: '<local>',
  });
}

function effectiveProxyConfig(account, globalConfig) {
  if (account?.openProxy === true) return account;
  if (globalConfig?.openProxy === true) return globalConfig;
  return null;
}

function proxyUsername(config) {
  if (!config || typeof config !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(config, 'login')) return String(config.login || '').trim();
  return String(config.huser || '').trim();
}

function proxyPassword(config) {
  if (!config || typeof config !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(config, 'password')) return String(config.password || '');
  return String(config.hpwd || '');
}

function proxyFingerprint(config) {
  const endpoint = proxyEndpoint(config);
  const parts = endpoint
    ? [endpoint.protocol, endpoint.host, String(endpoint.port), proxyUsername(config), proxyPassword(config)]
    : config?.openProxy === true
      ? ['invalid', String(config.host || ''), String(config.port || ''), proxyUsername(config), proxyPassword(config)]
      : ['direct'];
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function challengeMatches(config, authInfo) {
  if (!authInfo || authInfo.isProxy !== true) return false;
  const endpoint = proxyEndpoint(config);
  if (!endpoint) return false;
  return normalizeHost(authInfo.host) === endpoint.host && Number(authInfo.port) === endpoint.port;
}

function isAccountPartition(partition) {
  return String(partition || '').startsWith(ACCOUNT_PARTITION_PREFIX);
}

function createProxyRuntime(options = {}) {
  const app = options.app;
  const sessionModule = options.session;
  const accountState = options.accountState;
  const getGlobalConfig = options.getGlobalConfig;
  const setSessionProxy = typeof options.setSessionProxy === 'function'
    ? options.setSessionProxy
    : (sessionValue, config) => sessionValue.setProxy(config);
  const onError = typeof options.onError === 'function' ? options.onError : () => {};

  if (!app || typeof app.on !== 'function') throw new TypeError('proxy runtime requires app');
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') throw new TypeError('proxy runtime requires session module');
  if (!accountState || typeof accountState.getSnapshot !== 'function' || typeof accountState.findByPartition !== 'function') {
    throw new TypeError('proxy runtime requires account state authority');
  }
  if (typeof getGlobalConfig !== 'function') throw new TypeError('proxy runtime requires global config getter');

  const appliedFingerprintByPartition = new Map();
  const readinessByPartition = new Map();
  let authInstalled = false;
  let disposed = false;

  function report(error, meta) {
    try { onError(error, meta); } catch {}
  }

  function currentConfigForAccount(account, globalConfig = getGlobalConfig()) {
    return effectiveProxyConfig(account, globalConfig);
  }

  async function applyPartition(partition, config, applyOptions = {}) {
    const key = String(partition || '');
    if (!key) throw new TypeError('proxy partition is required');
    const nextFingerprint = proxyFingerprint(config);
    const previousFingerprint = appliedFingerprintByPartition.get(key);
    if (previousFingerprint === nextFingerprint && readinessByPartition.get(key) === true) return true;

    try {
      const ses = sessionModule.fromPartition(key, { cache: true });
      if (!ses) throw new TypeError('proxy session is unavailable');
      await setSessionProxy(ses, sessionProxyConfig(config));
      const shouldClose = applyOptions.closeConnections !== false && previousFingerprint !== undefined;
      if (shouldClose && typeof ses.closeAllConnections === 'function') await ses.closeAllConnections();
      appliedFingerprintByPartition.set(key, nextFingerprint);
      readinessByPartition.set(key, true);
      return true;
    } catch (error) {
      readinessByPartition.set(key, false);
      report(error, { phase: 'apply', partition: key, proxyEnabled: config?.openProxy === true });
      return false;
    }
  }

  async function applyAccount(account, applyOptions = {}) {
    if (!account?.partition) throw new TypeError('proxy account partition is required');
    return applyPartition(account.partition, currentConfigForAccount(account), applyOptions);
  }

  async function applyCurrentPartition(partition, applyOptions = {}) {
    const account = accountState.findByPartition(String(partition || ''));
    if (!account) return false;
    return applyAccount(account, applyOptions);
  }

  async function applyAllAccounts(applyOptions = {}) {
    const snapshot = accountState.getSnapshot();
    const globalConfig = getGlobalConfig();
    const accounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
    const results = await Promise.all(accounts.map(account =>
      applyPartition(account.partition, currentConfigForAccount(account, globalConfig), applyOptions)
        .then(ok => ({ accountId: account.id, partition: account.partition, ok }))
    ));
    return results;
  }

  function isPartitionReady(partition) {
    return readinessByPartition.get(String(partition || '')) === true;
  }

  function forgetPartition(partition) {
    const key = String(partition || '');
    if (!key) return false;
    const existed = appliedFingerprintByPartition.delete(key) || readinessByPartition.has(key);
    readinessByPartition.delete(key);
    return existed;
  }

  function credentialsForChallenge(webContents, details, authInfo) {
    if (disposed || authInfo?.isProxy !== true || details?.firstAuthAttempt === false) return null;
    const partition = String(webContents?.session?.partition || resolvePersistPartition(webContents?.session) || '');
    if (!partition || !isPartitionReady(partition)) return null;
    const account = accountState.findByPartition(partition);
    if (!account) return null;
    const config = currentConfigForAccount(account);
    if (!challengeMatches(config, authInfo)) return null;
    const username = proxyUsername(config);
    if (!username) return null;
    return Object.freeze({ username, password: proxyPassword(config), partition });
  }

  function handleLogin(event, webContents, details, authInfo, callback) {
    if (typeof callback !== 'function') return false;
    let credentials = null;
    try {
      credentials = credentialsForChallenge(webContents, details, authInfo);
    } catch (error) {
      report(error, { phase: 'auth' });
      return false;
    }
    if (!credentials) return false;
    event?.preventDefault?.();
    callback(credentials.username, credentials.password);
    return true;
  }

  function installAuthentication() {
    if (disposed) throw new Error('proxy runtime disposed');
    if (authInstalled) return false;
    authInstalled = true;
    app.on('login', handleLogin);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (authInstalled && typeof app.removeListener === 'function') app.removeListener('login', handleLogin);
    authInstalled = false;
    appliedFingerprintByPartition.clear();
    readinessByPartition.clear();
  }

  return Object.freeze({
    applyPartition,
    applyAccount,
    applyCurrentPartition,
    applyAllAccounts,
    isPartitionReady,
    forgetPartition,
    credentialsForChallenge,
    handleLogin,
    installAuthentication,
    dispose,
  });
}

function findMethodDescriptor(value, name) {
  let owner = value;
  while (owner && owner !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return { owner, descriptor };
    owner = Object.getPrototypeOf(owner);
  }
  return null;
}

function installProxyRuntimeComposition(options = {}) {
  const app = options.app;
  const sessionModule = options.sessionModule;
  const accountStateModule = options.accountStateModule;
  const configStateModule = options.configStateModule;
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  if (!app || typeof app.on !== 'function' || typeof app.whenReady !== 'function') throw new TypeError('proxy composition requires app');
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') throw new TypeError('proxy composition requires session module');
  if (!accountStateModule || typeof accountStateModule.createAccountStateStore !== 'function') throw new TypeError('proxy composition requires account state module');
  if (!configStateModule || typeof configStateModule.createConfigStateStore !== 'function') throw new TypeError('proxy composition requires config state module');

  const originalAccountFactory = accountStateModule.createAccountStateStore;
  const originalConfigFactory = configStateModule.createConfigStateStore;
  const originalFromPartition = sessionModule.fromPartition.bind(sessionModule);
  let rawAccountStore = null;
  let rawConfigStore = null;
  let runtime = null;
  let accountLoaded = false;
  let configLoaded = false;
  let nativeSetProxy = null;
  let setProxyOwner = null;
  let setProxyDescriptor = null;
  let disposed = false;

  function report(error, meta) {
    try { onError(error, meta); } catch {}
  }

  function rawAccountAuthority() {
    return {
      getSnapshot: () => rawAccountStore.getSnapshot(),
      findByPartition: partition => rawAccountStore.findByPartition(partition),
    };
  }

  function ensureRuntime() {
    if (runtime || !rawAccountStore || !rawConfigStore || typeof nativeSetProxy !== 'function') return runtime;
    runtime = createProxyRuntime({
      app,
      session: { fromPartition: (...args) => originalFromPartition(...args) },
      accountState: rawAccountAuthority(),
      getGlobalConfig: () => rawConfigStore.getSnapshot(),
      setSessionProxy: (sessionValue, config) => nativeSetProxy.call(sessionValue, config),
      onError: report,
    });
    runtime.installAuthentication();
    return runtime;
  }

  async function preapplyIfLoaded() {
    const current = ensureRuntime();
    if (!current || !accountLoaded || !configLoaded) return null;
    return current.applyAllAccounts({ closeConnections: false });
  }

  function decorateAccountStore(store) {
    rawAccountStore = store;
    ensureRuntime();
    return {
      ...store,
      async load(...args) {
        const result = await store.load(...args);
        accountLoaded = true;
        await preapplyIfLoaded();
        return result;
      },
      async add(...args) {
        const result = await store.add(...args);
        await ensureRuntime()?.applyAccount(result.account, { closeConnections: false });
        return result;
      },
      async update(...args) {
        const result = await store.update(...args);
        await ensureRuntime()?.applyAccount(result.account);
        return result;
      },
      async remove(...args) {
        const result = await store.remove(...args);
        ensureRuntime()?.forgetPartition(result.removedAccount?.partition);
        return result;
      },
    };
  }

  function decorateConfigStore(store) {
    rawConfigStore = store;
    ensureRuntime();
    return {
      ...store,
      async load(...args) {
        const result = await store.load(...args);
        configLoaded = true;
        await preapplyIfLoaded();
        return result;
      },
      async update(...args) {
        const result = await store.update(...args);
        await ensureRuntime()?.applyAllAccounts();
        return result;
      },
    };
  }

  accountStateModule.createAccountStateStore = (...args) => decorateAccountStore(originalAccountFactory(...args));
  configStateModule.createConfigStateStore = (...args) => decorateConfigStore(originalConfigFactory(...args));

  function onWebContentsCreated(_event, contents) {
    contents?.on?.('will-attach-webview', (event, _preferences, params) => {
      const partition = String(params?.partition || '');
      if (!isAccountPartition(partition)) return;
      const current = ensureRuntime();
      if (!current || !current.isPartitionReady(partition)) {
        report(Object.assign(new Error('account proxy session not ready'), { code: 'PROXY_SESSION_NOT_READY' }), {
          phase: 'attach',
          partition,
          proxyEnabled: true,
        });
        event?.preventDefault?.();
      }
    });
  }
  app.on('web-contents-created', onWebContentsCreated);

  const ready = app.whenReady().then(() => {
    const sample = sessionModule.defaultSession;
    if (!sample) throw new Error('PROXY_RUNTIME_NO_SESSION');
    const located = findMethodDescriptor(sample, 'setProxy');
    if (!located || typeof located.descriptor.value !== 'function') throw new Error('PROXY_RUNTIME_NO_NATIVE_SET_PROXY');
    setProxyOwner = located.owner;
    setProxyDescriptor = located.descriptor;
    nativeSetProxy = located.descriptor.value;
    Object.defineProperty(setProxyOwner, 'setProxy', {
      ...setProxyDescriptor,
      value: function accountScopedSetProxyCompat(config) {
        const partition = resolvePersistPartition(this);
        if (!isAccountPartition(partition)) return nativeSetProxy.call(this, config);
        const current = ensureRuntime();
        if (!current) return Promise.reject(Object.assign(new Error('proxy runtime not ready'), { code: 'PROXY_RUNTIME_NOT_READY' }));
        return current.applyCurrentPartition(partition, { closeConnections: false });
      },
    });
    ensureRuntime();
    return true;
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    runtime?.dispose();
    runtime = null;
    if (setProxyOwner && setProxyDescriptor) {
      try { Object.defineProperty(setProxyOwner, 'setProxy', setProxyDescriptor); } catch {}
    }
    if (typeof app.removeListener === 'function') app.removeListener('web-contents-created', onWebContentsCreated);
    accountStateModule.createAccountStateStore = originalAccountFactory;
    configStateModule.createConfigStateStore = originalConfigFactory;
  }
  app.on('before-quit', dispose);

  return Object.freeze({
    ready,
    getRuntime: () => runtime,
    dispose,
  });
}

module.exports = Object.freeze({
  ACCOUNT_PARTITION_PREFIX,
  normalizeProtocol,
  normalizeHost,
  normalizePort,
  proxyEndpoint,
  proxyRulesFor,
  sessionProxyConfig,
  effectiveProxyConfig,
  proxyUsername,
  proxyPassword,
  challengeMatches,
  isAccountPartition,
  createProxyRuntime,
  findMethodDescriptor,
  installProxyRuntimeComposition,
});
