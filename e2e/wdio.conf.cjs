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

exports.config = {
  runner: 'local',
  specs: ['./specs/shell-smoke.e2e.cjs'],
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
    timeout: 45_000,
  },
  capabilities: [{
    browserName: 'electron',
    // ChromeDriver must attach to the exact profile Electron uses. Geek's fixture
    // directory is fresh, OS-temp scoped, synthetic-only, and deleted by e2e/run.cjs.
    // The WDIO after hook owns Electron termination; detach prevents ChromeDriver's
    // DELETE /session from redundantly entering its browser Quit path afterward.
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
  // Assertions are already complete when this hook runs. Terminate only the isolated
  // E2E Electron process; ChromeDriver then deletes the detached session without
  // attempting a second browser shutdown. No production runtime path is changed.
  after: async function () {
    await browser.electron.execute((electron) => {
      electron.app.exit(0);
      return true;
    });
  },
};
