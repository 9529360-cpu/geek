'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeWebsiteUrl } = require('../src/website-url.cjs');
const { policyForAccount, isNavigationAllowed } = require('../src/webview-navigation-boundary.cjs');
const { isAccountPermissionAllowed } = require('../src/session-permission-boundary.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

const appTypes = main.match(/const APP_TYPES = \{([\s\S]*?)\n\};\n\nfunction appTypeConfig/);
assert.ok(appTypes, 'APP_TYPES must remain discoverable');
assert.match(appTypes[1], /website:\s*\{\s*name:\s*'自定义网站',\s*short:\s*'WEB'\s*\}/, 'Website is a first-class platform without a fake default URL');

const addStart = main.indexOf('async function addAccount');
const addEnd = main.indexOf('\nasync function switchAccount', addStart);
const addSource = main.slice(addStart, addEnd);
assert.ok(addStart >= 0 && addEnd > addStart);
assert.ok(addSource.indexOf("normalizeWebsiteUrl(raw.customUrl)") < addSource.indexOf('createAccountId()'), 'Website URL must validate before account id/partition creation');
assert.match(addSource, /raw\.type === undefined \? 'whatsapp' : raw\.type/, 'omitted type keeps the historical WhatsApp default');
assert.match(addSource, /ACCOUNT_TYPE_UNSUPPORTED/, 'explicit unknown types remain fail-closed');

const publicStateStart = main.indexOf('function publicState()');
const publicStateEnd = main.indexOf('\nfunction normalizeConfig', publicStateStart);
const publicStateSource = main.slice(publicStateStart, publicStateEnd);
assert.match(publicStateSource, /account\.type === 'website' && account\.customUrl[\s\S]*url = account\.customUrl/, 'restart/list state must restore Website customUrl as its public URL');
assert.match(main, /function partitionFor\(accountId\)[\s\S]*`\$\{PARTITION_PREFIX\}\$\{accountId\}`/, 'Website reuses the existing per-account persistent partition owner');

const updateStart = main.indexOf("ipcMain.handle('accounts:update'");
const updateEnd = main.indexOf("ipcMain.handle('accounts:move'", updateStart);
const updateSource = main.slice(updateStart, updateEnd);
assert.doesNotMatch(updateSource, /customUrl\s*=/, 'Website customUrl remains immutable after creation');

const securityStart = main.indexOf('function configureWebviewSecurity(window)');
const securityEnd = main.indexOf('\nfunction createMainWindow', securityStart);
const securitySource = main.slice(securityStart, securityEnd);
assert.match(securitySource, /const isWebsite = account\.type === 'website'/);
assert.match(securitySource, /else if \(isWebsite\)[\s\S]*delete webPreferences\.preload;[\s\S]*webPreferences\.contextIsolation = true/, 'Website must strip any guest preload');
assert.match(securitySource, /webPreferences\.nodeIntegration = false/);
assert.match(securitySource, /webPreferences\.nodeIntegrationInSubFrames = false/);
assert.match(securitySource, /webPreferences\.webSecurity = true/);
assert.match(securitySource, /webPreferences\.allowRunningInsecureContent = false/);
assert.match(securitySource, /webPreferences\.sandbox = true/);
assert.match(securitySource, /params\.allowpopups = false/);
assert.match(securitySource, /params\.src = isWebsite \? normalizeWebsiteUrl\(account\.customUrl\) : config\.url/, 'Website initial attach URL must come from immutable customUrl');
assert.match(securitySource, /isWebsite[\s\S]*'contextIsolation=yes,sandbox=true,nativeWindowOpen=no,spellcheck=no'/, 'Website renderer preferences remain hardened');
assert.match(securitySource, /ownerIsWhatsApp[\s\S]*did-finish-load[\s\S]*ownerIsWhatsApp &&/, 'WPP injection must be gated by the owning account type, not URL alone');

assert.match(renderer, /account\.type !== 'line' && account\.type !== 'line-business' && account\.type !== 'website'[\s\S]*setAttribute\('preload'/, 'renderer must not attach Geek bridge preload to Website');
assert.match(renderer, /if \(account\.type !== 'website'\) wv\.setAttribute\('allowpopups'/, 'Website must not opt into renderer popup capability');
assert.match(renderer, /key: 'website', label: '网站'[\s\S]*types: \['website'\]/, 'Website gets its own platform family');
assert.match(renderer, /if \(type === 'website'\) return 'p-icon-website'/, 'Website gets an independent icon class');
assert.match(renderer, /if \(account\.type === 'website'\) throw new Error\('自定义网站暂不支持 Geek 平台增强功能'\)/, 'Website must not receive WA/TG/LINE transport adapters');
assert.match(renderer, /\['btn-broadcast', 'btn-translation', 'btn-contact-notes'\]/, 'Website activation gates unsupported product enhancements');
assert.match(renderer, /if \(account\.type === 'website'\) \{\s*updateUnread\(id, titleUnread\);\s*return;/, 'Website unread fallback reads title only and does not inject DOM scanning scripts');
assert.doesNotMatch(renderer, /if \(p\.type === 'website'\) return/, 'App Center must not hide Website');
assert.match(renderer, /window\.api\.accounts\.add\(\{ name: name\.trim\(\), type, customUrl \}\)/, 'Website creation passes its validated custom URL to main');
assert.match(html, /id="add-website-url-row"[\s\S]*id="add-custom-url"[\s\S]*placeholder="https:\/\/example\.com"/, 'App Center exposes an HTTPS Website URL field');

const url = normalizeWebsiteUrl('https://a.example.com/app');
const a = { id: 'WEB_A', type: 'website', partition: 'persist:webview-page-WEB_A', customUrl: url };
const b = { id: 'WEB_B', type: 'website', partition: 'persist:webview-page-WEB_B', customUrl: url };
assert.notEqual(a.partition, b.partition, 'same Website URL still maps to independent persistent sessions by account id');
const policyA = policyForAccount(a, a.partition);
assert.equal(isNavigationAllowed(policyA, 'https://chat.a.example.com/path'), true);
assert.equal(isNavigationAllowed(policyA, 'https://web.whatsapp.com/'), false);
assert.equal(isNavigationAllowed(policyA, 'https://web.telegram.org/'), false);
assert.equal(isNavigationAllowed(policyA, 'https://line.me/'), false);
assert.equal(isNavigationAllowed(policyA, 'http://a.example.com/'), false);
assert.equal(isNavigationAllowed(policyA, 'file:///tmp/x'), false);
assert.equal(isAccountPermissionAllowed({ policy: policyA, permission: 'notifications', requestingUrl: 'https://a.example.com/' }), true);
for (const permission of ['media', 'display-capture', 'clipboard-read', 'fileSystem', 'hid', 'unknown']) {
  assert.equal(isAccountPermissionAllowed({ policy: policyA, permission, requestingUrl: 'https://a.example.com/' }), false, `Website ${permission} must remain denied`);
}

console.log('WEBSITE_ACCOUNT_LIFECYCLE_SECURITY_CONTRACT_OK');
