'use strict';

const { parseWebsiteUrl } = require('./website-url.cjs');
const { LINE_EXTENSION_ID, WA_LOCAL_ORIGIN, platformConfig } = require('./platform-catalog.cjs');

const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';

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

  const config = platformConfig(account.type);
  if (!config) return null;
  if (config.navigationKind === 'website') {
    let custom;
    try { custom = parseWebsiteUrl(account.customUrl); } catch { return null; }
    return Object.freeze({ kind: 'website', hostname: custom.hostname.toLowerCase() });
  }

  return Object.freeze({
    kind: config.navigationKind,
    exactHosts: config.hostnames || Object.freeze([]),
    suffix: config.allowSuffix || '',
    localOrigin: config.localOrigin || '',
    extensionId: config.extensionId || '',
  });
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

  if (policy.kind === 'website') {
    return url.protocol === 'https:'
      && (hostname === policy.hostname || hostname.endsWith(`.${policy.hostname}`));
  }
  if (policy.extensionId && url.protocol === 'chrome-extension:' && hostname === policy.extensionId) return true;
  if (policy.localOrigin && url.protocol === 'http:' && url.origin === policy.localOrigin) return true;
  return url.protocol === 'https:' && hostnameMatches(hostname, policy.exactHosts, policy.suffix);
}

function isAccountNavigationAllowed(account, partitionValue, value) {
  return isNavigationAllowed(policyForAccount(account, partitionValue), value);
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
    contents.setWindowOpenHandler?.((details) => (
      policy && isNavigationAllowed(policy, details?.url)
        ? { action: 'allow' }
        : { action: 'deny' }
    ));
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
  isAccountNavigationAllowed,
  installAccountScopedWebviewNavigationBoundary,
};
