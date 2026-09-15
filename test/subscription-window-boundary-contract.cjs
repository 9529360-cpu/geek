'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  MAIN_DOCUMENT_URL,
  SUBSCRIPTION_DOCUMENT_URL,
  canonicalLocalDocumentUrl,
  isTrustedSubscriptionIpcEvent,
  installSubscriptionWindowNavigationBoundary,
} = require('../src/subscription-window-boundary.cjs');

function ipcEvent(url, { subframe = false } = {}) {
  const mainFrame = { url };
  return {
    sender: { mainFrame },
    senderFrame: subframe ? { url } : mainFrame,
  };
}

function navigationEvent() {
  return {
    prevented: 0,
    preventDefault() { this.prevented += 1; },
  };
}

function fakeWindow(initialUrl = 'about:blank') {
  const webContents = new EventEmitter();
  webContents.getURL = () => initialUrl;
  webContents.windowOpenHandler = null;
  webContents.setWindowOpenHandler = (handler) => { webContents.windowOpenHandler = handler; };
  return { webContents };
}

assert.equal(
  canonicalLocalDocumentUrl(`${SUBSCRIPTION_DOCUMENT_URL}?startup=1#login`),
  canonicalLocalDocumentUrl(SUBSCRIPTION_DOCUMENT_URL),
  'query/hash must not change the packaged document identity',
);
assert.equal(canonicalLocalDocumentUrl('https://example.invalid/subscription.html'), '', 'remote URLs are never local document identities');
assert.equal(canonicalLocalDocumentUrl('about:blank'), '', 'about:blank is never a trusted local document identity');

assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent(SUBSCRIPTION_DOCUMENT_URL)), true, 'subscription page main frame is trusted');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent(`${SUBSCRIPTION_DOCUMENT_URL}?view=plans#current`)), true, 'subscription page query/hash stays trusted');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent(MAIN_DOCUMENT_URL)), true, 'main local UI remains authorized for subscription status/actions');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent('https://example.invalid/')), false, 'remote main frame is rejected');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent('about:blank')), false, 'about:blank is rejected');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent(MAIN_DOCUMENT_URL.replace('/index.html', '/other.html'))), false, 'wrong local file is rejected');
assert.equal(isTrustedSubscriptionIpcEvent(ipcEvent(SUBSCRIPTION_DOCUMENT_URL, { subframe: true })), false, 'subframes cannot invoke subscription IPC');
assert.equal(isTrustedSubscriptionIpcEvent({}), false, 'missing sender-frame evidence fails closed');

const app = new EventEmitter();
const boundary = installSubscriptionWindowNavigationBoundary({ app });

const subscription = fakeWindow();
app.emit('browser-window-created', {}, subscription);
const initialNavigation = navigationEvent();
subscription.webContents.emit('will-navigate', initialNavigation, `${SUBSCRIPTION_DOCUMENT_URL}?startup=1`);
assert.equal(initialNavigation.prevented, 0, 'initial packaged subscription navigation must be allowed');
assert.equal(typeof subscription.webContents.windowOpenHandler, 'function', 'subscription window must deny renderer-created child windows');
assert.deepEqual(subscription.webContents.windowOpenHandler({ url: 'https://example.invalid/' }), { action: 'deny' });

const reloadNavigation = navigationEvent();
subscription.webContents.emit('will-navigate', reloadNavigation, `${SUBSCRIPTION_DOCUMENT_URL}#reload`);
assert.equal(reloadNavigation.prevented, 0, 'same packaged subscription document reload stays allowed');

const remoteNavigation = navigationEvent();
subscription.webContents.emit('will-navigate', remoteNavigation, 'https://example.invalid/phish');
assert.equal(remoteNavigation.prevented, 1, 'subscription window must block remote navigation');

const blankNavigation = navigationEvent();
subscription.webContents.emit('will-navigate', blankNavigation, 'about:blank');
assert.equal(blankNavigation.prevented, 1, 'subscription window must block about:blank navigation after ownership is established');

const remoteRedirect = navigationEvent();
subscription.webContents.emit('will-redirect', remoteRedirect, 'https://example.invalid/redirect');
assert.equal(remoteRedirect.prevented, 1, 'subscription window must block redirects away from the packaged document');

const unrelated = fakeWindow(MAIN_DOCUMENT_URL);
app.emit('browser-window-created', {}, unrelated);
const unrelatedNavigation = navigationEvent();
unrelated.webContents.emit('will-navigate', unrelatedNavigation, 'https://example.invalid/main-owner-test');
assert.equal(unrelatedNavigation.prevented, 0, 'subscription boundary must not take ownership of unrelated BrowserWindows');
assert.equal(unrelated.webContents.windowOpenHandler, null, 'unrelated BrowserWindow keeps its existing navigation owner');

boundary.dispose();
const afterDispose = fakeWindow();
app.emit('browser-window-created', {}, afterDispose);
assert.equal(afterDispose.webContents.listenerCount('will-navigate'), 0, 'dispose removes future subscription-boundary installation');

console.log('SUBSCRIPTION_WINDOW_BOUNDARY_CONTRACT_OK');
