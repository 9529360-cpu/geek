'use strict';

const os = require('node:os');
const path = require('node:path');

const e2eUserDataDir = path.resolve(String(process.env.GEEK_USER_DATA_DIR || '').trim());
const relativeToTemp = path.relative(path.resolve(os.tmpdir()), e2eUserDataDir);
const isolatedE2EUserData = process.env.GEEK_E2E === '1'
  && !!relativeToTemp
  && !relativeToTemp.startsWith('..')
  && !path.isAbsolute(relativeToTemp)
  && path.basename(e2eUserDataDir).startsWith('geek-e2e-');

if (!isolatedE2EUserData) {
  throw new Error('Electron E2E requires an isolated geek-e2e-* userData directory under the OS temp root');
}

function chromeDriverShutdownUrl(options) {
  const protocol = String(options.protocol || 'http:').replace(/:?$/, ':');
  const hostname = String(options.hostname || 'localhost');
  const port = Number(options.port);
  const basePath = `/${String(options.path || '/').replace(/^\/+|\/+$/g, '')}`;
  const normalizedBase = basePath === '/' ? '/' : `${basePath}/`;
  return `${protocol}//${hostname}:${port}${normalizedBase}shutdown`;
}

exports.config = {
  runner: 'local',
  specs: ['./specs/shell-smoke.e2e.cjs'].concat(
    './specs/first-run-onboarding.e2e.cjs',
    './specs/lock-screen-accessibility.e2e.cjs',
    './specs/proxy-dialog-validation.e2e.cjs',
    './specs/account-context-keyboard.e2e.cjs',
    './specs/whatsapp-live-bootstrap.e2e.cjs',
    './specs/session-permission-runtime.e2e.cjs',
    './specs/webview-navigation-runtime.e2e.cjs',
    './specs/broadcast-readiness.e2e.cjs',
    './specs/broadcast-feedback.e2e.cjs',
  ),
  maxInstances: 1,
  logLevel: 'warn',
  bail: 1,
  waitforTimeout: 3000,
  autoXvfb: true,
  xvfbAutoInstall: true,
  connectionRetryTimeout: 45_000,
  connectionRetryCount: 0,
  framework: 'mocha',
  reporters: [],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },
  capabilities: [{
    browserName: 'electron',
    // ChromeDriver must attach to the exact profile Electron uses. Geek's E2E must retain the real sandbox.
    // detach is consumed by ChromeDriver's /shutdown QuitAll path; standard W3C
    // DELETE /session intentionally ignores it in Chromium source.
    'goog:chromeOptions': {
      args: [`--user-data-dir=${e2eUserDataDir}`],
      detach: true,
    },
    'wdio:electronServiceOptions': {
      appEntryPoint: path.join(__dirname, '..', 'src', 'main-entry.cjs'),
      // Override the service default. Geek's E2E must retain the real sandbox.
      appArgs: [],
      captureMainProcessLogs: false,
      captureRendererLogs: false,
    },
  }],
  services: ['electron'],
  // Mocha has already produced the real test result before this hook runs. Own the
  // two process lifecycles explicitly: ask the isolated Electron app to terminate
  // on the next main-loop turn so execute can return cleanly, then use ChromeDriver's
  // documented server shutdown endpoint. Clearing sessionId makes WDIO Runner.endSession
  // skip the known-hanging W3C DELETE /session path.
  after: async function () {
    const shutdownUrl = chromeDriverShutdownUrl(browser.options);
    await browser.electron.execute((electron) => {
      setImmediate(() => electron.app.exit(0));
      return true;
    });

    const response = await fetch(shutdownUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`ChromeDriver shutdown failed with HTTP ${response.status}`);
    }

    browser.sessionId = undefined;
  },
};
