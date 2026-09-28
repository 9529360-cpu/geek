'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { platformConfig } = require('../src/platform-catalog.cjs');
const { policyForAccount, isNavigationAllowed } = require('../src/webview-navigation-boundary.cjs');
const { isAccountPermissionAllowed } = require('../src/session-permission-boundary.cjs');

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
const semanticController = read('ui/semantic-send-intent-controller.js');

const config = platformConfig('instagram');
assert.equal(config?.url, 'https://www.instagram.com/direct/inbox/');
assert.equal(config?.navigationKind, 'instagram');
assert.deepEqual(Array.from(config?.hostnames || []), ['www.instagram.com', 'instagram.com']);

const account = { id: 'IG1', type: 'instagram', partition: 'persist:webview-page-IG1' };
const policy = policyForAccount(account, account.partition);
assert.equal(policy?.kind, 'instagram');
assert.equal(isNavigationAllowed(policy, 'https://www.instagram.com/direct/inbox/'), true);
assert.equal(isNavigationAllowed(policy, 'https://instagram.com/accounts/login/'), true);
assert.equal(isNavigationAllowed(policy, 'https://example.com/direct/inbox/'), false);
assert.equal(isNavigationAllowed(policy, 'http://www.instagram.com/direct/inbox/'), false);

assert.equal(isAccountPermissionAllowed({
  policy,
  permission: 'notifications',
  requestingUrl: 'https://www.instagram.com/direct/inbox/',
}), true);
for (const permission of ['media', 'persistent-storage', 'fullscreen', 'geolocation', 'display-capture']) {
  assert.equal(isAccountPermissionAllowed({
    policy,
    permission,
    requestingUrl: 'https://www.instagram.com/direct/inbox/',
    mediaTypes: ['audio', 'video'],
  }), false, 'Instagram phase 1 must fail closed for ' + permission);
}

assert.match(preload, /platform:\s*'instagram'/);
assert.match(preload, /event\?\.isTrusted !== true/);
assert.match(preload, /data-geek-native-submit-commit/);
assert.match(webview, /instagramSendIntent\.isInstagramType/);
assert.match(webview, /instagramSendIntent\.commitGuardScript/);
assert.match(app, /family === 'instagram'/);
assert.match(app, /syncMetaTranslationCfgToWebview/);
assert.match(app, /executePlatformOutgoingSendIntent/);
assert.match(translation, /instagram:\s*new Set\(\['instagram'\]\)/);
assert.match(workbench, /Instagram/);
assert.match(app, /textOnlyFamily === 'messenger' \|\| textOnlyFamily === 'instagram'[\s\S]*broadcastFiles\.length[\s\S]*return;/);
assert.match(app, /platform\.family === 'messenger' \|\| platform\.family === 'instagram'/);
assert.match(broadcastRuntime, /INSTAGRAM_TEXT_ONLY/);
assert.match(main, /targetPlatform === 'instagram'[^\r\n]*INSTAGRAM_ATTACHMENTS_UNSUPPORTED/);
assert.match(broadcastRuntime, /ctx\.platform\.family === 'messenger' \|\| ctx\.platform\.family === 'instagram'/);
assert.ok(style.includes('.p-icon-instagram { background: linear-gradient('));
assert.match(index, /platform-host-adapters\.js[\s\S]*instagram-platform-extension\.js[\s\S]*platform-capabilities\.js/);
assert.match(index, /semantic-send-intent-controller\.js[\s\S]*instagram-send-intent-controller\.js[\s\S]*app\.js/);
assert.match(catalog, /INSTAGRAM_WEB_URL = 'https:\/\/www\.instagram\.com\/direct\/inbox\/'/);
assert.match(semanticController, /delivery\?\.owner !== 'send-intent'/);
assert.doesNotMatch([app, preload, webview].join('\n'), /instagram\.com\/api|graphql\/query/i);

console.log('INSTAGRAM_PLATFORM_INTEGRATION_CONTRACT_OK');
