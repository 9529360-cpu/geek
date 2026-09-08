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
  // Electron starts a full Chromium desktop process. Keep this bounded well
  // below the outer 120s watchdog, but do not undercut WDIO session startup.
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
    // ChromeDriver creates and watches a user-data-dir while establishing the
    // DevTools session. Geek also sets Electron's userData before ready. Keep
    // both owners on the exact same fresh OS-temp profile so DevToolsActivePort
    // is created where ChromeDriver expects it. Never point this at real data.
    'goog:chromeOptions': {
      args: [`--user-data-dir=${e2eUserDataDir}`],
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
};
