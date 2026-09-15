'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const owner = read('src/subscription-ipc.cjs');

assert.match(main, /const \{ installSubscriptionIpc \} = require\('\.\/subscription-ipc\.cjs'\)/, 'main must compose Subscription IPC owner');
assert.match(main, /subscriptionIpcBoundary = installSubscriptionIpc\(\{/, 'main must install Subscription IPC owner');
assert.match(main, /isTrustedSender:\s*isTrustedSubscriptionSender/, 'main must pass the existing trusted subscription sender policy into the owner');
assert.match(main, /subscriptionIpcBoundary\?\.dispose\(\)/, 'main lifecycle must dispose Subscription IPC owner');
assert.doesNotMatch(main, /registerSubscriptionIpcHandlers/, 'legacy direct subscription IPC registrar must stay removed');
assert.doesNotMatch(main, /ipcMain\.handle\('subscription:/, 'main must not directly register subscription IPC');
assert.doesNotMatch(main, /ipcMain\.removeHandler\('subscription:/, 'main must not directly tear down subscription IPC');

assert.match(owner, /function assertTrustedSender\(event\)/, 'Subscription IPC owner must own the fail-closed sender gate');
assert.match(owner, /if \(!isTrustedSender\(event\)\) throw new Error\('拒绝来自未授权页面的 IPC 请求'\)/, 'sender validation must reject untrusted pages');
assert.match(owner, /ipcMain\.handle\(channel, async \(event, \.\.\.args\) => \{[\s\S]*assertTrustedSender\(event\);[\s\S]*return handler\(\.\.\.args\)/, 'every registered subscription handler must pass through sender validation before work');
assert.match(owner, /for \(const channel of SUBSCRIPTION_CHANNELS\) ipcMain\.removeHandler\(channel\)/, 'owner must own complete teardown');
assert.match(owner, /subscription:get-order-status/, 'current-order status lookup must stay inside the trusted Subscription IPC owner');
assert.match(owner, /getStore\(\)\.myOrders\(\)/, 'order status projection must reuse authenticated store order lookup');
assert.doesNotMatch(owner, /return\s+order\s*;/, 'raw order rows must not cross the IPC boundary');
assert.match(owner, /subscription:translation-readiness/, 'translation readiness must stay inside the trusted Subscription IPC owner');
assert.match(owner, /store\.getTranslationAuthorization\(\)/, 'readiness must use the generation-bound short-lived translation authorization lease');
assert.match(owner, /store\.assertTranslationAuthorizationCurrent\(lease\)/, 'readiness must validate the authorization lease around current-state projection');
assert.match(owner, /return\s+safeReadinessResult\(\{[\s\S]*ready:\s*true,[\s\S]*quota:\s*currentQuota\.quota,[\s\S]*remaining_chars:\s*currentQuota\.remainingChars/, 'successful readiness must return only the bounded safe projection');
assert.doesNotMatch(owner, /token:\s*lease\.token/, 'translation authorization token must never be projected into readiness IPC output');

const expectedChannels = [
  'subscription:get-state',
  'subscription:refresh',
  'subscription:login',
  'subscription:register',
  'subscription:create-order',
  'subscription:get-order-status',
  'subscription:get-quota',
  'subscription:translation-readiness',
  'subscription:logout',
  'subscription:enter-app',
  'subscription:close-window',
];
for (const channel of expectedChannels) {
  assert.ok(owner.includes(`'${channel}'`), `Subscription IPC owner must declare ${channel}`);
}
assert.equal(owner.includes("'subscription:report-usage'"), false, 'obsolete client usage accounting channel must stay retired');

const strayDirectOwners = [];
for (const entry of fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:cjs|mjs|js)$/.test(entry.name)) continue;
  const relative = `src/${entry.name}`;
  if (relative === 'src/subscription-ipc.cjs') continue;
  const source = read(relative);
  if (/ipcMain\.handle\('subscription:/.test(source) || /ipcMain\.removeHandler\('subscription:/.test(source)) strayDirectOwners.push(relative);
}
assert.deepEqual(strayDirectOwners, [], 'no production module outside Subscription IPC owner may directly own subscription channels');

console.log('SUBSCRIPTION_IPC_PRODUCTION_OWNERSHIP_CONTRACT_OK');
