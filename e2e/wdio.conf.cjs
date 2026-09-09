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
    // Do not pass Geek's app-data fixture as ChromeDriver --user-data-dir.
    // ChromeDriver must own its disposable transport profile so session teardown
    // can use the normal temporary-profile cleanup path. Geek itself still reads
    // and writes only GEEK_USER_DATA_DIR, which is preflighted above as a fresh
    // geek-e2e-* directory under the OS temp root.
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
