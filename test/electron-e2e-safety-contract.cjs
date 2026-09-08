'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');
const seam = require('../src/e2e-shell-seam.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const runner = fs.readFileSync(path.join(root, 'e2e', 'run.cjs'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'e2e', 'wdio.conf.cjs'), 'utf8');
  const spec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'shell-smoke.e2e.cjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'electron-e2e.yml'), 'utf8');
  const mainEntry = fs.readFileSync(path.join(root, 'src', 'main-entry.cjs'), 'utf8');
  const combined = [runner, config, spec, workflow, mainEntry].join('\n');

  assert.equal(pkg.scripts['test:e2e'], 'node e2e/run.cjs');
  assert.match(runner, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'geek-e2e-'\)\)/);
  assert.match(runner, /GEEK_E2E:\s*'1'/);
  assert.match(runner, /GEEK_USER_DATA_DIR:\s*tempDir/);
  assert.match(runner, /e2e-account-a/);
  assert.match(runner, /e2e-account-b/);
  assert.doesNotMatch(runner, /email|phone|cookie|authorization|jwt|token/i, 'fake account fixture must not carry credentials or personal identifiers');
  assert.match(config, /appEntryPoint:\s*path\.join\(__dirname, '\.\.', 'src', 'main-entry\.cjs'\)/, 'E2E must launch the real Electron entry');
  assert.match(config, /specs:\s*\['\.\/specs\/shell-smoke\.e2e\.cjs'\]/, 'E2E spec path must resolve from the WDIO config directory');
  assert.match(config, /appArgs:\s*\[\]/, 'Electron service args must explicitly preserve the sandbox');
  assert.doesNotMatch(config, /autoXvfb|xvfbAutoInstall/, 'Windows Electron E2E must not depend on Linux Xvfb');
  assert.match(config, /connectionRetryTimeout:\s*10_000/);
  assert.match(workflow, /runs-on:\s*\[self-hosted, windows, x64, geek-real-client\]/, 'Electron E2E must execute on the Windows client runner');
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/, 'PR E2E checkout must use the exact candidate head, not the synthetic merge commit');
  assert.match(workflow, /shell:\s*cmd/, 'Windows E2E must use the same shell contract as the existing validation build runner');
  assert.match(workflow, /timeout-minutes:\s*15/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run electron:install/);
  assert.match(workflow, /npm run test:e2e/);
  assert.match(workflow, /git .*diff --check/);
  assert.doesNotMatch(combined, /--no-sandbox|nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|webSecurity\s*:\s*false/);
  assert.doesNotMatch(combined, /%APPDATA%[\\/]geek|AppData[\\/]Roaming[\\/]geek/i);
  assert.match(spec, /#ctx-menu:not\(\.hidden\)/);
  assert.match(spec, /#account-settings-overlay:not\(\.hidden\)/);
  assert.match(spec, /#bc-menu-send/);
  assert.match(spec, /#broadcast-overlay:not\(\.hidden\)/);
  assert.match(spec, /executeAsync/);
  assert.doesNotMatch(spec, /#broadcast-send[^\w-].*click|click\(.*#broadcast-send/s, 'smoke test must never send a broadcast');

  const tempRoot = path.join(os.tmpdir(), 'geek-e2e-contract-root');
  const allowedDir = path.join(tempRoot, 'geek-e2e-123');
  const allowed = { GEEK_E2E: '1', GEEK_USER_DATA_DIR: allowedDir };
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'development', env: allowed, tempDir: tempRoot }), true);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: true, profile: 'development', env: allowed, tempDir: tempRoot }), false);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'production', env: allowed, tempDir: tempRoot }), false);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'validation', env: allowed, tempDir: tempRoot }), false);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'development', env: { ...allowed, GEEK_E2E: '0' }, tempDir: tempRoot }), false);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'development', env: { ...allowed, GEEK_USER_DATA_DIR: path.join(tempRoot, 'geek-dev') }, tempDir: tempRoot }), false);
  assert.equal(seam.isE2EShellLaunchAllowed({ isPackaged: false, profile: 'development', env: { ...allowed, GEEK_USER_DATA_DIR: path.join(tempRoot, '..', 'geek-e2e-escape') }, tempDir: tempRoot }), false);

  let realReads = 0;
  const fakeModule = {
    createSubscriptionStore: () => ({
      getState: async () => { realReads += 1; return { loggedIn: false }; },
      refresh: async () => ({ ok: true }),
    }),
  };
  assert.equal(seam.installSubscriptionStartupBypass({ isPackaged: false, profile: 'development', env: allowed, tempDir: tempRoot, subscriptionModule: fakeModule }), true);
  const store = fakeModule.createSubscriptionStore();
  assert.deepEqual(await store.getState(), { loggedIn: true, e2eShellOnly: true });
  assert.deepEqual(await store.getState(), { loggedIn: false });
  assert.equal(realReads, 1, 'E2E bypass must be consumed after the startup state read');
  assert.equal(typeof store.refresh, 'function', 'non-gate subscription behavior must remain available');

  const packagedModule = { createSubscriptionStore: () => ({ getState: async () => ({ loggedIn: false }) }) };
  const packagedFactory = packagedModule.createSubscriptionStore;
  assert.equal(seam.installSubscriptionStartupBypass({ isPackaged: true, profile: 'development', env: allowed, tempDir: tempRoot, subscriptionModule: packagedModule }), false);
  assert.equal(packagedModule.createSubscriptionStore, packagedFactory, 'packaged runtime must not be mutated by the E2E seam');

  console.log('ELECTRON_E2E_SAFETY_CONTRACT_OK');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
