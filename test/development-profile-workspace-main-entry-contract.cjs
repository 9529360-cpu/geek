'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const prepareIndex = source.indexOf('prepareUserDataPath({');
const claimIndex = source.indexOf('claimDevelopmentProfileWorkspace({');
const singleInstanceIndex = source.indexOf('installSingleInstanceGuard({ app, BrowserWindow })');

assert.match(source, /require\(['"]\.\/development-profile-workspace\.cjs['"]\)/);
assert.ok(claimIndex > prepareIndex, 'workspace claim must run only after the userData path is safely prepared');
assert.ok(singleInstanceIndex > claimIndex, 'workspace ownership must fail closed before the profile can become the primary instance');
assert.match(
  source,
  /claimDevelopmentProfileWorkspace\(\{[\s\S]*?profile:\s*runtimeIdentity\.profile,[\s\S]*?userDataDir:\s*earlyUserDataDir,[\s\S]*?workspaceDir:\s*app\.getAppPath\(\),[\s\S]*?fs:\s*nodeFs,[\s\S]*?\}\);/,
);

console.log('DEVELOPMENT_PROFILE_WORKSPACE_MAIN_ENTRY_CONTRACT_OK');
