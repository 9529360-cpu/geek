'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, 'utf8');

function replaceExact(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`missing exact block: ${label}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`duplicate exact block: ${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function replaceRegex(text, pattern, to, label) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`expected one ${label}, found ${matches.length}`);
  return text.replace(pattern, to);
}

function updateMainEntry() {
  let text = read('src/main-entry.cjs');
  text = replaceExact(text,
    "const fs = nodeFs.promises;\nconst { app, BrowserWindow, dialog, ipcMain, safeStorage, session, webContents } = require('electron');",
    "const { app, BrowserWindow, session } = require('electron');",
    'main-entry imports');
  for (const line of [
    "const { installAccountDataBoundary } = require('./account-data-boundary.cjs');\n",
    "const { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');\n",
    "const { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');\n",
    "const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');\n",
    "const { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');\n",
    "const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');\n",
    "const { installAccountTypeBoundary } = require('./account-type-boundary.cjs');\n",
  ]) text = replaceExact(text, line, '', line.trim());
  text = replaceExact(text,
    "const { externalDebuggingRequested, installExternalDebuggingProbeGuard } = require('./external-debugging-policy.cjs');",
    "const { installExternalDebuggingProbeGuard } = require('./external-debugging-policy.cjs');",
    'external debugging import');
  text = replaceRegex(text,
    /  const uiEntryPath = path\.join\(__dirname, '\.\.\/ui\/index\.html'\);\n  const accountsFilePath = runtimePaths\.accountsFile\(earlyUserDataDir\);\n  const telegramNativeAttachments = createTelegramNativeAttachmentHandler\(\{[\s\S]*?  const remoteDebuggingRequested = externalDebuggingRequested\(\{ argv: process\.argv \}\);\n/,
    "  const accountsFilePath = runtimePaths.accountsFile(earlyUserDataDir);\n",
    'main-entry capability locals');
  text = replaceRegex(text,
    /\n  \/\/ Install the selected-file capability boundary before main\.cjs registers IPC\.[\s\S]*?\n  installAccountTypeBoundary\(\{ ipcMain \}\);\n/,
    '\n',
    'main-entry startup shims');
  write('src/main-entry.cjs', text);
}

function updateBroadcastFiles() {
  let text = read('src/broadcast-files.cjs');
  text = replaceRegex(text,
    /\nconst LEGACY_CHANNELS = Object\.freeze\(\{[\s\S]*?\n\}\);\n/,
    '\n',
    'legacy broadcast channel map');
  text = replaceRegex(text,
    /  const expectedLegacyChannels = new Set\(Object\.keys\(LEGACY_CHANNELS\)\);[\s\S]*?  const callOriginalHandle = \(channel, handler\) => originalHandleMethod\.call\(ipcMain, channel, handler\);\n/,
    "  const registeredChannels = new Set();\n  const register = (channel, handler) => {\n    ipcMain.handle(channel, handler);\n    registeredChannels.add(channel);\n  };\n",
    'broadcast interceptor setup');
  text = text.replaceAll('callOriginalHandle(', 'register(');

  const transportBlock = `\n  const tokenTransports = [\n    [CHANNELS.sendFileToken, options.sendFile],\n    [CHANNELS.attachFileToken, options.attachFile],\n    [CHANNELS.dropFileToken, options.dropFile],\n  ];\n  for (const [channel, transport] of tokenTransports) {\n    if (typeof transport !== 'function') throw new TypeError(\`${'${channel}'} transport must be a function\`);\n    register(channel, async (event, payload) => {\n      const { ownerId } = assertMainRenderer(event);\n      const source = payload && typeof payload === 'object' ? payload : {};\n      const selected = await registry.resolve(source.fileToken, ownerId);\n      const safePayload = { ...source };\n      delete safePayload.fileToken;\n      delete safePayload.filePath;\n      safePayload.filePath = selected.filePath;\n      safePayload.name = selected.name;\n      safePayload.mime = selected.mime;\n      return transport({ event, payload: safePayload });\n    });\n  }\n`;
  text = replaceExact(text,
    "  const sendTelegramFiles = options.sendTelegramFiles;\n",
    transportBlock + "\n  const sendTelegramFiles = options.sendTelegramFiles;\n",
    'broadcast transport injection');

  text = replaceRegex(text,
    /\n  const legacyDisabled = async \(\) => \{[\s\S]*?\n  return Object\.freeze\(\{\n    registry,\n    restore: \(\) => \{ ipcMain\.handle = originalHandleMethod; \},\n  \}\);/,
    `\n  return Object.freeze({\n    registry,\n    dispose() {\n      if (typeof ipcMain.removeHandler !== 'function') return;\n      for (const channel of registeredChannels) ipcMain.removeHandler(channel);\n      registeredChannels.clear();\n    },\n  });`,
    'broadcast legacy interceptor');
  write('src/broadcast-files.cjs', text);
}

function updateAccountDataBoundary() {
  let text = read('src/account-data-boundary.cjs');
  text = replaceExact(text, "const REMOVE_ACCOUNT_CHANNEL = 'accounts:remove';\n", '', 'remove account channel constant');
  text = replaceRegex(text,
    /  const expectedRegistrations = new Set\(\[\.\.\.ACCOUNT_DATA_CHANNELS, REMOVE_ACCOUNT_CHANNEL\]\);[\s\S]*?  const callOriginalHandle = \(channel, handler\) => originalHandleMethod\.call\(ipcMain, channel, handler\);\n/,
    "  const registeredChannels = new Set();\n  const register = (channel, handler) => {\n    ipcMain.handle(channel, handler);\n    registeredChannels.add(channel);\n  };\n",
    'account data interceptor setup');
  text = text.replaceAll('callOriginalHandle(', 'register(');

  const lifecycle = `\n  async function runAccountRemoval(event, accountId, removeImplementation, ...rest) {\n    if (typeof removeImplementation !== 'function') throw new TypeError('removeImplementation must be a function');\n    assertMainRenderer(event);\n    const id = assertAccountId(accountId);\n    const partition = await resolveAccountPartition(id);\n    await store.beginDelete(partition);\n    try {\n      await beforeAccountRemove({ event, accountId: id, partition });\n      const response = await removeImplementation(event, id, ...rest);\n      store.finalizeDelete(partition);\n      return response;\n    } catch (error) {\n      try {\n        await resolveAccountPartition(id);\n        store.cancelDelete(partition);\n      } catch (probeError) {\n        if (probeError?.code === 'ACCOUNT_DATA_ACCOUNT_MISSING') {\n          store.finalizeDelete(partition);\n          return Object.freeze({ ok: true, deleted: true, cleanupPending: true });\n        }\n        store.cancelDelete(partition);\n      }\n      throw error;\n    }\n  }\n`;
  text = replaceExact(text,
    "  register('account-data:remove', async (event, accountId, key) => {\n    assertMainRenderer(event);\n    const partition = await resolveAccountPartition(accountId);\n    return store.remove(partition, key);\n  });\n",
    "  register('account-data:remove', async (event, accountId, key) => {\n    assertMainRenderer(event);\n    const partition = await resolveAccountPartition(accountId);\n    return store.remove(partition, key);\n  });\n" + lifecycle,
    'account removal lifecycle insertion');
  text = replaceRegex(text,
    /\n  function restoreIfComplete\(\) \{[\s\S]*?\n  return Object\.freeze\(\{\n    store,\n    resolveAccountPartition,\n    restore: \(\) => \{ ipcMain\.handle = originalHandleMethod; \},\n  \}\);/,
    `\n  return Object.freeze({\n    store,\n    resolveAccountPartition,\n    runAccountRemoval,\n    dispose() {\n      if (typeof ipcMain.removeHandler !== 'function') return;\n      for (const channel of registeredChannels) ipcMain.removeHandler(channel);\n      registeredChannels.clear();\n    },\n  });`,
    'account data legacy interceptor');
  write('src/account-data-boundary.cjs', text);
}

function updateMain() {
  let text = read('src/main.cjs');
  text = replaceExact(text,
    "const { app, BrowserWindow, ipcMain, session, Notification, nativeTheme, webContents, Tray, Menu, nativeImage, safeStorage } = require('electron');\nconst path = require('node:path');\nconst fs = require('node:fs/promises');",
    "const { app, BrowserWindow, dialog, ipcMain, session, Notification, nativeTheme, webContents, Tray, Menu, nativeImage, safeStorage } = require('electron');\nconst path = require('node:path');\nconst nodeFs = require('node:fs');\nconst fs = nodeFs.promises;",
    'main core imports');
  text = replaceExact(text,
    "const { normalizeWebsiteUrl, parseWebsiteUrl } = require('./website-url.cjs');\n",
    "const { normalizeWebsiteUrl, parseWebsiteUrl } = require('./website-url.cjs');\nconst { installAccountDataBoundary } = require('./account-data-boundary.cjs');\nconst { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');\nconst { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');\nconst { installBroadcastFileBoundary } = require('./broadcast-files.cjs');\nconst { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');\nconst { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');\nconst { externalDebuggingRequested } = require('./external-debugging-policy.cjs');\n",
    'main capability imports');
  text = replaceExact(text,
    "  accountDataCaches.delete(removedAccount.partition);\n  accountDataLoaded.delete(removedAccount.partition);\n  accountDataWrites.delete(removedAccount.partition);\n",
    '',
    'legacy account data cleanup');
  text = replaceRegex(text,
    /\nconst accountDataCaches = new Map\(\);[\s\S]*?\nasync function appendAccountData\(partition, key, value, deleted = false\) \{[\s\S]*?\n\}\nfunction resolveAccountPartition/,
    '\nfunction resolveAccountPartition',
    'legacy account data store');

  const composition = `function registerIpcHandlers() {\n  const uiEntryPath = path.join(__dirname, '../ui/index.html');\n  const remoteDebuggingRequested = externalDebuggingRequested({ argv: process.argv });\n  const telegramNativeAttachments = createTelegramNativeAttachmentHandler({\n    getAllWebContents: () => webContents.getAllWebContents(),\n  });\n  const broadcastFileBoundary = installBroadcastFileBoundary({\n    ipcMain,\n    dialog,\n    BrowserWindow,\n    fs,\n    uiEntryPath,\n    sendFile: ({ event, payload }) => sendBroadcastFile(event, payload),\n    attachFile: ({ event, payload }) => attachBroadcastFile(event, payload),\n    dropFile: ({ event, payload }) => dropBroadcastFile(event, payload),\n    sendTelegramFiles: async ({ payload }) => {\n      if (remoteDebuggingRequested) {\n        const error = new Error('TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED');\n        error.code = 'TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED';\n        throw error;\n      }\n      return telegramNativeAttachments.send(payload);\n    },\n  });\n  const scheduledAttachmentBoundary = installScheduledBroadcastAttachmentBoundary({\n    ipcMain,\n    BrowserWindow,\n    fs,\n    uiEntryPath,\n    ephemeralRegistry: broadcastFileBoundary.registry,\n    getUserDataDir: () => app.getPath('userData'),\n  });\n  const accountDataBoundary = installAccountDataBoundary({\n    ipcMain,\n    BrowserWindow,\n    fs,\n    createReadStream: nodeFs.createReadStream,\n    getUserDataDir: () => app.getPath('userData'),\n    uiEntryPath,\n    allowedKeys: [...ACCOUNT_DATA_KEYS, ...BROADCAST_ACCOUNT_DATA_KEYS],\n    beforeAccountRemove: ({ accountId }) => scheduledAttachmentBoundary.cleanupAccount(accountId),\n    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),\n    encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),\n    decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),\n    onCompactionError: (error) => {\n      const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');\n      console.error('[account-data] compaction retry required:', code.slice(0, 80));\n    },\n  });\n`;
  text = replaceExact(text, 'function registerIpcHandlers() {\n', composition, 'IPC composition');

  text = replaceRegex(text,
    /  ipcMain\.handle\('account-data:get-all',[\s\S]*?  ipcMain\.handle\('account-data:remove',[\s\S]*?\n  \}\);\n/,
    '',
    'duplicate account-data handlers');
  text = replaceExact(text,
    "  ipcMain.handle('accounts:remove', removeAccount);",
    "  ipcMain.handle('accounts:remove', (event, accountId) => accountDataBoundary.runAccountRemoval(event, accountId, removeAccount));",
    'accounts remove registration');
  text = replaceRegex(text,
    /\n  \/\/ 选择文件（群发附件）[\s\S]*?\n  \/\/ WA 媒体发送链路/,
    '\n  // WA 媒体发送链路',
    'legacy raw picker');
  text = replaceRegex(text,
    /  ipcMain\.handle\('broadcast:send-file', async \(event, payload\) => \{([\s\S]*?)\n  \}\);/,
    "  async function sendBroadcastFile(event, payload) {$1\n  }",
    'send file transport');
  text = replaceRegex(text,
    /  ipcMain\.handle\('broadcast:attach-file', async \(event, payload\) => \{([\s\S]*?)\n  \}\);/,
    "  async function attachBroadcastFile(event, payload) {$1\n  }",
    'attach file transport');
  text = replaceRegex(text,
    /  ipcMain\.handle\('broadcast:drop-file', async \(event, payload\) => \{([\s\S]*?)\n  \}\);/,
    "  async function dropBroadcastFile(event, payload) {$1\n  }",
    'drop file transport');
  text = replaceRegex(text,
    /\n  \/\/ 选择 CSV 联系人文件（群发导入）[\s\S]*?\n  \/\/ 保存文件（群发失败名单导出）/,
    '\n  // 保存文件（群发失败名单导出）',
    'legacy CSV picker');
  text = replaceRegex(text,
    /\nfunction guessMime\(p\) \{[\s\S]*?\n\}\n\n\/\/ 系统深\/浅色变化/,
    '\n// 系统深/浅色变化',
    'legacy main guessMime');
  write('src/main.cjs', text);
}

function cleanupBootstrapFiles() {
  fs.rmSync(path.join(root, 'src/account-type-boundary.cjs'));
  fs.rmSync(path.join(root, 'scripts/ipc-refactor-bootstrap.cjs'));
  fs.rmSync(path.join(root, '.github/workflows/ipc-refactor-bootstrap.yml'));
}

updateMainEntry();
updateBroadcastFiles();
updateAccountDataBoundary();
updateMain();
cleanupBootstrapFiles();
console.log('IPC_REFACTOR_BOOTSTRAP_OK');
