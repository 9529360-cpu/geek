'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This contract is also the required-check oracle for the post-FH-02 ownership boundary.
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const stateOwner = read('src/config-state.cjs');
const committedMirror = read('src/committed-state-mirror.cjs');
const ipcOwner = read('src/config-ipc.cjs');

assert.match(main, /createConfigStateStore/);
assert.match(main, /const configStore = createConfigStateStore\(/, 'main must compose, not own, config state');
assert.match(main, /installConfigIpc/);
assert.match(main, /configIpcBoundary = installConfigIpc\(/, 'main must compose the direct Config IPC owner');

assert.doesNotMatch(main, /\bconfigState\b/, 'main must not retain canonical config state');
assert.doesNotMatch(main, /\bconfigQueue\b/, 'main must not retain a config write queue');
assert.doesNotMatch(main, /\bpersistConfig\b/, 'main must not own config persistence');
assert.doesNotMatch(main, /\bnormalizeConfig\b/, 'main must not own config normalization');
assert.doesNotMatch(main, /function\s+loadConfig\s*\(/, 'main must not own config startup loading');
assert.doesNotMatch(main, /ipcMain\.handle\(['"]config:/, 'main must not directly register config IPC');
assert.doesNotMatch(main, /ipcMain\.removeHandler\(['"]config:/, 'main must not maintain config IPC teardown strings');

assert.match(stateOwner, /const DEFAULT_CONFIG = Object\.freeze\(/);
assert.match(stateOwner, /let state = cloneConfig\(DEFAULT_CONFIG\)/);
assert.match(stateOwner, /let transactionTail = Promise\.resolve\(\)/);
assert.match(stateOwner, /createCommittedStateMirror\(/, 'Config State must delegate raw durable generation ownership to the shared committed-state mirror');
const updateBody = stateOwner.match(/function update\(patchData = \{\}\) \{([\s\S]*?)\n  \}/)?.[1] || '';
const candidateAt = updateBody.indexOf('const candidate = normalizeConfig');
const durableAt = updateBody.indexOf('await durableWrite(candidate)');
const commitAt = updateBody.indexOf('state = candidate');
assert.ok(candidateAt >= 0 && durableAt > candidateAt && commitAt > durableAt, 'config transaction must commit memory only after durable write');
assert.match(stateOwner, /CONFIG_STATE_RECOVERY_REQUIRED/);
assert.match(stateOwner, /CONFIG_STATE_SECRET_DECRYPT_FAILED/);

assert.match(committedMirror, /async function writeSynced\(file, content\)[\s\S]*handle\.writeFile\(content, 'utf8'\)[\s\S]*handle\.sync\(\)[\s\S]*handle\.close\(\)/,
  'shared Config/Account durable writes must fsync and close temp files when supported');
const sharedCommitBody = committedMirror.match(/async function commit\(content, \{ initializing = false \} = \{\}\) \{([\s\S]*?)\n  \}/)?.[1] || '';
const primaryRename = sharedCommitBody.indexOf('await fs.rename(temporaryFile, filePath)');
const proofRename = sharedCommitBody.indexOf('await fs.rename(commitTemporaryFile, commitPath)');
assert.ok(primaryRename >= 0 && proofRename > primaryRename,
  'shared persistence must make the proof rename the authoritative commit point after the candidate primary becomes visible');
assert.match(committedMirror, /async function syncDirectory\(\)[\s\S]*handle\.sync\(\)/,
  'shared durable replacement must retain best-effort directory sync');
assert.match(committedMirror, /hashSnapshot\(candidate\.content\) !== expectedHash/,
  'Config recovery must reject backup generations that do not match committed proof');

assert.match(ipcOwner, /ipcMain\.handle\(CONFIG_GET_CHANNEL, getHandler\)/);
assert.match(ipcOwner, /ipcMain\.handle\(CONFIG_SET_CHANNEL, setHandler\)/);
assert.match(ipcOwner, /const snapshot = await store\.update\(patchData\)[\s\S]*await onCommitted\(snapshot\)/,
  'Config IPC side effects must be strictly post-commit');
assert.match(ipcOwner, /ipcMain\.removeHandler\(CONFIG_GET_CHANNEL\)/);
assert.match(ipcOwner, /ipcMain\.removeHandler\(CONFIG_SET_CHANNEL\)/);

const configInstall = main.match(/configIpcBoundary = installConfigIpc\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';
const committedAt = configInstall.indexOf('onCommitted: async');
for (const effect of ['applyLoginItemSettings(config)', 'proxyRuntime.applyAccounts(', 'notifyAccountsChanged(snapshot)']) {
  assert.ok(configInstall.indexOf(effect) > committedAt, `${effect} must stay in the post-commit callback`);
}

assert.match(main, /Promise\.all\(\[accountState\.whenIdle\(\), configStore\.whenIdle\(\)\]\)/,
  'crash relaunch must wait for both durable state owners');
assert.match(main, /await configStore\.load\(\)/, 'startup must load through Config State owner');
assert.match(main, /configIpcBoundary\?\.dispose\(\)/, 'teardown must delegate to Config IPC owner');

console.log('CONFIG_STATE_PRODUCTION_OWNERSHIP_CONTRACT_OK');
