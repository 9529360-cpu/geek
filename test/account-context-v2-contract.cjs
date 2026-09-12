'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p, 'utf8');
const html = read('ui/index.html');
const app = read('ui/app.js');
const settings = read('ui/settings-controller.js');
const subscription = read('ui/subscription.html');
const main = read('src/main.cjs');
const accountState = read('src/account-state.cjs');

// V2 intentionally rejects PR #275's duplicate personal-center/settings ownership model.
// Subscription state has one owner. The existing subscription home remains canonical; application Settings may expose a read-only mirror.
assert.match(subscription, /id="view-home"/);
assert.doesNotMatch(html, /settings-account-center|geek-account-email|geek-account-quota|geek-account-status/);
assert.doesNotMatch(subscription, /getQuota\(true\)/, 'personal center must not display fail-open quota sentinel');
assert.match(subscription, /subscription\.getState\(\)/);
assert.match(subscription, /subscription\.refresh\(\)/);
assert.match(subscription, /networkError/);
assert.doesNotMatch(subscription, /MAX_SAFE_INTEGER/);

// Ordinary Settings is global-only. Instance settings belong to the right-click target.
assert.doesNotMatch(html, /<button[^>]+data-tab="account"/);
assert.doesNotMatch(html, /id="acc-select"/);
assert.match(html, /id="account-settings-overlay"/);
assert.match(html, /id="account-settings-name"/);
assert.match(html, /id="account-settings-fontSize"/);
assert.match(html, /id="account-settings-fontColor"/);
assert.match(html, /id="proxy-overlay"/);
assert.match(html, /id="proxy-protocal"/);

assert.match(app, /ctxMenu\.dataset\.accountId\s*=\s*account\.id/);
assert.match(app, /function showAccountSettingsDialog\(account\)/);
assert.match(app, /accountSettingsAccountId\s*=\s*account\.id/);
assert.match(app, /window\.api\.accounts\.update\(accountSettingsAccountId,/);
assert.match(app, /function showProxyDialog\(account\)/);
assert.match(app, /proxyAccountId\s*=\s*account\.id/);
assert.match(app, /window\.api\.accounts\.update\(proxyAccountId,/);
assert.match(app, /async function refreshAccountInstance\(accountId\)/);
const refreshBody = app.match(/async function refreshAccountInstance\(accountId\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
assert.match(refreshBody, /wvMap\.get\(accountId\)/);
assert.doesNotMatch(refreshBody, /activeId/);
assert.match(app, /showAccountSettingsDialog\(account\)/);
assert.match(app, /showProxyDialog\(account\)/);

// settings-controller no longer owns account instance persistence.
assert.doesNotMatch(settings, /updateAccount|acc-select|accountPatch|loadAccount\(/);

// Preserve the two real proxy fixes found in v1 audit while the account mutation authority moves out of main.
assert.match(accountState, /raw\.protocal === 'http'/);
assert.match(main, /account\.openProxy \? account : \(configState\.openProxy \? configState : null\)/);

console.log('ACCOUNT_CONTEXT_V2_CONTRACT_OK');