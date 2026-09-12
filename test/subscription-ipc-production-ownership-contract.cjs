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

const directOwners = [];
for (const entry of fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:cjs|mjs|js)$/.test(entry.name)) continue;
  const relative = `src/${entry.name}`;
  const source = read(relative);
  if (/ipcMain\.handle\('subscription:/.test(source) || /ipcMain\.removeHandler\('subscription:/.test(source)) directOwners.push(relative);
}
assert.deepEqual(directOwners, ['src/subscription-ipc.cjs'], 'subscription IPC must have exactly one direct production owner');

console.log('SUBSCRIPTION_IPC_PRODUCTION_OWNERSHIP_CONTRACT_OK');
