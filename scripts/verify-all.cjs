'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const suites = Object.freeze([
  { name: 'contract/unit', command: 'test', args: [] },
  { name: 'electron/e2e', command: 'test:e2e', args: [] },
]);

function npmCliPath() {
  const configured = String(process.env.npm_execpath || '').trim();
  if (configured && path.isAbsolute(configured)) return configured;
  const candidates = process.platform === 'win32'
    ? [
        path.join(path.dirname(path.dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
    : ['/usr/lib/node_modules/npm/bin/npm-cli.js', '/usr/local/lib/node_modules/npm/bin/npm-cli.js'];
  return candidates.find(candidate => require('node:fs').existsSync(candidate)) || '';
}

function runSuite(suite) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const cli = npmCliPath();
    if (!cli) {
      reject(new Error('VERIFY_NPM_CLI_NOT_FOUND'));
      return;
    }
    const child = spawn(process.execPath, [cli, 'run', suite.command, ...suite.args], {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[VERIFY] PASS ${suite.name} (${duration}s)`);
        resolve();
        return;
      }
      const error = new Error(`[VERIFY] FAIL ${suite.name} (${duration}s, code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
      error.exitCode = Number.isInteger(code) && code > 0 ? code : 1;
      reject(error);
    });
  });
}

async function main() {
  const selected = process.env.GEEK_VERIFY_SUITE
    ? suites.filter(suite => suite.name === process.env.GEEK_VERIFY_SUITE)
    : suites;
  if (!selected.length) {
    console.error(`[VERIFY] unknown suite: ${process.env.GEEK_VERIFY_SUITE}`);
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  console.log(`[VERIFY] root=${root}`);
  console.log(`[VERIFY] suites=${selected.map(suite => suite.name).join(', ')}`);
  try {
    for (const suite of selected) await runSuite(suite);
    console.log(`[VERIFY] ALL PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = error.exitCode || 1;
  }
}

if (require.main === module) main();

module.exports = { suites, runSuite, main };
