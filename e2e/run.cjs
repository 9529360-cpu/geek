'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-e2e-'));
const accounts = Object.freeze({
  activeAccountId: 'e2e-account-a',
  accounts: Object.freeze([
    Object.freeze({ id: 'e2e-account-a', type: 'whatsapp', name: 'E2E Alpha' }),
    Object.freeze({ id: 'e2e-account-b', type: 'whatsapp', name: 'E2E Beta' }),
  ]),
});

fs.writeFileSync(path.join(tempDir, 'accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });

const cliPackage = require.resolve('@wdio/cli/package.json');
const cli = path.join(path.dirname(cliPackage), 'bin', 'wdio.js');
const env = {
  ...process.env,
  GEEK_E2E: '1',
  GEEK_USER_DATA_DIR: tempDir,
};

let timedOut = false;
const child = spawn(process.execPath, [cli, 'run', path.join(root, 'e2e', 'wdio.conf.cjs')], {
  cwd: root,
  env,
  stdio: 'inherit',
});

const hardTimeout = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');
}, 120_000);
hardTimeout.unref?.();

function cleanup() {
  try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch {}
}

child.once('error', (error) => {
  clearTimeout(hardTimeout);
  cleanup();
  console.error(`E2E_RUNNER_FAILED ${String(error?.code || error?.name || 'SPAWN_ERROR').slice(0, 80)}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  clearTimeout(hardTimeout);
  cleanup();
  if (timedOut) {
    console.error('E2E_RUNNER_TIMEOUT');
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    console.error(`E2E_RUNNER_EXIT code=${Number.isInteger(code) ? code : -1} signal=${signal ? 'present' : 'none'}`);
    process.exitCode = 1;
    return;
  }
  console.log('ELECTRON_E2E_SMOKE_OK');
});
