'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const profileIndex = source.indexOf('const runtimeIdentity = configureRuntimeEnvironment');
const controlIndex = source.indexOf('installDevLoopControl({');
const e2eIndex = source.indexOf('configureE2ESafeStorageBackend({');

assert.match(source, /require\(['"]\.\/dev-loop-control\.cjs['"]\)/);
assert.ok(profileIndex >= 0, 'runtime identity must exist');
assert.ok(controlIndex > profileIndex, 'dev-loop control must bind after runtime identity is resolved');
assert.ok(e2eIndex > controlIndex, 'dev-loop control should bind before later startup seams');
assert.match(source, /installDevLoopControl\(\{[\s\S]*?isPackaged:\s*app\.isPackaged,[\s\S]*?profile:\s*runtimeIdentity\.profile,[\s\S]*?env:\s*process\.env,[\s\S]*?processObject:\s*process,[\s\S]*?\}\);/);

console.log('dev-loop main-entry contract passed');
