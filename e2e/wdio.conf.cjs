'use strict';

const path = require('node:path');

exports.config = {
  runner: 'local',
  specs: ['./specs/shell-smoke.e2e.cjs'],
  maxInstances: 1,
  logLevel: 'info',
  bail: 1,
  waitforTimeout: 3000,
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
    // The service defaults to ['app', 'webview']. Geek creates two live WhatsApp
    // guests during startup, but this smoke drives only the host shell. Restrict
    // ChromeDriver session discovery to the Electron app target so guest startup
    // cannot stall POST /session while preserving the real guest webviews in-app.
    'goog:chromeOptions': {
      windowTypes: ['app'],
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
  onWorkerStart() {
    console.log('[geek-e2e] wdio-worker-start');
  },
  beforeSession() {
    console.log('[geek-e2e] wdio-before-session');
  },
  before() {
    console.log('[geek-e2e] wdio-session-established');
  },
};
