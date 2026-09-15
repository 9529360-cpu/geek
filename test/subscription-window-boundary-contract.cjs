'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

function navigationEvent(extra = {}) {
  return {
    prevented: 0,
    preventDefault() { this.prevented += 1; },
    ...extra,
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
assert.equal(subscription.webContents.windowOpenHandler, null, 'about:blank creation alone must not claim subscription ownership');
subscription.webContents.emit(
  'did-start-navigation',
  navigationEvent({ url: `${SUBSCRIPTION_DOCUMENT_URL}?startup=1`, isMainFrame: true }),
);
assert.equal(typeof subscription.webContents.windowOpenHandler, 'function', 'programmatic loadFile startup navigation must claim subscription ownership before commit');
assert.deepEqual(subscription.webContents.windowOpenHandler({ url: 'https://example.invalid/' }), { action: 'deny' });

const reloadNavigation = navigationEvent();
subscription.webContents.emit('will-navigate', reloadNavigation, `${SUBSCRIPTION_DOCUMENT_URL}?reload=1`);
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

const subframeCandidate = fakeWindow();
app.emit('browser-window-created', {}, subframeCandidate);
subframeCandidate.webContents.emit(
  'did-start-navigation',
  navigationEvent({ url: SUBSCRIPTION_DOCUMENT_URL, isMainFrame: false }),
);
assert.equal(subframeCandidate.webContents.windowOpenHandler, null, 'subframe navigation to subscription URL must not claim BrowserWindow ownership');
const subframeOwnerCheck = navigationEvent();
subframeCandidate.webContents.emit('will-navigate', subframeOwnerCheck, 'https://example.invalid/unrelated');
assert.equal(subframeOwnerCheck.prevented, 0, 'unclaimed window remains outside the subscription navigation owner');

const legacyProgrammatic = fakeWindow();
app.emit('browser-window-created', {}, legacyProgrammatic);
legacyProgrammatic.webContents.emit('did-start-navigation', navigationEvent(), SUBSCRIPTION_DOCUMENT_URL, false, true);
assert.equal(typeof legacyProgrammatic.webContents.windowOpenHandler, 'function', 'legacy positional Electron navigation metadata must still identify the main-frame subscription startup');

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
assert.equal(afterDispose.webContents.listenerCount('did-start-navigation'), 0, 'dispose removes future programmatic-start ownership installation');

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const requireAt = mainEntry.indexOf("require('./subscription-window-boundary.cjs')");
const installAt = mainEntry.indexOf('installSubscriptionWindowNavigationBoundary({ app })');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(requireAt >= 0, 'main entry must import the subscription navigation boundary');
assert.ok(installAt > requireAt && mainAt > installAt, 'subscription navigation boundary must be installed before main can create BrowserWindows');

console.log('SUBSCRIPTION_WINDOW_BOUNDARY_CONTRACT_OK');