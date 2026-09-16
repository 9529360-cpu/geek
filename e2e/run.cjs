'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-e2e-'));
const fixtureDir = path.join(tempDir, 'runtime-fixtures');
const requestedSuite = String(process.env.GEEK_E2E_SUITE || '').trim();
const targetedSpecs = Object.freeze({
  'whatsapp-bootstrap': path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'),
  'whatsapp-runtime': path.join(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime.e2e.cjs'),
});
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const FULL_SUITE_TIMEOUT_MS = 180_000;
const accounts = Object.freeze({
  activeAccountId: 'e2e-account-a',
  accounts: Object.freeze([
    Object.freeze({ id: 'e2e-account-a', type: 'whatsapp', name: 'E2E Alpha' }),
    Object.freeze({ id: 'e2e-account-b', type: 'whatsapp', name: 'E2E Beta' }),
  ]),
});

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(path.join(tempDir, 'accounts.json'), JSON.stringify(accounts, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(fixtureDir, 'scheduled-restart.txt'), 'geek scheduled attachment restart fixture\n', { mode: 0o600 });

const cli = path.join(root, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');
const baseEnv = {
  ...process.env,
  GEEK_E2E: '1',
  GEEK_USER_DATA_DIR: tempDir,
};
// The suite selector belongs to this runner only. Spec selection is translated into a
// WDIO CLI argument and never forwarded as product-runtime configuration.
delete baseEnv.GEEK_E2E_SUITE;

function runTimeoutMs(configName, specPath) {
  return configName === 'wdio.conf.cjs' && !specPath
    ? FULL_SUITE_TIMEOUT_MS
    : DEFAULT_RUN_TIMEOUT_MS;
}

function runWdio(configName, phase, specPath) {
  return new Promise((resolve, reject) => {
    const env = phase ? { ...baseEnv, GEEK_E2E_RESTART_PHASE: phase } : baseEnv;
    const args = [cli, 'run', path.join(root, 'e2e', configName)];
    if (specPath) args.push('--spec', specPath);
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    let settled = false;
    let timedOut = false;
    const hardTimeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, runTimeoutMs(configName, specPath));
    hardTimeout.unref?.();

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (error) reject(error);
      else resolve();
    };

    child.once('error', (error) => {
      finish(Object.assign(new Error('E2E_RUNNER_FAILED'), { category: String(error?.code || error?.name || 'SPAWN_ERROR').slice(0, 80) }));
    });

    child.once('exit', (code, signal) => {
      if (timedOut) {
        finish(Object.assign(new Error('E2E_RUNNER_TIMEOUT'), { category: 'TIMEOUT' }));
        return;
      }
      if (code !== 0) {
        finish(Object.assign(new Error('E2E_RUNNER_EXIT'), {
          category: `code=${Number.isInteger(code) ? code : -1} signal=${signal ? 'present' : 'none'}`,
        }));
        return;
      }
      finish();
    });
  });
}

function cleanup() {
  try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch {}
}

(async () => {
  try {
    if (requestedSuite) {
      const selectedSpec = targetedSpecs[requestedSuite];
      if (!selectedSpec) {
        throw Object.assign(new Error('E2E_SUITE_UNSUPPORTED'), { category: requestedSuite.slice(0, 80) || 'EMPTY' });
      }
      await runWdio('wdio.conf.cjs', undefined, selectedSpec);
      console.log(`ELECTRON_E2E_SUITE_OK suite=${requestedSuite}`);
    } else {
      await runWdio('wdio.scheduled-restart.conf.cjs', 'seed');
      await runWdio('wdio.scheduled-restart.conf.cjs', 'verify');
      await runWdio('wdio.conf.cjs');
      console.log('ELECTRON_E2E_SMOKE_OK');
    }
  } catch (error) {
    console.error(`${String(error?.message || 'E2E_RUNNER_FAILED')} ${String(error?.category || 'UNKNOWN').slice(0, 80)}`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
