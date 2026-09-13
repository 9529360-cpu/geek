'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  LINE_EXTENSION_ID,
  accountIdFromPartition,
  policyForAccount,
  policyFromAccountState,
  isNavigationAllowed,
  installAccountScopedWebviewNavigationBoundary,
} = require('../src/webview-navigation-boundary.cjs');

function eventProbe() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

class FakeContents extends EventEmitter {
  constructor(partition) {
    super();
    this.session = { partition };
    this.popupHandler = null;
  }
  setWindowOpenHandler(handler) { this.popupHandler = handler; }
}

function account(id, type, extra = {}) {
  return { id, type, partition: `persist:webview-page-${id}`, ...extra };
}

function guardGuest(owner, partition = owner.partition) {
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({
    app,
    resolvePolicyForPartition: value => policyForAccount(owner, value),
  });
  const contents = new FakeContents(partition);
  app.emit('web-contents-created', {}, contents);
  return contents;
}

assert.equal(accountIdFromPartition('persist:webview-page-A_1'), 'A_1');
assert.equal(accountIdFromPartition('persist:webview-page-../../x'), '');
assert.equal(accountIdFromPartition('persist:other-A'), '');

const tgAccount = account('TG1', 'telegram-z');
const tg = policyForAccount(tgAccount, tgAccount.partition);
assert.equal(tg.kind, 'telegram');
assert.equal(isNavigationAllowed(tg, 'https://web.telegram.org/k/'), true);
assert.equal(isNavigationAllowed(tg, 'https://web.whatsapp.com/'), false);
assert.equal(policyForAccount(tgAccount, 'persist:webview-page-TG2'), null);

const websiteAccount = account('SITE1', 'website', { customUrl: 'https://a.example.com/app' });
const website = policyForAccount(websiteAccount, websiteAccount.partition);
assert.equal(website.kind, 'website');
assert.equal(isNavigationAllowed(website, 'https://a.example.com/next'), true);
assert.equal(isNavigationAllowed(website, 'https://sub.a.example.com/next'), true);
assert.equal(isNavigationAllowed(website, 'https://b.example.com/'), false);
assert.equal(isNavigationAllowed(website, 'https://web.whatsapp.com/'), false);
assert.equal(isNavigationAllowed(website, 'http://a.example.com/'), false);
assert.equal(policyForAccount(account('HTTP1', 'website', { customUrl: 'http://a.example.com/' }), 'persist:webview-page-HTTP1'), null);
assert.equal(policyForAccount(account('CREDS1', 'website', { customUrl: 'https://user:pass@a.example.com/' }), 'persist:webview-page-CREDS1'), null);

const lineAccount = account('LINE1', 'line');
const line = policyForAccount(lineAccount, lineAccount.partition);
assert.equal(line.kind, 'line');
assert.equal(isNavigationAllowed(line, `chrome-extension://${LINE_EXTENSION_ID}/index.html`), true);
assert.equal(isNavigationAllowed(line, 'https://access.line.me/oauth2/v2.1/authorize'), true);
assert.equal(isNavigationAllowed(line, 'https://manager.line.biz/'), false);

const lineBusinessAccount = account('LINEB1', 'line-business');
const lineBusiness = policyForAccount(lineBusinessAccount, lineBusinessAccount.partition);
assert.equal(isNavigationAllowed(lineBusiness, 'https://manager.line.biz/'), true);

const waAccount = account('WA1', 'whatsapp');
const wa = policyForAccount(waAccount, waAccount.partition);
assert.equal(wa.kind, 'whatsapp');
assert.equal(isNavigationAllowed(wa, 'http://127.0.0.1:1843/index.html'), true);
assert.equal(isNavigationAllowed(wa, 'http://127.0.0.1:9999/'), false);
assert.equal(isNavigationAllowed(wa, 'https://web.whatsapp.com/'), true);
assert.equal(isNavigationAllowed(wa, 'https://web.telegram.org/a'), false);

const state = JSON.stringify({ accounts: [tgAccount, websiteAccount] });
assert.equal(policyFromAccountState(tgAccount.partition, state).kind, 'telegram');
assert.equal(policyFromAccountState('persist:webview-page-MISSING', state), null);
assert.equal(policyFromAccountState(tgAccount.partition, '{bad json'), null);

{
  const guest = guardGuest(tgAccount);
  const cross = eventProbe();
  guest.emit('will-navigate', cross, 'https://web.whatsapp.com/');
  assert.equal(cross.prevented, true);
  const same = eventProbe();
  guest.emit('will-redirect', same, 'https://web.telegram.org/k/');
  assert.equal(same.prevented, false);
  assert.deepEqual(guest.popupHandler({ url: 'https://web.whatsapp.com/' }), { action: 'deny' });
  assert.deepEqual(guest.popupHandler({ url: 'https://web.telegram.org/k/' }), { action: 'allow' });
}

{
  const guest = guardGuest(websiteAccount);
  const cross = eventProbe();
  guest.emit('will-navigate', cross, 'https://b.example.net/');
  assert.equal(cross.prevented, true);
  const same = eventProbe();
  guest.emit('will-navigate', same, 'https://chat.a.example.com/');
  assert.equal(same.prevented, false);
  assert.deepEqual(guest.popupHandler({ url: 'https://b.example.com/' }), { action: 'deny' });
  assert.deepEqual(guest.popupHandler({ url: 'https://chat.a.example.com/' }), { action: 'allow' });
}

{
  const guest = guardGuest(lineAccount);
  const oauth = eventProbe();
  guest.emit('will-navigate', oauth, 'https://access.line.me/oauth2/v2.1/authorize');
  assert.equal(oauth.prevented, false);
  const tgNav = eventProbe();
  guest.emit('will-navigate', tgNav, 'https://web.telegram.org/a');
  assert.equal(tgNav.prevented, true);
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => null });
  const unknown = new FakeContents('persist:webview-page-MISSING');
  app.emit('web-contents-created', {}, unknown);
  const nav = eventProbe();
  unknown.emit('will-navigate', nav, 'https://web.telegram.org/a');
  assert.equal(nav.prevented, true);
  assert.deepEqual(unknown.popupHandler({ url: 'https://web.telegram.org/a' }), { action: 'deny' });
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => { throw new Error('read failed'); } });
  const broken = new FakeContents('persist:webview-page-TG1');
  app.emit('web-contents-created', {}, broken);
  const nav = eventProbe();
  broken.emit('will-redirect', nav, 'https://web.telegram.org/a');
  assert.equal(nav.prevented, true);
  assert.deepEqual(broken.popupHandler({ url: 'https://web.telegram.org/a' }), { action: 'deny' });
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => { throw new Error('must not resolve'); } });
  const normal = new FakeContents('');
  app.emit('web-contents-created', {}, normal);
  const nav = eventProbe();
  normal.emit('will-navigate', nav, 'https://example.com/');
  assert.equal(nav.prevented, false);
  assert.equal(normal.popupHandler, null);
}

const readSource = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8').replace(/\r\n?/g, '\n');
const mainEntry = readSource('src/main-entry.cjs');
const main = readSource('src/main.cjs');
const installAt = mainEntry.indexOf('installAccountScopedWebviewNavigationBoundary({');
const resolverAt = mainEntry.indexOf('policyFromAccountState(partition, accountState)');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(installAt >= 0 && resolverAt > installAt && mainAt > resolverAt, 'navigation boundary must bind before main creates WebViews');
assert.match(mainEntry, /runtimePaths\.accountsFile\(earlyUserDataDir\)/);
assert.doesNotMatch(main, /\bhostAllowed\b/, 'legacy global navigation allowlist must be gone');
const didAttachAt = main.indexOf("window.webContents.on('did-attach-webview'");
const didAttachEnd = main.indexOf('\n  });\n}', didAttachAt);
const didAttach = didAttachAt >= 0 && didAttachEnd > didAttachAt ? main.slice(didAttachAt, didAttachEnd) : '';
assert.ok(didAttach, 'non-policy guest lifecycle instrumentation remains attached');
assert.doesNotMatch(didAttach, /setWindowOpenHandler|will-navigate|will-redirect/, 'main did-attach lifecycle block must not own post-attach navigation policy');

console.log('WEBVIEW_NAVIGATION_BOUNDARY_CONTRACT_OK');
