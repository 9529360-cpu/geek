'use strict';

const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = join(__dirname, '..');
const testDir = join(root, 'test');
const developerTools = new Set(['cdp-eval.cjs', 'cdp-reload.cjs']);
const tests = readdirSync(testDir)
  .filter((name) => name.endsWith('.cjs') && !developerTools.has(name))
  .sort();

for (const test of tests) {
  process.stdout.write(`\n[TEST] ${test}\n`);
  const result = spawnSync(process.execPath, [join(testDir, test)], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`\nAll ${tests.length} tests passed.\n`);
