'use strict';

const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

const root = join(__dirname, '..');
const testDir = join(root, 'test');
const developerTools = new Set(['cdp-eval.cjs', 'cdp-reload.cjs']);

function discoverTests() {
  return readdirSync(testDir)
    .filter(name => name.endsWith('.cjs') && !developerTools.has(name))
    .sort();
}

function runTest(test, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [join(testDir, test)], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(signal ? 'signal ' + signal : 'exit code ' + code);
      error.exitCode = Number.isInteger(code) && code > 0 ? code : 1;
      reject(error);
    });
  });
}

async function runTests(tests = discoverTests(), options = {}) {
  for (const test of tests) {
    process.stdout.write('\n[TEST] ' + test + '\n');
    await runTest(test, options);
  }
  process.stdout.write('\nAll ' + tests.length + ' tests passed.\n');
}

async function main() {
  try {
    await runTests();
  } catch (error) {
    console.error('[TEST RUNNER]', error?.message || error);
    process.exit(error?.exitCode || 1);
  }
}

if (require.main === module) main();

module.exports = {
  discoverTests,
  runTest,
  runTests,
  main,
};
