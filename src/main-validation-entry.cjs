'use strict';

const nodeFs = require('node:fs');
const { app } = require('electron');
const runtimePaths = require('./runtime-paths.cjs');
const { policyFromAccountState } = require('./webview-navigation-boundary.cjs');
const { installWhatsAppBrowserChainDiagnostics } = require('./whatsapp-browser-chain-diagnostics.cjs');

// Run the real application entry first. It selects the validation profile/userData,
// installs the normal security boundaries, and schedules the real main process.
require('./main-entry.cjs');

const userDataDir = app.getPath('userData');
const accountsFile = runtimePaths.accountsFile(userDataDir);

function resolvePolicyForPartition(partition) {
  try {
    return policyFromAccountState(partition, nodeFs.readFileSync(accountsFile, 'utf8'));
  } catch {
    return null;
  }
}

installWhatsAppBrowserChainDiagnostics({
  app,
  userDataDir,
  resolvePolicyForPartition,
});
