'use strict';

const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';

function hostnameMatches(hostname, exactHosts = [], suffix = '') {
  const host = String(hostname || '').toLowerCase();
  if (exactHosts.includes(host)) return true;
  return Boolean(suffix && host.endsWith(suffix));
}

function classifyInitialUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  const hostname = url.hostname.toLowerCase();

  if (url.protocol === 'chrome-extension:' && hostname === LINE_EXTENSION_ID) {
    return Object.freeze({ kind: 'line' });
  }
  if (url.protocol === 'http:' && hostname === '127.0.0.1' && url.port) {
    return Object.freeze({ kind: 'whatsapp', localOrigin: url.origin });
  }
  if (url.protocol !== 'https:') return null;

  if (hostnameMatches(hostname, ['web.telegram.org'], '.telegram.org')) {
    return Object.freeze({ kind: 'telegram' });
  }
  if (hostnameMatches(hostname, ['web.whatsapp.com'], '.whatsapp.com')) {
    return Object.freeze({ kind: 'whatsapp', localOrigin: '' });
  }
  if (hostnameMatches(hostname, ['manager.line.biz', 'access.line.me', 'line.me'], '.line.me')) {
    return Object.freeze({ kind: 'line' });
  }
  return Object.freeze({ kind: 'website', hostname });
}

function isNavigationAllowed(policy, value) {
  if (!policy) return false;
  let url;
  try { url = new URL(String(value || '')); } catch { return false; }
  const hostname = url.hostname.toLowerCase();

  if (policy.kind === 'whatsapp') {
    if (policy.localOrigin && url.protocol === 'http:' && url.origin === policy.localOrigin) return true;
    return url.protocol === 'https:' && hostnameMatches(hostname, ['web.whatsapp.com'], '.whatsapp.com');
  }
  if (policy.kind === 'telegram') {
    return url.protocol === 'https:' && hostnameMatches(hostname, ['web.telegram.org'], '.telegram.org');
  }
  if (policy.kind === 'line') {
    if (url.protocol === 'chrome-extension:' && hostname === LINE_EXTENSION_ID) return true;
    return url.protocol === 'https:' && hostnameMatches(hostname, ['manager.line.biz', 'access.line.me', 'line.me'], '.line.me');
  }
  if (policy.kind === 'website') {
    return url.protocol === 'https:'
      && (hostname === policy.hostname || hostname.endsWith(`.${policy.hostname}`));
  }
  return false;
}

function isAccountGuest(contents) {
  try {
    return String(contents?.session?.partition || '').startsWith(ACCOUNT_PARTITION_PREFIX);
  } catch {
    return false;
  }
}

function installAccountScopedWebviewNavigationBoundary({ app } = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app.on is required');
  const guarded = new WeakSet();

  app.on('web-contents-created', (_event, contents) => {
    if (!contents || guarded.has(contents)) return;
    guarded.add(contents);
    let policy = null;

    function arm(value) {
      if (policy || !isAccountGuest(contents)) return policy;
      policy = classifyInitialUrl(value);
      return policy;
    }

    function currentPolicy() {
      if (policy) return policy;
      let current = '';
      try { current = contents.getURL?.() || ''; } catch {}
      return arm(current);
    }

    function blockIfOutsidePolicy(event, targetUrl) {
      if (!isAccountGuest(contents)) return;
      const activePolicy = currentPolicy() || arm(targetUrl);
      if (!activePolicy || !isNavigationAllowed(activePolicy, targetUrl)) event?.preventDefault?.();
    }

    contents.on?.('will-navigate', blockIfOutsidePolicy);
    contents.on?.('will-redirect', blockIfOutsidePolicy);
    contents.on?.('did-navigate', (_navEvent, url) => { arm(url); });

    // Legacy main.cjs installs its own global allowlist through setWindowOpenHandler.
    // Compose every downstream handler with this account-scoped gate so a later
    // registration cannot widen popup navigation back to another platform/account.
    if (typeof contents.setWindowOpenHandler === 'function') {
      const nativeSetWindowOpenHandler = contents.setWindowOpenHandler.bind(contents);
      contents.setWindowOpenHandler = (handler) => nativeSetWindowOpenHandler((details) => {
        if (isAccountGuest(contents)) {
          const activePolicy = currentPolicy();
          if (!activePolicy || !isNavigationAllowed(activePolicy, details?.url)) return { action: 'deny' };
        }
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
  classifyInitialUrl,
  isNavigationAllowed,
  installAccountScopedWebviewNavigationBoundary,
};
