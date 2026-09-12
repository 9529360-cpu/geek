'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const owner = read('src/account-state.cjs');
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
const transaction = owner.match(/function enqueueTransition\(buildCandidate\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.ok(transaction.indexOf('const candidate = cloneState(state)') >= 0);
assert.ok(transaction.indexOf('await durableWrite(candidate)') > transaction.indexOf('const candidate = cloneState(state)'));
assert.ok(transaction.indexOf('state = candidate') > transaction.indexOf('await durableWrite(candidate)'), 'canonical memory commit must happen after durable write');
assert.match(owner, /await fs\.writeFile\(temporaryFile, snapshot, 'utf8'\)[\s\S]*await fs\.rename\(temporaryFile, filePath\)/, 'durable write must remain temp-file then rename');
assert.match(owner, /const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-'/, 'partition identity must remain stable');

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