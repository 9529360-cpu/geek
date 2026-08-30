'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accountCenter = require('../ui/account-center.js');

assert.equal(accountCenter.planLabel('basic'), '基础包 · 100 万字符');
assert.equal(accountCenter.planLabel('standard'), '标准包 · 150 万字符');
assert.equal(accountCenter.orderStatusLabel('paid'), '已完成');
assert.equal(accountCenter.orderStatusLabel('pending'), '待确认');
assert.deepEqual(
  accountCenter.normalizeOrders({ orders: [null, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }] }).map(item => item.id),
  [1, 2, 3, 4, 5],
);

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ui = read('ui/account-center.js');
const css = read('ui/account-center.css');
const loader = read('ui/version-label.js');
const preload = read('src/preload.cjs');
const entry = read('src/main-entry.cjs');
const boundary = read('src/account-center-boundary.cjs');

assert.match(ui, /profileTab\.textContent = '个人中心'/);
assert.match(ui, /globalTab\.textContent = '应用设置'/);
assert.match(ui, /accountTab\.style\.display = 'none'/);
assert.doesNotMatch(ui, /decorateContextMenu|ctx-menu/, 'personal center must not own or mutate the navigation context menu');
assert.match(ui, /字符只用于翻译；用完后 WhatsApp、Telegram、LINE 仍可正常使用/);
assert.match(ui, /subscription\.getQuota/);
assert.match(ui, /subscription\.myOrders/);
assert.match(ui, /subscription\.createOrder/);
assert.match(ui, /subscription\.openPasswordReset/);
assert.match(ui, /subscription\.logout/);
assert.match(ui, /window\.api\.window\.relaunch/);
assert.match(ui, /title\.textContent =/);
assert.match(ui, /meta\.textContent =/);
assert.match(ui, /geek-profile-email'\)\.textContent =/);

assert.match(loader, /script\.src = '\.\/account-center\.js'/);
assert.doesNotMatch(loader, /ctx-menu|simplifyAccountContextMenu/, 'version label loader must not own or mutate the navigation context menu');
assert.match(css, /#ctx-menu \.ctx-item\[data-act="edit"\]::after \{ content: '账号设置'/);
assert.match(css, /#ctx-menu \.ctx-item\[data-act="proxy"\] \{ display: none; \}/);

assert.match(preload, /myOrders: \(\) => invokeSubscription\('subscription:my-orders'\)/);
assert.match(preload, /openPasswordReset: \(\) => invokeSubscription\('subscription:open-password-reset'\)/);
assert.match(preload, /subscription-forgot-password/);
assert.match(preload, /invokeSubscription\('subscription:get-state'\)/);
assert.match(preload, /if \(state\?\.loggedIn\) return invokeSubscription\('subscription:enter-app'\)/);

assert.match(entry, /installAccountCenterBoundary\(\{/);
assert.ok(entry.indexOf('installAccountCenterBoundary({') < entry.indexOf("require('./main.cjs')"), 'account center IPC must be installed before legacy main starts');
assert.match(boundary, /const PASSWORD_RESET_URL = 'https:\/\/geek\.bbnba\.com\/forgot-password'/);
assert.doesNotMatch(boundary, /openExternal\([^P]/, 'renderer must not choose an arbitrary external URL');

console.log('ACCOUNT_CENTER_UI_CONTRACT_OK');
