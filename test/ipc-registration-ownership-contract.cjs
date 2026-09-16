'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const file of collectSourceFiles(path.join(root, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  assert.doesNotMatch(source, /ipcMain\.handle\s*=/, `production source must not replace ipcMain.handle: ${rel}`);
  assert.doesNotMatch(source, /Object\.defineProperty\(\s*ipcMain|new Proxy\(\s*ipcMain|Object\.setPrototypeOf\(\s*ipcMain|ipcMain\.__proto__/, `production source must not monkey-patch ipcMain another way: ${rel}`);
}

const main = read('src/main.cjs');
const mainEntry = read('src/main-entry.cjs');
const broadcast = read('src/broadcast-files.cjs');
const accountData = read('src/account-data-boundary.cjs');
const accountIpc = read('src/account-ipc.cjs');
const accountState = read('src/account-state.cjs');
const preload = read('src/preload.cjs');

for (const channel of ['file:pick', 'file:pick-csv', 'broadcast:send-file', 'broadcast:attach-file', 'broadcast:drop-file']) {
  assert.equal(main.includes(`ipcMain.handle('${channel}'`), false, `legacy raw attachment IPC must not be registered by main: ${channel}`);
  assert.equal(preload.includes(`ipcRenderer.invoke('${channel}'`), false, `preload must not invoke legacy raw attachment IPC: ${channel}`);
}

for (const channel of ['file:pick-token','file:pick-csv-limited','file:release-tokens','broadcast:send-file-token','broadcast:attach-file-token','broadcast:drop-file-token','broadcast:telegram-files-token']) {
  assert.ok(broadcast.includes(channel), `broadcast-files must declare safe channel ${channel}`);
}
assert.match(broadcast, /registry\.resolve\(source\.fileToken, ownerId\)/, 'token transports must resolve capabilities under the renderer owner');
assert.match(broadcast, /delete safePayload\.fileToken;[\s\S]*delete safePayload\.filePath;[\s\S]*safePayload\.filePath = selected\.filePath;/, 'canonical path must be materialized only inside main-process transport payload');

for (const channel of ['account-data:get-all','account-data:set','account-data:remove']) {
  assert.ok(accountData.includes(`register('${channel}'`), `account-data owner must directly register ${channel}`);
  assert.equal(main.includes(`ipcMain.handle('${channel}'`), false, `main must not duplicate account-data channel ${channel}`);
}
for (const channel of ['accounts:list','accounts:add','accounts:remove','accounts:switch','accounts:update','accounts:move','accounts:move-to']) {
  assert.ok(accountIpc.includes(`'${channel}'`), `Account IPC owner must declare ${channel}`);
  assert.equal(main.includes(`ipcMain.handle('${channel}'`), false, `main must not directly register Account channel ${channel}`);
}
assert.match(accountIpc, /normalizeAccountAddPayload\(payload\)/, 'accounts:add must cross the ingress payload gate before mutation');
assert.match(accountIpc, /assertAuthorizedSender\(event\)[\s\S]*normalizeAccountAddPayload/, 'sender validation must precede accounts:add payload processing');
assert.match(accountIpc, /assertMainFrameIpcSender\(event\)[\s\S]*assertTrustedSender\(event\)/, 'Account IPC must authenticate the exact sending main frame before the broader WebContents sender guard');
assert.match(accountIpc, /dispose\(\)[\s\S]*ipcMain\.removeHandler/, 'Account IPC owner must own teardown');
assert.match(main, /const accountState = createAccountStateStore\(/, 'main composes but does not own account state');
assert.match(main, /resolveAccountPartition:\s*accountId => accountState\.resolvePartition\(accountId\)/, 'Account Data production existence/partition resolution must come from Account State owner');
assert.match(main, /removeAccount:\s*\(event, accountId\) => accountDataBoundary\.runAccountRemoval\(event, accountId, removeAccount\)/, 'accounts:remove must explicitly cross the account-data deletion lifecycle');
assert.match(accountData, /createAccountRemovalCleanupJournal/, 'account removal owner must compose durable post-commit cleanup authority');
assert.match(accountData, /store\.beginDelete\(partition\)[\s\S]*cleanupJournal\.markPending\([\s\S]*removeImplementation\(/, 'durable cleanup finalizer must be persisted before authoritative account deletion starts');
assert.match(accountData, /async function settleCommittedRemoval[\s\S]*committedAccountCleanup[\s\S]*cleanupJournal\.clear\(accountId\)[\s\S]*store\.finalizeDelete\(partition\)/, 'committed child cleanup must settle before clearing the finalizer and in-memory delete barrier');
assert.match(accountData, /ACCOUNT_DATA_ACCOUNT_MISSING[\s\S]*settleCommittedRemoval/, 'a parent delete that committed before throwing must enter committed cleanup rather than rollback');
assert.match(accountData, /cleanupPending:\s*true/, 'committed delete with later cleanup failure must preserve cleanupPending success');
assert.match(accountState, /ACCOUNT_TYPE_UNSUPPORTED/, 'authoritative account mutation must reject unsupported account types');
assert.match(accountState, /raw\.type === undefined \? 'whatsapp' : raw\.type/, 'historical default account type remains WhatsApp');
assert.doesNotMatch(mainEntry, /installAccountTypeBoundary|installBroadcastFileBoundary|installAccountDataBoundary/, 'main-entry must not host deferred IPC registration shims');

const singleIndex = mainEntry.indexOf('installSingleInstanceGuard');
const sessionIndex = mainEntry.indexOf('installSessionPartitionCompat');
const navigationIndex = mainEntry.indexOf('installAccountScopedWebviewNavigationBoundary');
const permissionIndex = mainEntry.indexOf('installAccountSessionPermissionBoundary');
const requireMainIndex = mainEntry.indexOf("require('./main.cjs')");
assert.ok(singleIndex >= 0 && sessionIndex > singleIndex && navigationIndex > sessionIndex && permissionIndex > navigationIndex && requireMainIndex > permissionIndex, 'single-instance and early runtime/security boundaries must remain ahead of main startup');

console.log('IPC_REGISTRATION_OWNERSHIP_CONTRACT_OK');