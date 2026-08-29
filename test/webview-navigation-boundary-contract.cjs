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
  return {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
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
  // Simulate legacy main registering its wider handler after this boundary installs.
  contents.setWindowOpenHandler(() => ({ action: 'allow' }));
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
assert.equal(policyForAccount(tgAccount, 'persist:webview-page-TG2'), null, 'partition/account mismatch must fail closed');

const websiteAccount = account('SITE1', 'website', { customUrl: 'https://a.example.com/app' });
const website = policyForAccount(websiteAccount, websiteAccount.partition);
assert.equal(website.kind, 'website');
assert.equal(isNavigationAllowed(website, 'https://sub.a.example.com/next'), true);
assert.equal(isNavigationAllowed(website, 'https://b.example.com/'), false);
assert.equal(policyForAccount(account('HTTP1', 'website', { customUrl: 'http://a.example.com/' }), 'persist:webview-page-HTTP1'), null, 'account-scoped post-attach website navigation requires HTTPS');

const lineAccount = account('LINE1', 'line');
const line = policyForAccount(lineAccount, lineAccount.partition);
assert.equal(line.kind, 'line');
assert.equal(isNavigationAllowed(line, `chrome-extension://${LINE_EXTENSION_ID}/index.html`), true);
assert.equal(isNavigationAllowed(line, 'https://access.line.me/oauth2/v2.1/authorize'), true);
assert.equal(isNavigationAllowed(line, 'https://manager.line.biz/'), false, 'personal LINE must not inherit line-business manager host');
assert.equal(isNavigationAllowed(line, 'https://web.telegram.org/a'), false);

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
assert.equal(policyFromAccountState('persist:webview-page-MISSING', state), null, 'missing account must fail closed');
assert.equal(policyFromAccountState(tgAccount.partition, '{bad json'), null, 'corrupt account state must fail closed');

{
  const guest = guardGuest(tgAccount);
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
  const guest = guardGuest(websiteAccount);
  const otherAccountSite = eventProbe();
  guest.emit('will-navigate', otherAccountSite, 'https://b.example.net/');
  assert.equal(otherAccountSite.prevented, true, 'website A partition must not navigate to website B domain');
  const subdomain = eventProbe();
  guest.emit('will-navigate', subdomain, 'https://chat.a.example.com/');
  assert.equal(subdomain.prevented, false, 'same custom host subdomain remains allowed');
}

{
  const guest = guardGuest(lineAccount);
  const oauth = eventProbe();
  guest.emit('will-navigate', oauth, 'https://access.line.me/oauth2/v2.1/authorize');
  assert.equal(oauth.prevented, false, 'LINE official auth navigation must remain allowed');
  const telegram = eventProbe();
  guest.emit('will-navigate', telegram, 'https://web.telegram.org/a');
  assert.equal(telegram.prevented, true);
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => null });
  const unknown = new FakeContents('persist:webview-page-MISSING');
  app.emit('web-contents-created', {}, unknown);
  unknown.setWindowOpenHandler(() => ({ action: 'allow' }));
  const nav = eventProbe();
  unknown.emit('will-navigate', nav, 'https://web.telegram.org/a');
  assert.equal(nav.prevented, true, 'unresolved account guest must fail closed');
  assert.deepEqual(unknown.popupHandler({ url: 'https://web.telegram.org/a' }), { action: 'deny' });
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => { throw new Error('read failed'); } });
  const broken = new FakeContents('persist:webview-page-TG1');
  app.emit('web-contents-created', {}, broken);
  const nav = eventProbe();
  broken.emit('will-redirect', nav, 'https://web.telegram.org/a');
  assert.equal(nav.prevented, true, 'account-state read failure must fail closed');
}

{
  const app = new EventEmitter();
  installAccountScopedWebviewNavigationBoundary({ app, resolvePolicyForPartition: () => { throw new Error('must not resolve'); } });
  const defaultContents = new FakeContents('');
  app.emit('web-contents-created', {}, defaultContents);
  defaultContents.setWindowOpenHandler(() => ({ action: 'allow' }));
  const nav = eventProbe();
  defaultContents.emit('will-navigate', nav, 'https://example.com/');
  assert.equal(nav.prevented, false, 'non-account webContents must not inherit the WebView account policy');
  assert.deepEqual(defaultContents.popupHandler({ url: 'https://example.com/' }), { action: 'allow' });
}

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const installAt = mainEntry.indexOf('installAccountScopedWebviewNavigationBoundary({');
const resolverAt = mainEntry.indexOf('policyFromAccountState(partition, accountState)');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(installAt >= 0 && resolverAt > installAt && mainAt > resolverAt, 'account-scoped navigation boundary must bind partition policy before legacy main can create WebViews');
assert.match(mainEntry, /runtimePaths\.accountsFile\(earlyUserDataDir\)/, 'policy resolver must read the active profile account store');

console.log('WEBVIEW_NAVIGATION_BOUNDARY_CONTRACT_OK');
