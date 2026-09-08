'use strict';

const path = require('node:path');

exports.config = {
  runner: 'local',
  specs: ['./specs/shell-smoke.e2e.cjs'],
  maxInstances: 1,
  logLevel: 'warn',
  bail: 1,
  waitforTimeout: 3000,
  connectionRetryTimeout: 10_000,
  connectionRetryCount: 0,
  framework: 'mocha',
  reporters: [],
  mochaOpts: {
    ui: 'bdd',
    timeout: 45_000,
  },
  capabilities: [{
    browserName: 'electron',
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
