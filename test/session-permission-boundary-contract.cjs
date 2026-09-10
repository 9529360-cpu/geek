'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SUPPORTED_PERMISSION_MATRIX,
  isAccountPermissionAllowed,
  installPermissionHandlersForSession,
  installAccountSessionPermissionBoundary,
} = require('../src/session-permission-boundary.cjs');
const { policyForAccount } = require('../src/webview-navigation-boundary.cjs');

function account(id, type, extra = {}) {
  return { id, type, partition: `persist:webview-page-${id}`, ...extra };
}
function policy(id, type, extra = {}) {
  const owner = account(id, type, extra);
  return policyForAccount(owner, owner.partition);
}

const wa = policy('WA1', 'whatsapp');
const tg = policy('TG1', 'telegram-k');
const line = policy('LINE1', 'line');
const website = policy('WEB1', 'website', { customUrl: 'https://a.example.com/app' });

assert.deepEqual(Object.keys(SUPPORTED_PERMISSION_MATRIX).sort(), [
  'fullscreen',
  'media',
  'notifications',
  'persistent-storage',
]);

for (const currentPolicy of [wa, tg, line]) {
  assert.equal(isAccountPermissionAllowed({ policy: currentPolicy, permission: 'notifications', requestingUrl: currentPolicy.kind === 'whatsapp' ? 'https://web.whatsapp.com/' : currentPolicy.kind === 'telegram' ? 'https://web.telegram.org/k/' : 'https://access.line.me/' }), true);
}
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'notifications', requestingUrl: 'https://a.example.com/' }), true, 'configured Website origin may request notifications');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'notifications', requestingUrl: 'https://chat.a.example.com/' }), true, 'configured Website subdomains inherit notification permission');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'notifications', requestingUrl: 'https://b.example.com/' }), false, 'Website notification permission is account-origin scoped');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'notifications', requestingUrl: 'http://a.example.com/' }), false, 'Website notification permission remains HTTPS-only');

assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'fullscreen', requestingUrl: 'https://web.telegram.org/k/' }), true, 'Telegram Web K has a documented fullscreen video capability');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'fullscreen', requestingUrl: 'https://web.whatsapp.com/' }), false, 'WhatsApp fullscreen is not granted without product evidence');
assert.equal(isAccountPermissionAllowed({ policy: line, permission: 'fullscreen', requestingUrl: 'https://access.line.me/' }), false, 'LINE fullscreen is not granted without product evidence');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'fullscreen', requestingUrl: 'https://a.example.com/' }), false, 'Website fullscreen is outside the MVP permission set');

assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio', 'video'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'media', requestingUrl: 'https://web.telegram.org/k/', mediaTypes: ['video'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: line, permission: 'media', requestingUrl: 'https://access.line.me/', mediaTypes: ['audio'] }), false, 'LINE for Chrome does not support voice/video calls');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'media', requestingUrl: 'https://a.example.com/', mediaTypes: ['audio'] }), false, 'Website microphone permission remains denied');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'media', requestingUrl: 'https://a.example.com/', mediaTypes: ['video'] }), false, 'Website camera permission remains denied');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: [] }), false, 'media without explicit audio/video type must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio', 'screen'] }), false, 'screen capture must not ride the ordinary media grant');

assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'persistent-storage', requestingUrl: 'https://web.whatsapp.com/' }), true, 'WhatsApp official origin may keep its authenticated storage bucket persistent');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'persistent-storage', requestingUrl: 'http://127.0.0.1:1843/' }), true, 'Geek WhatsApp local bootstrap origin may keep the account storage bucket persistent');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'persistent-storage', requestingUrl: 'https://example.com/' }), false, 'WhatsApp persistent storage must stay origin-scoped');
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'persistent-storage', requestingUrl: 'https://web.telegram.org/' }), false, 'Telegram persistent storage remains denied without product evidence');
assert.equal(isAccountPermissionAllowed({ policy: line, permission: 'persistent-storage', requestingUrl: 'https://access.line.me/' }), false, 'LINE persistent storage remains denied without product evidence');
assert.equal(isAccountPermissionAllowed({ policy: website, permission: 'persistent-storage', requestingUrl: 'https://a.example.com/' }), false, 'arbitrary Website persistent storage remains denied');

for (const permission of [
  'display-capture', 'speaker-selection', 'clipboard-read', 'clipboard-sanitized-write',
  'idle-detection', 'geolocation', 'pointerLock', 'midiSysex', 'openExternal', 'hid',
  'serial', 'usb', 'fileSystem', 'automatic-fullscreen', 'local-network-access',
  'screen-wake-lock', 'sensors', 'unknown', 'future-permission',
]) {
  assert.equal(isAccountPermissionAllowed({ policy: wa, permission, requestingUrl: 'https://web.whatsapp.com/' }), false, `${permission} must default deny`);
  assert.equal(isAccountPermissionAllowed({ policy: website, permission, requestingUrl: 'https://a.example.com/' }), false, `Website ${permission} must default deny`);
}
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'clipboard-sanitized-write', requestingUrl: 'https://web.telegram.org/' }), false, 'clipboard write is not granted from a generic compatibility assumption');

assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'notifications', requestingUrl: 'https://web.whatsapp.com/' }), false, 'cross-platform origin must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'notifications', requestingUrl: 'not a url' }), false, 'invalid URL must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: null, permission: 'notifications', requestingUrl: 'https://web.telegram.org/' }), false, 'missing policy must fail closed');

class FakeSession {
  constructor(partition) {
    this.partition = partition;
    this.requestHandler = null;
    this.checkHandler = null;
    this.requestInstallCount = 0;
    this.checkInstallCount = 0;
  }
  setPermissionRequestHandler(handler) { this.requestHandler = handler; this.requestInstallCount += 1; }
  setPermissionCheckHandler(handler) { this.checkHandler = handler; this.checkInstallCount += 1; }
}

{
  const ses = new FakeSession('persist:webview-page-TG1');
  let resolveCount = 0;
  const resolvePolicyForPartition = (partition) => {
    resolveCount += 1;
    return partition === ses.partition ? tg : null;
  };
  assert.equal(installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition }), true);
  assert.equal(installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition }), false, 'one Session must install handlers once');
  assert.equal(ses.requestInstallCount, 1);
  assert.equal(ses.checkInstallCount, 1);

  let granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://web.telegram.org/k/' });
  assert.equal(granted, true);
  assert.equal(ses.checkHandler(null, 'notifications', 'https://web.telegram.org', {}), true, 'request/check must share the same trusted-origin policy');

  granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://web.whatsapp.com/' });
  assert.equal(granted, false);
  assert.equal(ses.checkHandler(null, 'notifications', 'https://web.whatsapp.com', {}), false);

  granted = null;
  ses.requestHandler(null, 'future-permission', value => { granted = value; }, { requestingUrl: 'https://web.telegram.org/' });
  assert.equal(granted, false, 'unknown request permission must fail closed');
  assert.equal(ses.checkHandler(null, 'future-permission', 'https://web.telegram.org', {}), false, 'unknown check permission must fail closed');

  granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, {});
  assert.equal(granted, false, 'missing requestingUrl must fail closed');
  assert.equal(ses.checkHandler(null, 'notifications', '', {}), false, 'missing requestingOrigin must fail closed');
  assert.ok(resolveCount >= 6, 'account policy must be re-resolved per decision so deleted/corrupt owners fail closed');
}

{
  const ses = new FakeSession('persist:webview-page-WA1');
  const resolvePolicyForPartition = partition => partition === ses.partition ? wa : null;
  installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition });

  let granted = null;
  ses.requestHandler(null, 'persistent-storage', value => { granted = value; }, { requestingUrl: 'http://127.0.0.1:1843/' });
  assert.equal(granted, true, 'request path must grant WhatsApp local bootstrap persistent storage');
  assert.equal(ses.checkHandler(null, 'persistent-storage', 'https://web.whatsapp.com', {}), true, 'check path must grant WhatsApp official origin persistent storage');

  granted = null;
  ses.requestHandler(null, 'persistent-storage', value => { granted = value; }, { requestingUrl: 'https://example.com/' });
  assert.equal(granted, false, 'request path must reject persistent storage outside WhatsApp policy');
}

{
  const ses = new FakeSession('persist:webview-page-WEB1');
  const resolvePolicyForPartition = partition => partition === ses.partition ? website : null;
  installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition });

  let granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://a.example.com/path' });
  assert.equal(granted, true);
  assert.equal(ses.checkHandler(null, 'notifications', 'https://chat.a.example.com', {}), true);

  granted = null;
  ses.requestHandler(null, 'media', value => { granted = value; }, { requestingUrl: 'https://a.example.com/', mediaTypes: ['audio', 'video'] });
  assert.equal(granted, false, 'Website media request must remain denied even on its configured origin');
  assert.equal(ses.checkHandler(null, 'display-capture', 'https://a.example.com', {}), false);
}

{
  const ses = new FakeSession('persist:webview-page-MISSING');
  installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition: () => null });
  let granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://web.telegram.org/' });
  assert.equal(granted, false, 'missing account owner must fail closed');
}

{
  const ses = new FakeSession('persist:webview-page-../../broken');
  installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition: () => null });
  let granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://web.telegram.org/' });
  assert.equal(granted, false, 'damaged account partition must fail closed');
}

{
  const listeners = new Map();
  const app = { on(name, listener) { listeners.set(name, listener); } };
  const sessions = new Map();
  const sessionModule = {
    fromPartition(partition) {
      if (!sessions.has(partition)) sessions.set(partition, new FakeSession(partition));
      return sessions.get(partition);
    },
  };
  installAccountSessionPermissionBoundary({
    app,
    sessionModule,
    resolvePolicyForPartition: partition => partition === 'persist:webview-page-TG1' ? tg : null,
  });
  const hostListeners = new Map();
  const host = { on(name, listener) { hostListeners.set(name, listener); }, session: new FakeSession('') };
  listeners.get('web-contents-created')({}, host);
  assert.equal(typeof hostListeners.get('will-attach-webview'), 'function', 'boundary must install before account WebView attachment');
  let prevented = false;
  hostListeners.get('will-attach-webview')({ preventDefault() { prevented = true; } }, {}, { partition: 'persist:webview-page-TG1' });
  assert.equal(prevented, false);
  assert.equal(typeof sessions.get('persist:webview-page-TG1').requestHandler, 'function');
  assert.equal(typeof sessions.get('persist:webview-page-TG1').checkHandler, 'function');

  hostListeners.get('will-attach-webview')({ preventDefault() { throw new Error('must not block non-account webview'); } }, {}, { partition: 'persist:other' });
}

const root = path.join(__dirname, '..');
const mainEntry = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');
const boundarySource = fs.readFileSync(path.join(root, 'src/session-permission-boundary.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const installAt = mainEntry.indexOf('installAccountSessionPermissionBoundary({');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(installAt >= 0 && mainAt > installAt, 'permission boundary must bind before legacy main can create WebViews');
assert.match(mainEntry, /policyFromAccountState\(partition, accountState\)/, 'permission owner resolver must reuse authoritative navigation policy');
assert.match(boundarySource, /setPermissionRequestHandler/);
assert.match(boundarySource, /setPermissionCheckHandler/);
assert.match(boundarySource, /isNavigationAllowed/);
assert.doesNotMatch(boundarySource, /future-permission[^\n]*true|unknown[^\n]*true/i, 'unknown permissions must never become allow by fallback');
assert.doesNotMatch([mainEntry, main].join('\n'), /--no-sandbox|webSecurity\s*=\s*false|nodeIntegration\s*=\s*true/);
assert.match(builder, /runAsNode:\s*false/);
assert.match(builder, /enableEmbeddedAsarIntegrityValidation:\s*true/);

console.log('SESSION_PERMISSION_BOUNDARY_CONTRACT_OK');
