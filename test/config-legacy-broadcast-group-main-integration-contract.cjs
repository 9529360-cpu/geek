'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8').replace(/\r\n?/g, '\n');

const startupAt = main.indexOf('app.whenReady().then(async () => {');
assert.ok(startupAt >= 0, 'main startup owner must exist');
const startup = main.slice(startupAt);

const accountLoadAt = startup.indexOf('await accountState.load()');
const configLoadAt = startup.indexOf('await configStore.load()');
const orphanCleanupAt = startup.indexOf('await configStore.removeOrphanedLegacyBroadcastGroups(liveAccountIds)');
const proxyInstallAt = startup.indexOf('proxyRuntime.installAuthenticationHandler()');
const ipcInstallAt = startup.indexOf('registerIpcHandlers()');

assert.ok(
  accountLoadAt >= 0
    && configLoadAt > accountLoadAt
    && orphanCleanupAt > configLoadAt
    && proxyInstallAt > orphanCleanupAt
    && ipcInstallAt > proxyInstallAt,
  'startup legacy-group reconciliation must run after both state owners load and before renderer IPC is installed',
);
assert.match(
  startup,
  /const liveAccountIds = accountState\.getSnapshot\(\)\.accounts\.map\(account => account\.id\);[\s\S]*?removeOrphanedLegacyBroadcastGroups\(liveAccountIds\)/,
  'startup reconciliation must derive owners only from authoritative Account State',
);
assert.match(
  startup,
  /diagnostics\.log\('legacy-broadcast-groups-reconciled', \{ removed: reconciliation\.removed \}\)/,
  'successful cleanup diagnostics may expose only aggregate removed count',
);
assert.match(
  startup,
  /const code = typeof error\?\.code === 'string' \? error\.code : String\(error\?\.name \|\| 'UNKNOWN'\);[\s\S]*?legacy broadcast group cleanup retry required:[\s\S]*?code\.slice\(0, 80\)/,
  'startup cleanup failure must remain retryable without logging Config State contents or account ids',
);
assert.doesNotMatch(
  startup,
  /legacy-broadcast-groups-reconciled[^\n]*(?:accountId|broadcastGroups|chatIds|name)/,
  'startup cleanup diagnostics must not emit legacy group/account contents',
);

console.log('CONFIG_LEGACY_BROADCAST_GROUP_MAIN_INTEGRATION_CONTRACT_OK');
