'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { BrowserWindow, dialog, ipcMain } = require('electron');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');

// Install the selected-file capability boundary before main.cjs registers IPC.
// The existing main orchestrator keeps the platform-specific CDP delivery logic;
// legacy picker/raw-path channels are intercepted and disabled by the boundary.
installBroadcastFileBoundary({
  ipcMain,
  dialog,
  BrowserWindow,
  fs,
  uiEntryPath: path.join(__dirname, '../ui/index.html'),
});

require('./main.cjs');
