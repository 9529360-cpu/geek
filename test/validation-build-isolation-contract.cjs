'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const validation = fs.readFileSync(path.join(root, 'electron-builder.validation.yml'), 'utf8');
const production = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const mainEntry = fs.readFileSync(path.join(root, 'src', 'main-entry.cjs'), 'utf8');

assert.match(pkg.scripts.pack, /--config\s+electron-builder\.validation\.yml/, 'pack must use the isolated validation builder config');
assert.match(pkg.scripts['dist:test'], /--config\s+electron-builder\.validation\.yml/, 'dist:test must use the isolated validation builder config');
assert.equal(pkg.scripts.dist, 'node scripts/release-build.cjs', 'formal dist must remain on the guarded production release build');

assert.match(validation, /^appId:\s*com\.stardust\.geek\.validation\s*$/m, 'validation appId must differ from production');
assert.match(validation, /^productName:\s*极客 验证版\s*$/m, 'validation productName must be visibly distinct');
assert.match(validation, /^\s*output:\s*dist-validation-build\s*$/m, 'validation output must not share dist-release');
assert.match(validation, /^\s*geekRuntimeProfile:\s*validation\s*$/m, 'validation package must carry an explicit runtime profile marker');
assert.doesNotMatch(validation, /^publish:/m, 'validation config must not define a production updater publisher');
assert.match(validation, /^\s*artifactName:\s*geek-validation-setup-\$\{version\}\.exe\s*$/m, 'validation installer name must be unmistakable');

assert.match(production, /^appId:\s*com\.stardust\.geek\s*$/m, 'production appId must stay unchanged');
assert.match(production, /^productName:\s*极客\s*$/m, 'production productName must stay unchanged');
assert.match(production, /^publish:/m, 'production config must retain its updater publisher');
assert.doesNotMatch(production, /geekRuntimeProfile:\s*validation/, 'production build must never carry the validation runtime profile marker');

const configureAt = mainEntry.indexOf('configureRuntimeEnvironment({');
const mainAt = mainEntry.indexOf("require('./main.cjs')");
assert.ok(configureAt >= 0 && mainAt > configureAt, 'runtime profile must be selected before main.cjs resolves userData');

console.log('VALIDATION_BUILD_ISOLATION_CONTRACT_OK');
