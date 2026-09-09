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

function account(id, type) {
  return { id, type, partition: `persist:webview-page-${id}` };
}
function policy(id, type) {
  const owner = account(id, type);
  return policyForAccount(owner, owner.partition);
}

const wa = policy('WA1', 'whatsapp');
const tg = policy('TG1', 'telegram-k');
const line = policy('LINE1', 'line');

assert.deepEqual(Object.keys(SUPPORTED_PERMISSION_MATRIX).sort(), [
  'fullscreen',
  'media',
  'notifications',
]);

for (const currentPolicy of [wa, tg, line]) {
  assert.equal(isAccountPermissionAllowed({ policy: currentPolicy, permission: 'notifications', requestingUrl: currentPolicy.kind === 'whatsapp' ? 'https://web.whatsapp.com/' : currentPolicy.kind === 'telegram' ? 'https://web.telegram.org/k/' : 'https://access.line.me/' }), true);
}
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'fullscreen', requestingUrl: 'https://web.telegram.org/k/' }), true, 'Telegram Web K has a documented fullscreen video capability');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'fullscreen', requestingUrl: 'https://web.whatsapp.com/' }), false, 'WhatsApp fullscreen is not granted without product evidence');
assert.equal(isAccountPermissionAllowed({ policy: line, permission: 'fullscreen', requestingUrl: 'https://access.line.me/' }), false, 'LINE fullscreen is not granted without product evidence');

assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio', 'video'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'media', requestingUrl: 'https://web.telegram.org/k/', mediaTypes: ['video'] }), true);
assert.equal(isAccountPermissionAllowed({ policy: line, permission: 'media', requestingUrl: 'https://access.line.me/', mediaTypes: ['audio'] }), false, 'LINE for Chrome does not support voice/video calls');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: [] }), false, 'media without explicit audio/video type must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: wa, permission: 'media', requestingUrl: 'https://web.whatsapp.com/', mediaTypes: ['audio', 'screen'] }), false, 'screen capture must not ride the ordinary media grant');

for (const permission of [
  'display-capture', 'speaker-selection', 'clipboard-read', 'clipboard-sanitized-write',
  'idle-detection', 'geolocation', 'pointerLock', 'midiSysex', 'openExternal', 'hid',
  'serial', 'usb', 'fileSystem', 'automatic-fullscreen', 'local-network-access',
  'persistent-storage', 'screen-wake-lock', 'sensors', 'unknown', 'future-permission',
]) {
  assert.equal(isAccountPermissionAllowed({ policy: wa, permission, requestingUrl: 'https://web.whatsapp.com/' }), false, `${permission} must default deny`);
}
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'clipboard-sanitized-write', requestingUrl: 'https://web.telegram.org/' }), false, 'clipboard write is not granted from a generic compatibility assumption');

assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'notifications', requestingUrl: 'https://web.whatsapp.com/' }), false, 'cross-platform origin must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: tg, permission: 'notifications', requestingUrl: 'not a url' }), false, 'invalid URL must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: null, permission: 'notifications', requestingUrl: 'https://web.telegram.org/' }), false, 'missing policy must fail closed');
assert.equal(isAccountPermissionAllowed({ policy: { kind: 'website', hostname: 'example.com' }, permission: 'notifications', requestingUrl: 'https://example.com/' }), false, 'website account support is outside this security change');

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
  const ses = new FakeSession('persist:webview-page-MISSING');
  installPermissionHandlersForSession({ session: ses, partition: ses.partition, resolvePolicyForPartition: () => null });
  let granted = null;
  ses.requestHandler(null, 'notifications', value => { granted = value; }, { requestingUrl: 'https://web.telegram.org/' });
  assert.equal(granted, false, 'missing account owner must fail closed');
  assert.equal(ses.checkHandler(null, 'notifications', 'https://web.telegram.org', {}), false);
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
