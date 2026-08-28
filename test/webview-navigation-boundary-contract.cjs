'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  LINE_EXTENSION_ID,
  classifyInitialUrl,
  isNavigationAllowed,
  installAccountScopedWebviewNavigationBoundary,
} = require('../src/webview-navigation-boundary.cjs');

function eventProbe() {
  return {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

class FakeContents extends EventEmitter {
  constructor(partition, currentUrl = '') {
    super();
    this.session = { partition };
    this.currentUrl = currentUrl;
    this.popupHandler = null;
  }
  getURL() { return this.currentUrl; }
  setWindowOpenHandler(handler) { this.popupHandler = handler; }
}

function guardGuest(initialUrl, partition = 'persist:webview-page-A') {
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app });
  const contents = new FakeContents(partition);
  app.emit('web-contents-created', {}, contents);
  // Simulate legacy main registering its wider handler after this boundary installs.
  contents.setWindowOpenHandler(() => ({ action: 'allow' }));
  const initial = eventProbe();
  contents.emit('will-navigate', initial, initialUrl);
  assert.equal(initial.prevented, false, `trusted initial URL must remain allowed: ${initialUrl}`);
  contents.currentUrl = initialUrl;
  contents.emit('did-navigate', {}, initialUrl);
  return contents;
}

const tg = classifyInitialUrl('https://web.telegram.org/a');
assert.equal(tg.kind, 'telegram');
assert.equal(isNavigationAllowed(tg, 'https://web.telegram.org/k/'), true);
assert.equal(isNavigationAllowed(tg, 'https://web.whatsapp.com/'), false);

const website = classifyInitialUrl('https://a.example.com/app');
assert.equal(website.kind, 'website');
assert.equal(isNavigationAllowed(website, 'https://sub.a.example.com/next'), true);
assert.equal(isNavigationAllowed(website, 'https://b.example.com/'), false);

const line = classifyInitialUrl(`chrome-extension://${LINE_EXTENSION_ID}/index.html`);
assert.equal(line.kind, 'line');
assert.equal(isNavigationAllowed(line, 'https://access.line.me/oauth2/v2.1/authorize'), true);
assert.equal(isNavigationAllowed(line, 'https://web.telegram.org/a'), false);

const wa = classifyInitialUrl('http://127.0.0.1:1843/');
assert.equal(wa.kind, 'whatsapp');
assert.equal(isNavigationAllowed(wa, 'http://127.0.0.1:1843/index.html'), true);
assert.equal(isNavigationAllowed(wa, 'https://web.whatsapp.com/'), true);
assert.equal(isNavigationAllowed(wa, 'https://web.telegram.org/a'), false);

{
  const guest = guardGuest('https://web.telegram.org/a');
  const crossPlatform = eventProbe();
  guest.emit('will-navigate', crossPlatform, 'https://web.whatsapp.com/');
  assert.equal(crossPlatform.prevented, true, 'TG guest must not navigate into WA while retaining the TG account partition');

  const samePlatform = eventProbe();
  guest.emit('will-redirect', samePlatform, 'https://web.telegram.org/k/');
  assert.equal(samePlatform.prevented, false, 'same-platform redirect must remain compatible');
  assert.deepEqual(guest.popupHandler({ url: 'https://web.whatsapp.com/' }), { action: 'deny' }, 'legacy popup allowlist must not widen the account policy');
  assert.deepEqual(guest.popupHandler({ url: 'https://web.telegram.org/k/' }), { action: 'allow' });
}

{
  const guest = guardGuest('https://a.example.com/app');
  const otherAccountSite = eventProbe();
  guest.emit('will-navigate', otherAccountSite, 'https://b.example.net/');
  assert.equal(otherAccountSite.prevented, true, 'website A partition must not navigate to website B domain');
  const subdomain = eventProbe();
  guest.emit('will-navigate', subdomain, 'https://chat.a.example.com/');
  assert.equal(subdomain.prevented, false, 'same custom host subdomain remains allowed');
}

{
  const guest = guardGuest(`chrome-extension://${LINE_EXTENSION_ID}/index.html`);
  const oauth = eventProbe();
  guest.emit('will-navigate', oauth, 'https://access.line.me/oauth2/v2.1/authorize');
  assert.equal(oauth.prevented, false, 'LINE official auth navigation must remain allowed');
  const telegram = eventProbe();
  guest.emit('will-navigate', telegram, 'https://web.telegram.org/a');
  assert.equal(telegram.prevented, true);
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app });
  const defaultContents = new FakeContents('');
  app.emit('web-contents-created', {}, defaultContents);
  defaultContents.setWindowOpenHandler(() => ({ action: 'allow' }));
  const nav = eventProbe();
  defaultContents.emit('will-navigate', nav, 'https://example.com/');
  assert.equal(nav.prevented, false, 'non-account webContents must not inherit the WebView account policy');
  assert.deepEqual(defaultContents.popupHandler({ url: 'https://example.com/' }), { action: 'allow' });
}

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const installAt = mainEntry.indexOf('installAccountScopedWebviewNavigationBoundary({ app })');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(installAt >= 0 && mainAt > installAt, 'account-scoped navigation boundary must install before legacy main can create WebViews');

console.log('WEBVIEW_NAVIGATION_BOUNDARY_CONTRACT_OK');
