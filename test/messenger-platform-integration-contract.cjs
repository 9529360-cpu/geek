'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  platformConfig,
} = require('../src/platform-catalog.cjs');
const {
  policyForAccount,
  isNavigationAllowed,
} = require('../src/webview-navigation-boundary.cjs');
const {
  isAccountPermissionAllowed,
} = require('../src/session-permission-boundary.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const app = read('ui/app.js');
const index = read('ui/index.html');
const preload = read('resources/bridge-preload.cjs');
const webview = read('src/webview-ipc.cjs');
const catalog = read('src/platform-catalog.cjs');
const main = read('src/main.cjs');
const translation = read('ui/translation-core.js');
const workbench = read('ui/broadcast-workbench.js');
const broadcastRuntime = read('ui/broadcast-runtime.js');
const style = read('ui/style.css');

const config = platformConfig('messenger');
assert.equal(config?.url, 'https://www.facebook.com/messages/');
assert.equal(config?.navigationKind, 'messenger');
assert.deepEqual(Array.from(config?.hostnames || []), ['www.facebook.com', 'facebook.com']);
assert.doesNotMatch(config?.url || '', /messenger\.com/i, 'retired messenger.com must not be the runtime entrypoint');

const account = { id: 'MSG1', type: 'messenger', partition: 'persist:webview-page-MSG1' };
const policy = policyForAccount(account, account.partition);
assert.equal(policy?.kind, 'messenger');
assert.equal(isNavigationAllowed(policy, 'https://www.facebook.com/messages/t/123'), true);
assert.equal(isNavigationAllowed(policy, 'https://facebook.com/messages/e2ee/t/456'), true);
assert.equal(isNavigationAllowed(policy, 'https://messenger.com/'), false);
assert.equal(isNavigationAllowed(policy, 'https://example.com/'), false);

assert.equal(isAccountPermissionAllowed({
  policy,
  permission: 'notifications',
  requestingUrl: 'https://www.facebook.com/messages/',
}), true);
for (const permission of ['media', 'persistent-storage', 'fullscreen', 'geolocation', 'display-capture']) {
  assert.equal(isAccountPermissionAllowed({
    policy,
    permission,
    requestingUrl: 'https://www.facebook.com/messages/',
    mediaTypes: ['audio', 'video'],
  }), false, 'Messenger phase 1 must fail closed for ' + permission);
}

assert.match(preload, /platform:\s*'messenger'/);
assert.match(preload, /event\?\.isTrusted !== true/);
assert.match(preload, /data-geek-native-submit-commit/);
assert.match(webview, /messengerSendIntent\.isMessengerType/);
assert.match(webview, /messengerSendIntent\.commitGuardScript/);
assert.match(app, /family === 'messenger'/);
assert.match(app, /syncMessengerTranslationCfgToWebview/);
assert.match(app, /executePlatformOutgoingSendIntent/);
assert.match(translation, /messenger:\s*new Set\(\['messenger'\]\)/);
assert.match(workbench, /Messenger/);
assert.match(app, /familyOf\(account\.type\)\.key === 'messenger'[\s\S]*broadcastFiles\.length[\s\S]*return;/, 'manual Messenger broadcast must fail closed for attachments and unsupported extras');
assert.match(app, /platform.family === 'messenger' && sentOk === 'MAYBE'/, 'manual Messenger broadcast must not retry after ambiguous native commit');
assert.match(broadcastRuntime, /MESSENGER_TEXT_ONLY/, 'scheduled Messenger broadcast must fail closed for unsupported attachments, vcards, or tag-all');
assert.match(main, /targetPlatform === 'messenger'[^\r\n]*MESSENGER_ATTACHMENTS_UNSUPPORTED/, 'main-process generic drop transport must fail closed for Messenger attachments');
assert.match(broadcastRuntime, /ctx.platform.family === 'messenger' && sent === 'MAYBE'/, 'scheduled Messenger broadcast must not retry after ambiguous native commit');
assert.ok(style.includes('.p-icon-messenger { background: #0084ff; }'));
assert.match(index, /platform-host-adapters\.js[\s\S]*messenger-platform-extension\.js[\s\S]*platform-capabilities\.js/);
assert.match(index, /messenger-send-intent-controller\.js[\s\S]*app\.js/);
assert.match(catalog, /MESSENGER_WEB_URL = 'https:\/\/www\.facebook\.com\/messages\/'/);
assert.doesNotMatch([app, preload, webview].join('\n'), /messenger\.com/i);

console.log('MESSENGER_PLATFORM_INTEGRATION_CONTRACT_OK');
