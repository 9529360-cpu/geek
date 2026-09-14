'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const loopPath = path.join(root, 'scripts', 'dev-loop.cjs');
const source = fs.readFileSync(loopPath, 'utf8');

execFileSync(process.execPath, ['--check', loopPath], { stdio: 'pipe' });
assert.match(source, /require\(['"]\.\/dev-worker-feedback\.cjs['"]\)/);
assert.match(source, /createWorkerBundleFeedback\(\{[\s\S]*?root:\s*ROOT,[\s\S]*?log,[\s\S]*?warn,[\s\S]*?\}\)/);
assert.match(source, /workerBundleFeedback\.schedule\(plan\.changes\)/);
assert.match(source, /await workerBundleFeedback\.stop\(\)/);
assert.doesNotMatch(source, /Wrangler bundle dry-runs remain authoritative in CI/);

console.log('dev-worker feedback integration contract passed');
