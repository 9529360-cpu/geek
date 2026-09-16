'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const owner = read('src/account-state.cjs');
const committedMirror = read('src/committed-state-mirror.cjs');
const accountData = read('src/account-data-boundary.cjs');
const runtimePaths = read('src/runtime-paths.cjs');

assert.match(main, /createAccountStateStore/);
assert.match(main, /const accountState = createAccountStateStore\(/, 'main must compose the single Account State owner');
assert.doesNotMatch(main, /\blet accountsState\b/, 'main must not own canonical account state');
assert.doesNotMatch(main, /\blet persistenceQueue\b/, 'main must not own an account persistence queue');
assert.doesNotMatch(main, /function normalizeStoredState\s*\(/, 'normalization belongs to Account State owner');
assert.doesNotMatch(main, /function persistAccounts\s*\(/, 'account persistence belongs to Account State owner');
assert.doesNotMatch(main, /accountsState\.accounts\.(?:push|splice)/, 'main must not mutate account arrays directly');
assert.doesNotMatch(main, /accountsState\.activeAccountId\s*=/, 'main must not mutate active account directly');
assert.doesNotMatch(main, /\baccountsState\b/, 'main must not retain a second account authority');

assert.match(owner, /let state = \{ activeAccountId: null, accounts: \[\] \}/, 'Account State owner must hold canonical state');
assert.match(owner, /let transactionTail = Promise\.resolve\(\)/, 'Account State owner must serialize whole transitions');
assert.match(owner, /createCommittedStateMirror\(/, 'Account State must delegate raw durable generation ownership to the shared committed-state mirror');
const transaction = owner.match(/function enqueueTransition\(buildCandidate\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.ok(transaction.indexOf('const candidate = cloneState(state)') >= 0);
assert.ok(transaction.indexOf('await durableWrite(candidate)') > transaction.indexOf('const candidate = cloneState(state)'));
assert.ok(transaction.indexOf('state = candidate') > transaction.indexOf('await durableWrite(candidate)'), 'canonical memory commit must happen after durable write');

assert.match(committedMirror, /async function writeSynced\(file, content\)[\s\S]*handle\.writeFile\(content, 'utf8'\)[\s\S]*handle\.sync\(\)[\s\S]*handle\.close\(\)/,
  'shared durable writes must sync and close every temp file before atomic replacement');
const commitBody = committedMirror.match(/async function commit\(content, \{ initializing = false \} = \{\}\) \{([\s\S]*?)\n  \}/)?.[1] || '';
const primaryStage = commitBody.indexOf('await writeSynced(temporaryFile, snapshot)');
const backupStage = commitBody.indexOf('await writeSynced(backupTemporaryFile, snapshot)');
const proofStage = commitBody.indexOf('await writeSynced(commitTemporaryFile, proofText(snapshot))');
const initializingBranch = commitBody.indexOf('if (initializing) {');
const initialProofRename = commitBody.indexOf('await fs.rename(commitTemporaryFile, commitPath)', initializingBranch);
const initialPrimaryPublish = commitBody.indexOf('await publishInitializedPrimary(snapshot, expectedHash)', initializingBranch);
const laterPrimaryRename = commitBody.indexOf('await fs.rename(temporaryFile, filePath)', initialPrimaryPublish);
const laterProofRename = commitBody.indexOf('await fs.rename(commitTemporaryFile, commitPath)', laterPrimaryRename);
assert.ok(primaryStage >= 0 && backupStage > primaryStage && proofStage > backupStage,
  'primary candidate, recovery mirror, and commit proof must all be staged before the commit sequence');
assert.ok(initializingBranch > proofStage && initialProofRename > initializingBranch && initialPrimaryPublish > initialProofRename,
  'first proof-backed commit must publish proof authority before exposing a candidate primary as legacy-looking state');
assert.ok(laterPrimaryRename > initialPrimaryPublish && laterProofRename > laterPrimaryRename,
  'once an older proof exists, candidate primary may stage first but proof rename must remain the authoritative commit point');
assert.match(committedMirror, /async function publishInitializedPrimary\(snapshot, expectedHash\)[\s\S]*fs\.rename\(temporaryFile, filePath\)/,
  'first-proof commit must materialize the primary only through the post-proof helper');
assert.match(committedMirror, /async function syncDirectory\(\)[\s\S]*handle\.sync\(\)/, 'durable replacement must retain best-effort directory sync');
assert.match(committedMirror, /hashSnapshot\(candidate\.content\) !== expectedHash/, 'recovery must reject backup generations that do not match the committed proof');
assert.match(owner, /const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-'/, 'partition identity must remain stable');

function functionBody(name, nextMarker) {
  const start = main.indexOf(`async function ${name}(`);
  const end = main.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `must locate ${name}`);
  return main.slice(start, end);
}

const removeBody = functionBody('removeAccount', '\n\nlet accountIpcBoundary');
const removeCommit = removeBody.indexOf('await accountState.remove(accountId)');
assert.ok(removeCommit >= 0, 'account removal must cross the durable state owner');
for (const effect of ['translationRuntime?.deleteAccount', 'proxyRuntime.forgetPartition', 'webContents.getAllWebContents', 'clearStorageData()', 'notifyAccountsChanged(result.snapshot)']) {
  assert.ok(removeBody.indexOf(effect) > removeCommit, `${effect} must remain a post-commit removal effect`);
}

const updateBody = functionBody('updateAccount', '\n\nasync function moveAccount');
const updateCommit = updateBody.indexOf('await accountState.update(accountId, patchData)');
assert.ok(updateCommit >= 0, 'account update must cross the durable state owner');
assert.ok(updateBody.indexOf('await proxyRuntime.applyAccount') > updateCommit, 'proxy application must remain post-commit');
assert.ok(updateBody.indexOf('notifyAccountsChanged(result.snapshot)') > updateCommit, 'account change notification must remain post-commit');

assert.match(main, /resolveAccountPartition:\s*accountId => accountState\.resolvePartition\(accountId\)/,
  'production Account Data boundary must resolve account existence/partition through Account State owner');
assert.match(accountData, /options\.resolveAccountPartition \|\| createAccountPartitionResolver/, 'fallback parser may remain only as an isolated fallback/test helper');
assert.match(runtimePaths, /function isEmptyAccounts\(value\)/, 'startup migration may inspect only whether a destination is an empty shadow');
assert.doesNotMatch(runtimePaths, /partition|activeAccountId|find\s*\([^)]*account/i, 'runtime-path migration must not become a second account identity/partition authority');

const productionSourceDir = path.join(root, 'src');
const accountJsonParsers = [];
for (const entry of fs.readdirSync(productionSourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:cjs|mjs|js)$/.test(entry.name)) continue;
  const relative = `src/${entry.name}`;
  const source = read(relative);
  if (['src/account-state.cjs', 'src/account-data-boundary.cjs', 'src/runtime-paths.cjs'].includes(relative)) continue;
  if (/accounts\.json/.test(source) && /JSON\.parse/.test(source)) accountJsonParsers.push(relative);
}
assert.deepEqual(accountJsonParsers, [], 'production must not grow another account identity/partition parser outside owner, fallback helper, or startup migration helper');

console.log('ACCOUNT_STATE_PRODUCTION_OWNERSHIP_CONTRACT_OK');
