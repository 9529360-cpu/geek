'use strict';

const path = require('node:path');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const { app, BrowserWindow, dialog, ipcMain, safeStorage, webContents } = require('electron');
const { configureRuntimeEnvironment } = require('./runtime-profile.cjs');
const runtimePaths = require('./runtime-paths.cjs');
const { installSingleInstanceGuard } = require('./single-instance.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');
const { externalDebuggingAllowed, installExternalDebuggingProbeGuard } = require('./external-debugging-policy.cjs');

// Resolve development/validation identity before any component reads Electron userData.
const packagedMetadata = require('../package.json');
configureRuntimeEnvironment({
  appDataDir: app.getPath('appData'),
  isPackaged: app.isPackaged,
  packagedProfile: packagedMetadata.geekRuntimeProfile,
  env: process.env,
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
  const telegramNativeAttachments = createTelegramNativeAttachmentHandler({
    getAllWebContents: () => webContents.getAllWebContents(),
  });
  const externalDebuggingRequested = externalDebuggingAllowed({
    isPackaged: app.isPackaged,
    argv: process.argv,
  });

  // main.cjs still contains the legacy localhost probe for the explicit development
  // debugger path. Fail closed before loading it: packaged clients and normal dev
  // launches cannot switch transport merely because another local process owns 9344.
  installExternalDebuggingProbeGuard({ allowed: externalDebuggingRequested });

  // Install the selected-file capability boundary before main.cjs registers IPC.
  const broadcastFileBoundary = installBroadcastFileBoundary({
    ipcMain,
    dialog,
    BrowserWindow,
    fs,
    uiEntryPath,
    sendTelegramFiles: async ({ payload }) => {
      if (externalDebuggingRequested) {
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
    beforeAccountRemove: ({ accountId }) => scheduledAttachmentBoundary.getStore().cleanupAccount(accountId),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
    onCompactionError: (error) => {
      const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
      console.error('[account-data] compaction retry required:', code.slice(0, 80));
    },
  });

  require('./main.cjs');
}
