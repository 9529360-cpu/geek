'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeWebsiteUrl } = require('../src/website-url.cjs');
const { policyForAccount, isNavigationAllowed } = require('../src/webview-navigation-boundary.cjs');
const { isAccountPermissionAllowed } = require('../src/session-permission-boundary.cjs');

const root = path.join(__dirname, '..');
const readText = (relativePath) => fs
  .readFileSync(path.join(root, relativePath), 'utf8')
  .replace(/\r\n?/g, '\n');
const main = readText('src/main.cjs');
const owner = readText('src/account-state.cjs');
const catalog = readText('src/platform-catalog.cjs');
const renderer = readText('ui/app.js');
const html = readText('ui/index.html');

assert.match(catalog, /website:\s*freezeConfig\(\{\s*name:\s*'自定义网站',\s*short:\s*'WEB',\s*navigationKind:\s*'website',?\s*\}\)/, 'Website is a first-class platform without a fake default URL');
assert.doesNotMatch(main, /const APP_TYPES\s*=/, 'main must consume, not duplicate, the platform catalog');
assert.match(main, /normalizeWebsiteUrl,\s*\n\s*isEncryptionAvailable/, 'Website URL policy must be injected into Account State owner');
assert.match(owner, /const type = raw\.type === undefined \? 'whatsapp' : raw\.type/, 'omitted type keeps the historical WhatsApp default');
assert.match(owner, /ACCOUNT_TYPE_UNSUPPORTED/, 'explicit unknown types remain fail-closed');
assert.match(owner, /type === 'website' \? normalizeWebsiteUrl\(raw\.customUrl\) : ''/, 'Website customUrl must be validated by the existing URL authority before creation');
assert.match(owner, /const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-'/, 'Website reuses the existing per-account persistent partition identity');
const updateStart = owner.indexOf('function update(accountId, patchData)');
const updateEnd = owner.indexOf('\n  function move(', updateStart);
const updateSource = owner.slice(updateStart, updateEnd);
assert.ok(updateStart >= 0 && updateEnd > updateStart);
assert.doesNotMatch(updateSource, /customUrl\s*=/, 'Website customUrl remains immutable after creation');

const publicStateStart = main.indexOf('function publicState(');
const publicStateEnd = main.indexOf('\nfunction normalizeConfig', publicStateStart);
const publicStateSource = main.slice(publicStateStart, publicStateEnd);
assert.match(publicStateSource, /account\.type === 'website' && account\.customUrl[\s\S]*url = account\.customUrl/, 'restart/list projection must restore Website customUrl as its public URL');

const securityStart = main.indexOf('function configureWebviewSecurity(window)');
const securityEnd = main.indexOf('\nlet subscriptionWindow', securityStart);
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
