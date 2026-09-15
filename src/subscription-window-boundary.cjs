'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAIN_DOCUMENT_URL = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
const SUBSCRIPTION_DOCUMENT_URL = pathToFileURL(path.join(__dirname, '../ui/subscription.html')).href;

function canonicalLocalDocumentUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'file:') return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

const TRUSTED_SUBSCRIPTION_IPC_DOCUMENTS = new Set([
  canonicalLocalDocumentUrl(MAIN_DOCUMENT_URL),
  canonicalLocalDocumentUrl(SUBSCRIPTION_DOCUMENT_URL),
]);

function isTrustedSubscriptionIpcEvent(event) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !frame || sender.mainFrame !== frame) return false;
  return TRUSTED_SUBSCRIPTION_IPC_DOCUMENTS.has(canonicalLocalDocumentUrl(frame.url));
}

function installSubscriptionWindowNavigationBoundary({ app, subscriptionUrl = SUBSCRIPTION_DOCUMENT_URL } = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app event source is required');
  const trustedSubscriptionUrl = canonicalLocalDocumentUrl(subscriptionUrl);
  if (!trustedSubscriptionUrl) throw new TypeError('subscriptionUrl must be a local file URL');

  const onWindowCreated = (_event, win) => {
    const contents = win?.webContents;
    if (!contents || typeof contents.on !== 'function') return;

    let subscriptionOwned = canonicalLocalDocumentUrl(contents.getURL?.()) === trustedSubscriptionUrl;
    let windowOpenGuardInstalled = false;

    const installWindowOpenGuard = () => {
      if (windowOpenGuardInstalled || typeof contents.setWindowOpenHandler !== 'function') return;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      windowOpenGuardInstalled = true;
    };

    if (subscriptionOwned) installWindowOpenGuard();

    const guardNavigation = (navigationEvent, url) => {
      const targetUrl = canonicalLocalDocumentUrl(url || navigationEvent?.url || '');
      if (!subscriptionOwned && targetUrl === trustedSubscriptionUrl) {
        subscriptionOwned = true;
        installWindowOpenGuard();
        return;
      }
      if (subscriptionOwned && targetUrl !== trustedSubscriptionUrl) {
        navigationEvent?.preventDefault?.();
      }
    };

    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
  };

  app.on('browser-window-created', onWindowCreated);

  return Object.freeze({
    dispose() {
      if (typeof app.off === 'function') app.off('browser-window-created', onWindowCreated);
      else app.removeListener?.('browser-window-created', onWindowCreated);
    },
  });
}

module.exports = {
  MAIN_DOCUMENT_URL,
  SUBSCRIPTION_DOCUMENT_URL,
  canonicalLocalDocumentUrl,
  isTrustedSubscriptionIpcEvent,
  installSubscriptionWindowNavigationBoundary,
};
