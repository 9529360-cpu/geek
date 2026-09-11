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
  const runtimeSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'session-permission-runtime.e2e.cjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'electron-e2e.yml'), 'utf8');
  const mainEntry = fs.readFileSync(path.join(root, 'src', 'main-entry.cjs'), 'utf8');
  const combined = [runner, config, spec, runtimeSpec, workflow, mainEntry].join('\n');

  assert.equal(pkg.scripts['test:e2e'], 'node e2e/run.cjs');
  assert.match(runner, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'geek-e2e-'\)\)/);
  assert.match(runner, /GEEK_E2E:\s*'1'/);
  assert.match(runner, /GEEK_USER_DATA_DIR:\s*tempDir/);
  assert.match(runner, /e2e-account-a/);
  assert.match(runner, /e2e-account-b/);
  assert.doesNotMatch(runner, /email|phone|cookie|authorization|jwt|token/i, 'fake account fixture must not carry credentials or personal identifiers');
  assert.match(config, /appEntryPoint:\s*path\.join\(__dirname, '\.\.', 'src', 'main-entry\.cjs'\)/, 'E2E must launch the real Electron entry');
  assert.match(config, /specs:\s*\['\.\/specs\/shell-smoke\.e2e\.cjs'\]/, 'E2E spec path must resolve from the WDIO config directory');
  assert.match(config, /\.\/specs\/whatsapp-live-bootstrap\.e2e\.cjs/, 'live WhatsApp bootstrap gate must remain enabled');
  assert.match(config, /\.\/specs\/session-permission-runtime\.e2e\.cjs/, 'real Session permission runtime gate must remain enabled');
  assert.match(config, /appArgs:\s*\[\]/, 'Electron service args must explicitly preserve the sandbox');
  assert.match(config, /process\.env\.GEEK_E2E === '1'/, 'WDIO config must fail closed outside the E2E seam');
  assert.match(config, /path\.relative\(path\.resolve\(os\.tmpdir\(\)\), e2eUserDataDir\)/, 'Geek app profile must remain underneath the OS temp root');
  assert.match(config, /path\.basename\(e2eUserDataDir\)\.startsWith\('geek-e2e-'\)/, 'Geek app profile must use the isolated geek-e2e-* prefix');
  assert.match(config, /--user-data-dir=\$\{e2eUserDataDir\}/, 'ChromeDriver and Electron must share the isolated fixture profile for session startup');
  assert.match(config, /after:\s*async function/);
  assert.match(config, /electron\.app\.exit\(0\)/, 'isolated E2E must terminate Electron before WebDriver session cleanup');
  assert.doesNotMatch(config, /quitGracefully|listeners\('close'\)/, 'speculative ChromeDriver and tray-listener teardown hooks must stay removed');
  assert.doesNotMatch(config, /windowTypes:/, 'Do not override Electron Service target discovery without proven need');
  assert.match(config, /autoXvfb:\s*true/, 'hosted Linux E2E keeps WebdriverIO Xvfb support enabled');
  assert.match(config, /xvfbAutoInstall:\s*true/, 'hosted Linux E2E keeps WebdriverIO Xvfb provisioning fallback enabled');
  assert.match(config, /connectionRetryTimeout:\s*45_000/);
  assert.match(config, /logLevel:\s*'warn'/, 'routine Electron E2E runs should keep WDIO logs concise');
  assert.doesNotMatch(config, /wdio-worker-start|wdio-before-session|wdio-session-established/, 'temporary WDIO lifecycle diagnostics must not become a permanent CI dependency');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/g, 'Electron E2E jobs must execute on GitHub-hosted Linux');
  assert.doesNotMatch(workflow, /self-hosted|geek-linux|geek-real-client/i, 'Electron E2E must not depend on repository-owned runners');
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/, 'PR E2E checkout must use the exact candidate head, not the synthetic merge commit');
  assert.doesNotMatch(workflow, /Verify interactive Windows desktop|Runner\.Worker\.exe|SESSION eq 0/, 'hosted Linux E2E must not depend on an interactive Windows runner session');
  assert.doesNotMatch(workflow, /DEBUG:\s*['"]wdio-electron-service:/, 'routine CI must not enable verbose Electron service debug logging');
  assert.match(workflow, /timeout-minutes:\s*15/);
  assert.match(workflow, /Install Electron Linux runtime dependencies/);
  assert.match(workflow, /libgtk-3-0t64/);
  assert.match(workflow, /libasound2t64/);
  assert.match(workflow, /gnome-keyring/, 'hosted Linux E2E must provide a real Secret Service backend for Electron safeStorage');
  assert.match(workflow, /libsecret-1-0/);
  assert.match(workflow, /dbus-run-session -- bash/, 'Secret Service must run inside an isolated D-Bus session');
  assert.match(workflow, /gnome-keyring-daemon --unlock/);
  assert.match(workflow, /xvfb-run -a npm run test:e2e/, 'hosted Linux E2E must run inside an explicit virtual X display');
  assert.match(workflow, /apparmor_restrict_unprivileged_userns=0/, 'hosted Ubuntu must allow Electron namespace sandboxing without --no-sandbox');
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run electron:install/);
  assert.match(workflow, /git .*diff --check/);
  assert.match(mainEntry, /installSubscriptionStartupBypass\(\{/);
  assert.doesNotMatch(mainEntry, /\[geek-e2e\]/, 'temporary main-process E2E lifecycle diagnostics must not remain in product startup');
  assert.doesNotMatch(combined, /--no-sandbox|nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|webSecurity\s*:\s*false/);
  assert.doesNotMatch(combined, /%APPDATA%[\\/]geek|AppData[\\/]Roaming[\\/]geek/i);
  assert.match(spec, /BrowserWindow\.getAllWindows\(\)/, 'host content sizing must use Electron main-process APIs');
  assert.match(spec, /hostWindow\.setContentSize\(1280, 820\)/, 'host renderer content area must retain the explicit E2E viewport size');
  assert.match(spec, /hostWindow\.getContentSize\(\)/, 'host renderer content viewport must be verified after sizing');
  assert.doesNotMatch(spec, /setWindowSize\(/, 'Electron WebDriver must not use the unsupported Browser.getWindowForTarget resize path');
  assert.doesNotMatch(spec, /removeListener\('close'|app\.quit\(|app\.exit\(/, 'the smoke spec must not own Electron process teardown');
  assert.match(spec, /#ctx-menu:not\(\.hidden\)/);
  assert.match(spec, /#account-settings-overlay:not\(\.hidden\)/);
  assert.match(spec, /#bc-menu-send/);
  assert.match(spec, /#broadcast-overlay:not\(\.hidden\)/);
  assert.match(spec, /executeAsync/);
  assert.doesNotMatch(spec, /#broadcast-send[^\w-].*click|click\(.*#broadcast-send/s, 'smoke test must never send a broadcast');

  assert.match(runtimeSpec, /ACCOUNT_ID = 'e2e-account-a'/, 'runtime gate must use the exact synthetic WhatsApp account');
  assert.match(runtimeSpec, /persist:webview-page-\$\{ACCOUNT_ID\}/, 'runtime gate must derive the exact account partition from that owner');
  assert.match(runtimeSpec, /getWebContentsId\(\)/, 'runtime gate must bind the host WebView to its exact guest id');
  assert.match(runtimeSpec, /browser\.electron\.execute/, 'runtime gate must inspect the real Electron main process');
  assert.match(runtimeSpec, /electron\.webContents\.getAllWebContents\(\)/, 'runtime gate must resolve a real guest WebContents');
  assert.match(runtimeSpec, /target\.executeJavaScript/, 'StorageManager calls must execute inside the real guest renderer');
  assert.match(runtimeSpec, /navigator\.storage\.persist\(\)/, 'runtime gate must request persistent storage through Chromium');
  assert.match(runtimeSpec, /navigator\.storage\.persisted\(\)/, 'runtime gate must verify the resulting storage persistence state');
  assert.match(runtimeSpec, /https:\/\/web\.whatsapp\.com/, 'runtime gate must use the current official WhatsApp Web origin');
  assert.match(runtimeSpec, /session\?\.partition/, 'runtime gate must verify the target Session partition');
  assert.match(runtimeSpec, /storagePath|getStoragePath/, 'runtime gate must independently cross-check the Session storage path');
  assert.match(runtimeSpec, /getType\?\.\(\)/, 'runtime gate must prove the target is a WebView guest');
  assert.doesNotMatch(runtimeSpec, /require\([^\n]*session-permission-boundary|isAccountPermissionAllowed|installPermissionHandlersForSession/, 'runtime E2E must not degrade into calling Geek permission helpers directly');
  assert.doesNotMatch(runtimeSpec, /browser\.pause\(/, 'runtime permission gate must use readiness predicates instead of fixed sleeps');
  assert.doesNotMatch(runtimeSpec, /document\.cookie|localStorage|sessionStorage|Authorization|location\.search|location\.hash|innerText|textContent|\btoken\b|qrData/i, 'runtime permission gate must not collect credentials, page bodies, QR data, or URL query/hash content');

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
