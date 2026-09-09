'use strict';

const path = require('node:path');
const os = require('node:os');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const { app, BrowserWindow, dialog, ipcMain, safeStorage, session, webContents } = require('electron');
const { configureRuntimeEnvironment } = require('./runtime-profile.cjs');
const runtimePaths = require('./runtime-paths.cjs');
const { installSingleInstanceGuard } = require('./single-instance.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');
const { externalDebuggingRequested, installExternalDebuggingProbeGuard } = require('./external-debugging-policy.cjs');
const { installSessionPartitionCompat } = require('./session-partition-compat.cjs');
const { installAccountScopedWebviewNavigationBoundary, policyFromAccountState } = require('./webview-navigation-boundary.cjs');
const { installAccountSessionPermissionBoundary } = require('./session-permission-boundary.cjs');
const { configureE2ESafeStorageBackend, installSubscriptionStartupBypass } = require('./e2e-shell-seam.cjs');
const { installAccountTypeBoundary } = require('./account-type-boundary.cjs');

// Resolve development/validation identity before any component reads Electron userData.
const packagedMetadata = require('../package.json');
const runtimeIdentity = configureRuntimeEnvironment({
  appDataDir: app.getPath('appData'),
  isPackaged: app.isPackaged,
  packagedProfile: packagedMetadata.geekRuntimeProfile,
  env: process.env,
});

// Hosted Linux has no desktop login session to auto-select an OS password manager.
// The isolated E2E seam explicitly selects GNOME libsecret before app ready, but only
// for an unpackaged development process under a fresh OS-temp geek-e2e-* userData.
configureE2ESafeStorageBackend({
  isPackaged: app.isPackaged,
  profile: runtimeIdentity.profile,
  env: process.env,
  tempDir: os.tmpdir(),
  commandLine: app.commandLine,
});

// E2E may cross the local login gate only for an unpackaged development process whose
// explicit userData lives in a fresh OS-temp geek-e2e-* directory. The seam changes
// exactly the first local getState() used by startup; all later subscription calls use
// the real store and no token/JWT is accepted from the test environment.
installSubscriptionStartupBypass({
  isPackaged: app.isPackaged,
  profile: runtimeIdentity.profile,
  env: process.env,
  tempDir: os.tmpdir(),
  subscriptionModule: require('./subscription.cjs'),
});

// The single-instance lock is profile-scoped: production and the isolated validation
// identity can coexist, while two processes may not concurrently open the same profile.
const earlyUserDataDir = runtimePaths.resolveUserDataDir({
  appDataDir: app.getPath('appData'),
  overrideDir: process.env.GEEK_USER_DATA_DIR,
});
try { app.setPath('userData', earlyUserDataDir); } catch {}

const primaryInstance = installSingleInstanceGuard({ app, BrowserWindow });
if (primaryInstance) {
  const uiEntryPath = path.join(__dirname, '../ui/index.html');
  const accountsFilePath = runtimePaths.accountsFile(earlyUserDataDir);
  const telegramNativeAttachments = createTelegramNativeAttachmentHandler({
    getAllWebContents: () => webContents.getAllWebContents(),
  });
  const remoteDebuggingRequested = externalDebuggingRequested({ argv: process.argv });

  // main.cjs still has legacy reads of webContents.session.partition, while current
  // Electron documents Session.storagePath instead. Install a narrow read-only
  // compatibility getter before main.cjs can create or classify any account guest.
  const sessionPartitionCompat = installSessionPartitionCompat({ app, sessionModule: session });

  // Legacy post-attach navigation uses a global host allowlist. Add a stricter
  // account-guest boundary before any BrowserWindow/WebView is created. Navigation
  // policy comes from the authoritative account record that owns the fixed partition;
  // missing/corrupt/mismatched account state fails closed instead of inferring owner
  // from the first URL observed in the guest.
  installAccountScopedWebviewNavigationBoundary({
    app,
    resolvePolicyForPartition: resolveAccountPolicyForPartition,
  });

  // Electron's default Web-permission behavior is not an acceptable trust boundary for
  // remote chat content. Bind both permission-request and permission-check handlers to
  // the account WebView Session before attachment. The permission module reuses the
  // exact navigation policy above for partition ownership and requesting-origin checks.
  installAccountSessionPermissionBoundary({
    app,
    sessionModule: session,
    resolvePolicyForPartition: resolveAccountPolicyForPartition,
  });

  // Navigation and Web permissions resolve the same authoritative account owner.
  // A function declaration is intentionally used so both early boundaries can share
  // one resolver while the existing source-order contract can still verify that the
  // navigation boundary is installed before the resolver implementation and legacy main.
  function resolveAccountPolicyForPartition(partition) {
    try {
      const accountState = nodeFs.readFileSync(accountsFilePath, 'utf8');
      return policyFromAccountState(partition, accountState);
    } catch {
      return null;
    }
  }

  // The legacy external attachment transport selects the first platform target and
  // has no reliable account partition binding. Keep the developer remote-debug port
  // available for diagnostics, but never let broadcast attachment delivery switch to
  // that unbound transport. A debugger-attached client may fail attachment delivery;
  // it must never guess an account owner.
  installExternalDebuggingProbeGuard();

  // Install the selected-file capability boundary before main.cjs registers IPC.
  const broadcastFileBoundary = installBroadcastFileBoundary({
    ipcMain,
    dialog,
    BrowserWindow,
    fs,
    uiEntryPath,
    sendTelegramFiles: async ({ payload }) => {
      if (remoteDebuggingRequested) {
        const error = new Error('TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED');
        error.code = 'TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED';
        throw error;
      }
      return telegramNativeAttachments.send(payload);
    },
  });

  // Scheduled attachments keep canonical paths in main only. Durable refs are bound
  // to account + task and materialize back into fresh short-lived picker tokens.
  const scheduledAttachmentBoundary = installScheduledBroadcastAttachmentBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    uiEntryPath,
    ephemeralRegistry: broadcastFileBoundary.registry,
    getUserDataDir: () => app.getPath('userData'),
  });

  // Broadcast persistence extends the encrypted per-account store with an explicit
  // allowlist only; renderer callers still cannot choose arbitrary storage keys.
  installAccountDataBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    createReadStream: nodeFs.createReadStream,
    getUserDataDir: () => app.getPath('userData'),
    uiEntryPath,
    allowedKeys: [...ACCOUNT_DATA_KEYS, ...BROADCAST_ACCOUNT_DATA_KEYS],
    beforeAccountRemove: ({ accountId }) => scheduledAttachmentBoundary.cleanupAccount(accountId),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
    onCompactionError: (error) => {
      const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
      console.error('[account-data] compaction retry required:', code.slice(0, 80));
    },
  });

  // main.cjs still maps every unrecognized account type to WhatsApp. Install this
  // after current registration boundaries. main.cjs defers registerIpcHandlers() to
  // app.whenReady(), so the guard stays installed across require() and self-restores
  // only after it has actually wrapped the accounts:add handler.
  installAccountTypeBoundary({ ipcMain });

  // Fail closed if Electron changes in a way that prevents safe partition recovery.
  // Starting legacy main without the account partition key would collapse WPP and
  // account-deletion bookkeeping back onto an empty partition string.
  sessionPartitionCompat.ready
    .then(() => require('./main.cjs'))
    .catch((error) => {
      const code = typeof error?.code === 'string' ? error.code : String(error?.message || 'SESSION_PARTITION_COMPAT_FAILED');
      console.error('[session-partition] startup blocked:', code.slice(0, 80));
      app.quit();
    });
}
