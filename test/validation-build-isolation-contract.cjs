'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const validation = fs.readFileSync(path.join(root, 'electron-builder.validation.yml'), 'utf8');
const production = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const mainEntry = fs.readFileSync(path.join(root, 'src', 'main-entry.cjs'), 'utf8');

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
const configureAt = mainEntry.indexOf('configureRuntimeEnvironment({');
const scheduledBoundaryAt = mainEntry.indexOf('installScheduledBroadcastAttachmentBoundary({');
assert.ok(configureAt >= 0 && scheduledBoundaryAt > configureAt, 'profile must be selected before broadcast persistence resolves userData');
console.log('VALIDATION_BUILD_ISOLATION_CONTRACT_OK');
