'use strict';

const path = require('node:path');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const { app, BrowserWindow, dialog, ipcMain, safeStorage, webContents } = require('electron');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');

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
