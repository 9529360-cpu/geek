'use strict';

const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';
const WA_LOCAL_ORIGIN = 'http://127.0.0.1:1843';

function hostnameMatches(hostname, exactHosts = [], suffix = '') {
  const host = String(hostname || '').toLowerCase();
  if (exactHosts.includes(host)) return true;
  return Boolean(suffix && host.endsWith(suffix));
}

function accountIdFromPartition(partitionValue) {
  const partition = String(partitionValue || '');
  if (!partition.startsWith(ACCOUNT_PARTITION_PREFIX)) return '';
  const accountId = partition.slice(ACCOUNT_PARTITION_PREFIX.length);
  return /^[a-zA-Z0-9_-]{1,100}$/.test(accountId) ? accountId : '';
}

function policyForAccount(account, partitionValue) {
  if (!account || typeof account !== 'object') return null;
  const accountId = accountIdFromPartition(partitionValue);
  if (!accountId || String(account.id || '') !== accountId) return null;
  const expectedPartition = `${ACCOUNT_PARTITION_PREFIX}${accountId}`;
  if (account.partition && String(account.partition) !== expectedPartition) return null;

  const type = String(account.type || '');
  if (type === 'whatsapp' || type === 'whatsapp-pure') {
    return Object.freeze({
      kind: 'whatsapp',
      exactHosts: Object.freeze(['web.whatsapp.com']),
      suffix: '.whatsapp.com',
      localOrigin: WA_LOCAL_ORIGIN,
    });
  }
  if (type === 'telegram-z' || type === 'telegram-k') {
    return Object.freeze({
      kind: 'telegram',
      exactHosts: Object.freeze(['web.telegram.org']),
      suffix: '.telegram.org',
    });
  }
  if (type === 'line' || type === 'line-business') {
    return Object.freeze({
      kind: 'line',
      exactHosts: Object.freeze(type === 'line-business'
        ? ['manager.line.biz', 'access.line.me', 'line.me']
        : ['access.line.me', 'line.me']),
      suffix: '.line.me',
      extensionId: LINE_EXTENSION_ID,
    });
  }
  if (type === 'website') {
    let custom;
    try { custom = new URL(String(account.customUrl || '')); } catch { return null; }
    if (custom.protocol !== 'https:' || !custom.hostname) return null;
    return Object.freeze({ kind: 'website', hostname: custom.hostname.toLowerCase() });
  }
  return null;
}

function policyFromAccountState(partitionValue, stateValue) {
  const accountId = accountIdFromPartition(partitionValue);
  if (!accountId) return null;
  let parsed = stateValue;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  const accounts = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.accounts)
      ? parsed.accounts
      : [];
  const account = accounts.find(item => item && String(item.id || '') === accountId);
  return policyForAccount(account, partitionValue);
}

function isNavigationAllowed(policy, value) {
  if (!policy) return false;
  let url;
  try { url = new URL(String(value || '')); } catch { return false; }
  const hostname = url.hostname.toLowerCase();

  if (policy.kind === 'whatsapp') {
    if (url.protocol === 'http:' && url.origin === policy.localOrigin) return true;
    return url.protocol === 'https:' && hostnameMatches(hostname, policy.exactHosts, policy.suffix);
  }
  if (policy.kind === 'telegram') {
    return url.protocol === 'https:' && hostnameMatches(hostname, policy.exactHosts, policy.suffix);
  }
  if (policy.kind === 'line') {
    if (url.protocol === 'chrome-extension:' && hostname === policy.extensionId) return true;
    return url.protocol === 'https:' && hostnameMatches(hostname, policy.exactHosts, policy.suffix);
  }
  if (policy.kind === 'website') {
    return url.protocol === 'https:'
      && (hostname === policy.hostname || hostname.endsWith(`.${policy.hostname}`));
  }
  return false;
}

function accountPartition(contents) {
  try {
    const partition = String(contents?.session?.partition || '');
    return partition.startsWith(ACCOUNT_PARTITION_PREFIX) ? partition : '';
  } catch {
    return '';
  }
}

function installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition } = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app.on is required');
  if (typeof resolvePolicyForPartition !== 'function') throw new TypeError('resolvePolicyForPartition is required');
  const guarded = new WeakSet();

  app.on('web-contents-created', (_event, contents) => {
    if (!contents || guarded.has(contents)) return;
    guarded.add(contents);
    const partition = accountPartition(contents);
    if (!partition) return;

    let policy = null;
    try { policy = resolvePolicyForPartition(partition) || null; } catch { policy = null; }

    function blockIfOutsidePolicy(event, targetUrl) {
      if (!policy || !isNavigationAllowed(policy, targetUrl)) event?.preventDefault?.();
    }

    contents.on?.('will-navigate', blockIfOutsidePolicy);
    contents.on?.('will-redirect', blockIfOutsidePolicy);

    // Legacy main.cjs installs its own wider global allowlist later. Compose that
    // downstream handler with this fixed account/partition policy so it can only
    // further restrict navigation, never widen it to another platform or account.
    if (typeof contents.setWindowOpenHandler === 'function') {
      const nativeSetWindowOpenHandler = contents.setWindowOpenHandler.bind(contents);
      contents.setWindowOpenHandler = (handler) => nativeSetWindowOpenHandler((details) => {
        if (!policy || !isNavigationAllowed(policy, details?.url)) return { action: 'deny' };
        const response = typeof handler === 'function' ? handler(details) : null;
        return response && (response.action === 'allow' || response.action === 'deny')
          ? response
          : { action: 'deny' };
      });
    }
  });

  return Object.freeze({ installed: true });
}

module.exports = {
  ACCOUNT_PARTITION_PREFIX,
  LINE_EXTENSION_ID,
  WA_LOCAL_ORIGIN,
  accountIdFromPartition,
  policyForAccount,
  policyFromAccountState,
  isNavigationAllowed,
  installAccountScopedWebviewNavigationBoundary,
};
