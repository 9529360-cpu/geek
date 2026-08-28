'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MiB = 1024 * 1024;

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 512 * MiB,
  maxTotalBytes: 1024 * MiB,
  maxImportBytes: 5 * MiB,
  tokenTtlMs: 6 * 60 * 60 * 1000,
  maxRegistryEntries: 100,
});

const CHANNELS = Object.freeze({
  pickToken: 'file:pick-token',
  pickCsvLimited: 'file:pick-csv-limited',
  sendFileToken: 'broadcast:send-file-token',
  attachFileToken: 'broadcast:attach-file-token',
  dropFileToken: 'broadcast:drop-file-token',
  telegramFilesToken: 'broadcast:telegram-files-token',
});

const LEGACY_CHANNELS = Object.freeze({
  'file:pick': null,
  'file:pick-csv': null,
  'broadcast:send-file': CHANNELS.sendFileToken,
  'broadcast:attach-file': CHANNELS.attachFileToken,
  'broadcast:drop-file': CHANNELS.dropFileToken,
});

const POLICY_MESSAGES = Object.freeze({
  BROADCAST_FILE_COUNT_LIMIT: '一次最多选择 10 个附件。',
  BROADCAST_FILE_SIZE_LIMIT: '单个附件不能超过 512 MiB。',
  BROADCAST_FILE_TOTAL_LIMIT: '一次选择的附件总大小不能超过 1 GiB。',
  BROADCAST_FILE_REGISTRY_LIMIT: '已选择的附件过多，请重新打开应用后再试。',
  BROADCAST_FILE_UNAVAILABLE: '所选文件已不可用，请重新选择。',
  BROADCAST_IMPORT_TYPE_INVALID: '联系人导入只支持 CSV 或 TXT 文件。',
  BROADCAST_IMPORT_SIZE_LIMIT: '联系人 CSV/TXT 不能超过 5 MiB。',
});

function createPolicyError(code, publicMessage = POLICY_MESSAGES[code] || '文件处理失败，请重新选择。') {
  const error = new Error(code);
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function isPolicyError(error) {
  return Boolean(error && typeof error.code === 'string' && error.code.startsWith('BROADCAST_'));
}

function guessMime(filePath, pathModule = path) {
  const ext = pathModule.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
    '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  };
  return map[ext] || 'application/octet-stream';
}

function normalizeOwnerId(ownerId) {
  const value = String(ownerId ?? '');
  if (!value) throw createPolicyError('BROADCAST_FILE_OWNER_INVALID');
  return value;
}

function normalizeStat(stat) {
  if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) {
    throw createPolicyError('BROADCAST_FILE_UNAVAILABLE');
  }
  const size = Number(stat.size);
  const mtimeMs = Number(stat.mtimeMs);
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isFinite(mtimeMs)) {
    throw createPolicyError('BROADCAST_FILE_UNAVAILABLE');
  }
  return { size, mtimeMs };
}

function createBroadcastFileRegistry(options = {}) {
  const fs = options.fs;
  if (!fs || typeof fs.stat !== 'function' || typeof fs.realpath !== 'function' || typeof fs.open !== 'function') {
    throw new TypeError('fs with stat, realpath and open is required');
  }
  const pathModule = options.pathModule || path;
  const now = options.now || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(options.limits || {}) });
  const entries = new Map();

  function pruneExpired(currentTime = now()) {
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(token);
    }
  }

  function nextToken() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = randomBytes(24).toString('hex');
      if (/^[a-f0-9]{48}$/.test(token) && !entries.has(token)) return token;
    }
    throw createPolicyError('BROADCAST_FILE_TOKEN_GENERATION_FAILED');
  }

  async function registerSelection(filePaths, ownerId) {
    const owner = normalizeOwnerId(ownerId);
    pruneExpired();
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    if (filePaths.length > limits.maxFiles) {
      throw createPolicyError('BROADCAST_FILE_COUNT_LIMIT');
    }
    if (entries.size + filePaths.length > limits.maxRegistryEntries) {
      throw createPolicyError('BROADCAST_FILE_REGISTRY_LIMIT');
    }

    const staged = [];
    let totalBytes = 0;
    for (const selectedPath of filePaths) {
      let canonicalPath;
      let stat;
      try {
        canonicalPath = await fs.realpath(String(selectedPath || ''));
        stat = await fs.stat(canonicalPath);
      } catch {
        throw createPolicyError('BROADCAST_FILE_UNAVAILABLE');
      }
      const { size, mtimeMs } = normalizeStat(stat);
      if (size > limits.maxFileBytes) {
        throw createPolicyError('BROADCAST_FILE_SIZE_LIMIT');
      }
      totalBytes += size;
      if (totalBytes > limits.maxTotalBytes) {
        throw createPolicyError('BROADCAST_FILE_TOTAL_LIMIT');
      }
      staged.push({
        canonicalPath,
        name: pathModule.basename(String(selectedPath || '')) || pathModule.basename(canonicalPath),
        size,
        mtimeMs,
        mime: guessMime(selectedPath, pathModule),
      });
    }

    const expiresAt = now() + limits.tokenTtlMs;
    return staged.map((item) => {
      const token = nextToken();
      entries.set(token, { ...item, owner, expiresAt });
      return Object.freeze({ token, name: item.name, size: item.size, mime: item.mime });
    });
  }

  async function resolve(tokenValue, ownerId) {
    const owner = normalizeOwnerId(ownerId);
    const token = String(tokenValue || '');
    if (!/^[a-f0-9]{48}$/.test(token)) {
      throw createPolicyError('BROADCAST_FILE_TOKEN_INVALID');
    }
    const entry = entries.get(token);
    if (!entry) throw createPolicyError('BROADCAST_FILE_TOKEN_INVALID');
    const currentTime = now();
    if (entry.expiresAt <= currentTime) {
      entries.delete(token);
      throw createPolicyError('BROADCAST_FILE_TOKEN_EXPIRED');
    }
    pruneExpired(currentTime);
    if (entry.owner !== owner) throw createPolicyError('BROADCAST_FILE_TOKEN_INVALID');

    let stat;
    try {
      stat = await fs.stat(entry.canonicalPath);
    } catch {
      entries.delete(token);
      throw createPolicyError('BROADCAST_FILE_UNAVAILABLE');
    }
    const current = normalizeStat(stat);
    if (current.size !== entry.size || current.mtimeMs !== entry.mtimeMs) {
      entries.delete(token);
      throw createPolicyError('BROADCAST_FILE_CHANGED', '所选文件已发生变化，请重新选择。');
    }
    // Treat the TTL as an idle lease, not an absolute Job lifetime. Only a
    // successful resolve by the original renderer owner, after file-integrity
    // validation, renews it. Unused tokens still expire and invalid callers
    // cannot keep another owner's capability alive.
    entry.expiresAt = currentTime + limits.tokenTtlMs;
    return Object.freeze({
      filePath: entry.canonicalPath,
      name: entry.name,
      size: entry.size,
      mime: entry.mime,
    });
  }

  async function readImportFile(selectedPath) {
    const requested = String(selectedPath || '');
    const ext = pathModule.extname(requested).toLowerCase();
    if (ext !== '.csv' && ext !== '.txt') {
      throw createPolicyError('BROADCAST_IMPORT_TYPE_INVALID');
    }

    let canonicalPath;
    let handle;
    try {
      canonicalPath = await fs.realpath(requested);
      handle = await fs.open(canonicalPath, 'r');
      const stat = await handle.stat();
      const { size } = normalizeStat(stat);
      if (size > limits.maxImportBytes) {
        throw createPolicyError('BROADCAST_IMPORT_SIZE_LIMIT');
      }
      const buffer = Buffer.allocUnsafe(limits.maxImportBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limits.maxImportBytes) {
        throw createPolicyError('BROADCAST_IMPORT_SIZE_LIMIT');
      }
      return Object.freeze({
        name: pathModule.basename(requested) || pathModule.basename(canonicalPath),
        content: buffer.subarray(0, bytesRead).toString('utf8'),
      });
    } catch (error) {
      if (isPolicyError(error)) throw error;
      throw createPolicyError('BROADCAST_FILE_UNAVAILABLE');
    } finally {
      if (handle) {
        try { await handle.close(); } catch { /* ignore close failure */ }
      }
    }
  }

  return Object.freeze({
    limits,
    registerSelection,
    resolve,
    readImportFile,
    size: () => entries.size,
  });
}

function installBroadcastFileBoundary(options = {}) {
  const { ipcMain, dialog, BrowserWindow, uiEntryPath } = options;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  if (!dialog || typeof dialog.showOpenDialog !== 'function') throw new TypeError('dialog is required');
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== 'function') throw new TypeError('BrowserWindow is required');
  if (!uiEntryPath) throw new TypeError('uiEntryPath is required');

  const pathModule = options.pathModule || path;
  const fileURLToPathFn = options.fileURLToPath || fileURLToPath;
  const platform = options.platform || process.platform;
  const registry = createBroadcastFileRegistry(options);
  const expectedLegacyChannels = new Set(Object.keys(LEGACY_CHANNELS));
  const intercepted = new Set();
  const originalHandleMethod = ipcMain.handle;
  const callOriginalHandle = (channel, handler) => originalHandleMethod.call(ipcMain, channel, handler);
  const expectedUiPath = pathModule.resolve(uiEntryPath);
  const comparablePath = (value) => platform === 'win32' ? value.toLowerCase() : value;

  function assertMainRenderer(event) {
    const sender = event && event.sender;
    const win = sender ? BrowserWindow.fromWebContents(sender) : null;
    if (!sender || !win || (typeof win.isDestroyed === 'function' && win.isDestroyed()) || !win.webContents || win.webContents.id !== sender.id) {
      throw createPolicyError('BROADCAST_FILE_OWNER_INVALID');
    }
    let senderPath = '';
    try {
      senderPath = pathModule.resolve(fileURLToPathFn(new URL(win.webContents.getURL())));
    } catch {
      throw createPolicyError('BROADCAST_FILE_OWNER_INVALID');
    }
    if (comparablePath(senderPath) !== comparablePath(expectedUiPath)) {
      throw createPolicyError('BROADCAST_FILE_OWNER_INVALID');
    }
    return { ownerId: String(sender.id), win };
  }

  async function warnAndReturnNull(win, error) {
    if (!isPolicyError(error)) throw error;
    if (typeof dialog.showMessageBox === 'function') {
      await dialog.showMessageBox(win, {
        type: 'warning',
        title: '文件未添加',
        message: error.publicMessage || '文件处理失败，请重新选择。',
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      });
    }
    return null;
  }

  callOriginalHandle(CHANNELS.pickToken, async (event) => {
    const { ownerId, win } = assertMainRenderer(event);
    const result = await dialog.showOpenDialog(win, {
      title: '选择要群发的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片/文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'mp4', 'mp3'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    try {
      const files = await registry.registerSelection(result.filePaths, ownerId);
      return files.length === 1 ? files[0] : files;
    } catch (error) {
      return warnAndReturnNull(win, error);
    }
  });

  const sendTelegramFiles = options.sendTelegramFiles;
  if (sendTelegramFiles !== undefined && typeof sendTelegramFiles !== 'function') {
    throw new TypeError('sendTelegramFiles must be a function');
  }

  if (sendTelegramFiles) {
    callOriginalHandle(CHANNELS.telegramFilesToken, async (event, payload) => {
      const { ownerId } = assertMainRenderer(event);
      const source = payload && typeof payload === 'object' ? payload : {};
      const tokens = Array.isArray(source.fileTokens) ? source.fileTokens.map((value) => String(value || '')) : [];
      if (!tokens.length || tokens.length > registry.limits.maxFiles || new Set(tokens).size !== tokens.length) {
        throw createPolicyError('BROADCAST_FILE_TOKEN_INVALID');
      }
      const selectedFiles = [];
      for (const token of tokens) {
        selectedFiles.push(await registry.resolve(token, ownerId));
      }
      const safePayload = {
        partition: String(source.partition || ''),
        guestId: Number.isSafeInteger(Number(source.guestId)) ? Number(source.guestId) : null,
        targetChatId: String(source.targetChatId || ''),
        caption: String(source.caption || ''),
        files: selectedFiles,
      };
      return sendTelegramFiles({ event, payload: safePayload });
    });
  }

  callOriginalHandle(CHANNELS.pickCsvLimited, async (event) => {
    const { win } = assertMainRenderer(event);
    const result = await dialog.showOpenDialog(win, {
      title: '选择联系人 CSV 文件',
      properties: ['openFile'],
      filters: [{ name: '联系人表格', extensions: ['csv', 'txt'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    try {
      return await registry.readImportFile(result.filePaths[0]);
    } catch (error) {
      return warnAndReturnNull(win, error);
    }
  });

  const legacyDisabled = async () => {
    throw createPolicyError('BROADCAST_LEGACY_FILE_CHANNEL_DISABLED');
  };

  function restoreIfComplete() {
    if (intercepted.size === expectedLegacyChannels.size && ipcMain.handle !== originalHandleMethod) {
      ipcMain.handle = originalHandleMethod;
    }
  }

  ipcMain.handle = function interceptedHandle(channel, listener) {
    if (!expectedLegacyChannels.has(channel)) {
      return originalHandleMethod.call(this, channel, listener);
    }
    intercepted.add(channel);
    const tokenChannel = LEGACY_CHANNELS[channel];
    const result = callOriginalHandle(channel, legacyDisabled);
    if (tokenChannel) {
      callOriginalHandle(tokenChannel, async (event, payload) => {
        const { ownerId } = assertMainRenderer(event);
        const selected = await registry.resolve(payload && payload.fileToken, ownerId);
        const safePayload = { ...(payload && typeof payload === 'object' ? payload : {}) };
        delete safePayload.fileToken;
        delete safePayload.filePath;
        safePayload.filePath = selected.filePath;
        safePayload.name = selected.name;
        safePayload.mime = selected.mime;
        return listener(event, safePayload);
      });
    }
    restoreIfComplete();
    return result;
  };

  return Object.freeze({
    registry,
    restore: () => { ipcMain.handle = originalHandleMethod; },
  });
}

module.exports = {
  CHANNELS,
  DEFAULT_LIMITS,
  createBroadcastFileRegistry,
  installBroadcastFileBoundary,
  isPolicyError,
};
