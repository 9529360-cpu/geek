'use strict';

const path = require('node:path');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const { app, BrowserWindow, dialog, ipcMain, safeStorage, webContents } = require('electron');
const { configureRuntimeEnvironment } = require('./runtime-profile.cjs');
const runtimePaths = require('./runtime-paths.cjs');
const { installSingleInstanceGuard } = require('./single-instance.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');

// Select the runtime profile before main.cjs resolves and fixes Electron userData.
// Source development and validation installers must never touch production Chromium
// storage. An explicit GEEK_USER_DATA_DIR remains the highest-priority test override.
const packagedMetadata = require('../package.json');
configureRuntimeEnvironment({
  appDataDir: app.getPath('appData'),
  isPackaged: app.isPackaged,
  packagedProfile: packagedMetadata.geekRuntimeProfile,
  env: process.env,
});

// Electron's single-instance lock must be acquired against the same userData/profile
// that the runtime will use. main.cjs repeats this idempotent setPath later.
const earlyUserDataDir = runtimePaths.resolveUserDataDir({
  appDataDir: app.getPath('appData'),
  overrideDir: process.env.GEEK_USER_DATA_DIR,
});
try { app.setPath('userData', earlyUserDataDir); } catch {}

const primaryInstance = installSingleInstanceGuard({ app, BrowserWindow });
if (!primaryInstance) {
  // app.exit() has already been requested. Do not install IPC boundaries or load
  // main.cjs in the duplicate process, so it cannot initialize Chromium sessions.
  return;
}

const uiEntryPath = path.join(__dirname, '../ui/index.html');
const telegramNativeAttachments = createTelegramNativeAttachmentHandler({
  getAllWebContents: () => webContents.getAllWebContents(),
});
const externalDebuggingRequested = process.argv.some((arg) => /^--remote-debugging-port(?:=|$)/.test(String(arg || '')));

// Install the selected-file capability boundary before main.cjs registers IPC.
// The existing main orchestrator keeps the platform-specific CDP delivery logic;
// legacy picker/raw-path channels are intercepted and disabled by the boundary.
installBroadcastFileBoundary({
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

// Keep account sandbox persistence outside the main orchestrator. The userData
// path is resolved lazily because main.cjs fixes it immediately after bootstrap.
installAccountDataBoundary({
  ipcMain,
  BrowserWindow,
  fs,
  createReadStream: nodeFs.createReadStream,
  getUserDataDir: () => app.getPath('userData'),
  uiEntryPath,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
  onCompactionError: (error) => {
    const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
    console.error('[account-data] compaction retry required:', code.slice(0, 80));
  },
});

require('./main.cjs');
