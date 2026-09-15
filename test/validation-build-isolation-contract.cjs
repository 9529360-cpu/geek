'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const validation = fs.readFileSync(path.join(root, 'electron-builder.validation.yml'), 'utf8');
const production = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const validationWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-validation-client.yml'), 'utf8');
const mainEntry = fs.readFileSync(path.join(root, 'src', 'main-entry.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

assert.match(pkg.scripts.pack, /--config\s+electron-builder\.validation\.yml/);
assert.match(pkg.scripts['dist:test'], /--config\s+electron-builder\.validation\.yml/);
assert.equal(pkg.scripts.dist, 'node scripts/release-build.cjs');
assert.match(validation, /^appId:\s*com\.stardust\.geek\.validation\s*$/m);
assert.match(validation, /^productName:\s*极客 验证版\s*$/m);
assert.match(validation, /^\s*output:\s*dist-validation-build\s*$/m);
assert.match(validation, /^\s*geekRuntimeProfile:\s*validation\s*$/m);
assert.doesNotMatch(validation, /^publish:/m);
assert.match(validation, /^\s*artifactName:\s*geek-validation-setup-\$\{version\}\.exe\s*$/m);
assert.match(production, /^appId:\s*com\.stardust\.geek\s*$/m);
assert.match(production, /^productName:\s*极客\s*$/m);
assert.match(production, /^publish:/m);
assert.doesNotMatch(production, /geekRuntimeProfile:\s*validation/);
assert.match(validationWorkflow, /- '\.github\/release-client-version'/, 'formal release marker changes must trigger validation-client-build');
assert.match(
  validationWorkflow,
  /startsWith\(github\.event\.pull_request\.head\.ref, 'release\/'\)/,
  'release candidate PRs must run the isolated Windows validation build instead of being silently skipped',
);
assert.ok(
  validationWorkflow.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'),
  'validation builds must checkout the exact PR head rather than the synthetic merge ref',
);
assert.match(
  validationWorkflow,
  /- name: Run repository tests on Windows\s+run: npm test/,
  'release candidate validation must run the full repository contract suite on Windows before packaging',
);
assert.ok(
  validationWorkflow.includes('name: geek-validation-${{ github.event.pull_request.head.sha || github.sha }}'),
  'validation artifacts must expose the exact source SHA they were built from',
);
assert.ok(mainEntry.indexOf('configureRuntimeEnvironment({') >= 0);
assert.ok(mainEntry.indexOf('configureRuntimeEnvironment({') < mainEntry.indexOf("require('./main.cjs')"), 'profile must be selected before main composition resolves userData');
assert.match(main, /installScheduledBroadcastAttachmentBoundary\(/, 'scheduled attachment persistence remains installed by main composition');
console.log('VALIDATION_BUILD_ISOLATION_CONTRACT_OK');