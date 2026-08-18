'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const allowedDataFiles = [
  'data/accounts.example.json',
  'data/config.example.json'
];
const forbiddenRuntimeFiles = [
  'data/accounts.json',
  'data/config.json'
];

function runGit(args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
}

const listed = runGit(['ls-files', '-z', '--', 'data']);
if (listed.error || listed.status !== 0) {
  throw new Error('unable to enumerate tracked data files');
}
const trackedDataFiles = listed.stdout
  .split('\0')
  .filter(Boolean)
  .sort();
const expectedDataFiles = [...allowedDataFiles].sort();
if (JSON.stringify(trackedDataFiles) !== JSON.stringify(expectedDataFiles)) {
  throw new Error(`unexpected tracked data files: ${trackedDataFiles.join(', ') || '(none)'}`);
}

for (const runtimeFile of forbiddenRuntimeFiles) {
  const ignored = runGit(['check-ignore', '-q', runtimeFile]);
  if (ignored.error || ignored.status !== 0) {
    throw new Error(`runtime data path must stay ignored: ${runtimeFile}`);
  }
}

const configExample = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'config.example.json'), 'utf8')
);
for (const field of ['lockPassword', 'host', 'port', 'login', 'password']) {
  if (String(configExample[field] || '') !== '') {
    throw new Error(`example config sensitive/runtime field must stay empty: ${field}`);
  }
}

const accountsExample = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'accounts.example.json'), 'utf8')
);
if (accountsExample.activeAccountId !== null) {
  throw new Error('example accounts activeAccountId must stay null');
}
if (!Array.isArray(accountsExample.accounts) || accountsExample.accounts.length !== 0) {
  throw new Error('example accounts list must stay empty');
}

console.log('RUNTIME_DATA_TRACKING_CONTRACT_OK');
