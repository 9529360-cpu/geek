'use strict';

const { app, BrowserWindow, dialog, ipcMain, session, Notification, nativeTheme, webContents, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const { initAutoUpdater } = require('./updater.cjs');
const { quitAndInstallForUpdate, isUpdateInstalling } = require('./updater.cjs');
const { createOwnershipRegistry } = require('./webview-ownership.cjs');
const { installWebviewIpc } = require('./webview-ipc.cjs');
const webviewOwnership = createOwnershipRegistry();
const runtimePaths = require('./runtime-paths.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const { createInternalCdp } = require('./internal-cdp.cjs');
const { createRateLimiter } = require('./crash-recovery.cjs');
const { collectOrphanPartitions } = require('./partition-cleanup.cjs');
const { createSubscriptionStore } = require('./subscription.cjs');
const { installSubscriptionIpc } = require('./subscription-ipc.cjs');
const { installDesktopIpc } = require('./desktop-ipc.cjs');
const { runStartupAclRepair, resolveUsername } = require('./acl-repair.cjs');
const { verifyRuntimeIntegrity } = require('./unpacked-integrity.cjs');
const { cleanupPendingPartitions } = require('./exit-partition-cleanup.cjs');
const { sanitizeUrlForLog } = require('./log-url.cjs');
const { normalizeWebsiteUrl } = require('./website-url.cjs');
const { LINE_EXTENSION_ID, LINE_EXTENSION_URL, WA_LOCAL_PORT, WA_LOCAL_URL, WA_WEB_URL, PLATFORM_CATALOG, platformConfig } = require('./platform-catalog.cjs');
const { isAccountNavigationAllowed } = require('./webview-navigation-boundary.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { installAccountIpc } = require('./account-ipc.cjs');
const { createAccountStateStore, ACCOUNT_PARTITION_PREFIX } = require('./account-state.cjs');
const { createConfigStateStore } = require('./config-state.cjs');
const { installConfigIpc } = require('./config-ipc.cjs');
const { createTranslationRuntime } = require('./translation-runtime.cjs');
const { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');
const { externalDebuggingRequested } = require('./external-debugging-policy.cjs');
const { createProxyRuntime } = require('./proxy-runtime.cjs');
const relaunchLimiter = createRateLimiter({ max: 2, windowMs: 5 * 60 * 1000 });
const USER_DATA_DIR = runtimePaths.resolveUserDataDir({
  appDataDir: app.getPath('appData'),
  overrideDir: process.env.GEEK_USER_DATA_DIR
});
const diagnostics = (() => {
  try {
    return createDiagnostics({
      dir: path.join(USER_DATA_DIR, 'diagnostics'),
      maxBytes: 5 * 1024 * 1024,
      maxFiles: 5
    });
  } catch (error) {
    console.error('[diagnostics] 初始化失败:', error.message);
    return { log() {} };
  }
})();

process.on('uncaughtExceptionMonitor', (error, origin) => {
  diagnostics.log('uncaught-exception', {
    origin,
    errorMessage: String(error?.message || error).slice(0, 500)
  });
});

// 应用内 CDP：正式打包版不依赖外部 9344。开发模式（带 --remote-debugging-port=9344）时
// 外部调试器已附加到 webview，webContents.debugger 命令会静默无效，因此探测到 9344 时
// 附件处理器走原外部 CDP 路径；未探测到（打包版）走应用内 CDP。
let externalDebuggingActive = false;
async function probeExternalDebugging() {
  try {
    await new Promise((resolve, reject) => {
      const httpMod = require('node:http');
      httpMod.get('http://127.0.0.1:9344/json', (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    externalDebuggingActive = true;
  } catch {
    externalDebuggingActive = false;
  }
}
const internalCdp = createInternalCdp({
  getAllWebContents: () => webContents.getAllWebContents(),
  timeoutMs: 10000,
  externalDebugging: false
});

// 固定 userData 目录：防止 package name 变化导致登录态数据目录漂移
// （原 whatsapp-multi 目录已有全部账号登录数据，保持指向它）
try {
  app.setPath('userData', USER_DATA_DIR);
} catch (e) { /* 设置失败不影响 */ }

const wppInjected = new Set(); // 已注入 WPP 的 partition（WA 内部 API 直发）
const pendingPartitionDeletions = new Set(); // 删除失败的分区目录，退出时兜底清理

// 保留经过验证且不降低网页安全边界的进程参数。
try {
  app.commandLine.appendSwitch('no-zygote');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
} catch (e) { /* 参数设置失败不影响 */ }

// 运行期 accounts/config 固定写入 Electron userData，不再写入项目 data/。
// 首次运行时会从旧 data/ 安全迁移（目标已存在则以目标为准）。
const CONFIG_FILE = runtimePaths.configFile(USER_DATA_DIR);
const PARTITION_PREFIX = ACCOUNT_PARTITION_PREFIX;
// Ordinary Chrome UA so WhatsApp/Telegram Web don't reject the embedded browser.
// Same UA family the original Hello-GPT ships (verified working with WhatsApp Web).
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36';


const accountState = createAccountStateStore({
  fs,
  filePath: runtimePaths.accountsFile(USER_DATA_DIR),
  resolveTypeConfig: platformConfig,
  normalizeWebsiteUrl,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
  onMigrationError: (error, meta) => {
    const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
    console.error(`[account-state] ${meta?.phase === 'migration' ? 'migration' : 'load'} failed:`, code.slice(0, 80));
  },
});

const configStore = createConfigStateStore({
  fs,
  filePath: CONFIG_FILE,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
  onRecoveryEvent: (error, meta) => {
    const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
    const phase = typeof meta?.phase === 'string' ? meta.phase : 'load';
    console.error(`[config-state] ${phase} failed: ${code.slice(0, 80)} recovered=${meta?.recovered === true ? 'yes' : 'no'}`);
  },
});

const proxyRuntime = createProxyRuntime({
  app,
  sessionModule: session,
  accountState,
  getGlobalConfig: () => configStore.getSnapshot(),
  onError: (_error, meta) => {
    const partition = typeof meta?.partition === 'string' ? meta.partition : '';
    const phase = typeof meta?.phase === 'string' ? meta.phase : 'apply';
    const code = typeof meta?.code === 'string' ? meta.code : 'PROXY_APPLY_FAILED';
    console.error(`[proxy] ${phase} failed (${partition}): ${code}`);
    diagnostics.log('proxy-runtime-failed', { partition, phase, code });
  },
});

// LINE 官方浏览器扩展（复刻项目自带副本，供 line / line-business 账号登录使用）
// 用 MV3 原始扩展（与 Hello-GPT 原版完全一致）；Electron 35.5.1 下 SW 注册行为待验证
// 打包后扩展目录会被 asarUnpack 到真实磁盘（ses.extensions.loadExtension 需要真实文件），
// 因此资源目录在打包模式下解析到 app.asar.unpacked；开发模式仍指向项目 resources/。
const RESOURCES_DIR = runtimePaths.resourcesDirFor({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname
});
const LINE_EXTENSION_PATH = path.join(
  RESOURCES_DIR, 'extensions', 'line-3.5.1'
);

let unpackedIntegrityState = {
  manifestOk: !app.isPackaged,
  bridge: !app.isPackaged,
  lineExtension: !app.isPackaged
};

async function verifyPackagedUnpackedAssets() {
  if (!app.isPackaged) {
    unpackedIntegrityState = { manifestOk: true, bridge: true, lineExtension: true };
    return unpackedIntegrityState;
  }
  const manifestPath = path.join(__dirname, 'unpacked-integrity.generated.json');
  let result;
  try {
    result = await verifyRuntimeIntegrity({ manifestPath, resourcesDir: RESOURCES_DIR });
  } catch {
    result = { manifestOk: false, bridge: false, lineExtension: false, errors: ['verification'] };
  }
  unpackedIntegrityState = {
    manifestOk: result.manifestOk === true,
    bridge: result.bridge === true,
    lineExtension: result.lineExtension === true
  };
  diagnostics.log('runtime-asset-integrity', {
    manifestOk: unpackedIntegrityState.manifestOk,
    bridgeOk: unpackedIntegrityState.bridge,
    lineExtensionOk: unpackedIntegrityState.lineExtension
  });
  if (!unpackedIntegrityState.bridge || !unpackedIntegrityState.lineExtension) {
    console.error('[security] 解包运行时代码完整性校验失败；受影响平台已阻止加载');
  }
  return unpackedIntegrityState;
}

function runtimeAssetAllowed(component) {
  return !app.isPackaged || unpackedIntegrityState[component] === true;
}

// HelloWorld 剥离的 WhatsApp 扩展（Pragmaz）已弃用：
// - 内含原版作者硬编码的 BrightData 代理凭据（安全/数据风险）
// - 会与第三方 pragmaz.ai 通信
// - 极客自有群发/翻译/发送功能走 WPP+CDP，不依赖该扩展
// - 打包时已从 asarUnpack 排除（见 electron-builder.yml）

async function loadLineExtension(partition) {
  if (!runtimeAssetAllowed('lineExtension')) {
    diagnostics.log('runtime-asset-blocked', { component: 'line-extension' });
    console.error('[security] LINE 扩展完整性校验失败，拒绝加载');
    return;
  }
  try {
    const ses = session.fromPartition(partition, { cache: true });
    try {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        if (/checkQrCodeVerified/.test(details.url)) {
          const h = details.requestHeaders || {};
          let urlSafe = '';
          try {
            const u = new URL(details.url);
            urlSafe = `${u.host}${u.pathname}`.slice(-60);
          } catch {
            urlSafe = String(details.url).replace(/[?#].*$/, '').slice(-60);
          }
          console.log(`[line-hdr] ${urlSafe} UA=${(h['User-Agent']||'').slice(0,50)} OriginPresent=${h['Origin']?'yes':'no'} RefererPresent=${h['Referer']?'yes':'no'} CT=${h['Content-Type']||''} XSID=${h['X-Line-Session-ID']?'yes':'no'} XLST=${h['X-LST']?'yes':'no'}`);
        }
        callback({ requestHeaders: details.requestHeaders });
      });
      ses.webRequest.onCompleted((details) => {
        if (/line-chrome-gw/.test(details.url)) {
          let urlSafe = '';
          try {
            const u = new URL(details.url);
            urlSafe = `${u.host}${u.pathname}`;
          } catch {
            urlSafe = String(details.url).replace(/[?#].*$/, '');
          }
          console.log(`[line-api] ${details.statusCode} ${details.method} ${urlSafe.slice(0, 150)}`);
        }
      });
    } catch (e) { /* webRequest 监听失败不影响 */ }
    const ext = await ses.extensions.loadExtension(LINE_EXTENSION_PATH);
    if (ext) {
      console.log(`[line] 扩展已加载到 ${partition}: ${ext.name} ${ext.version}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('line:extension-ready', partition);
      }
    }
  } catch (error) {
    console.error(`[line] 扩展加载失败 (${partition}):`, error.message);
  }
}

let mainWindow = null;

function publicState(snapshot = accountState.getSnapshot()) {
  return {
    activeAccountId: snapshot.activeAccountId,
    accounts: snapshot.accounts.map((account) => {
      const config = platformConfig(account.type);
      let url = config ? config.url : PLATFORM_CATALOG[account.type].url;
      if (account.type === 'whatsapp' || account.type === 'whatsapp-pure') url = WA_LOCAL_URL;
      if (account.type === 'website' && account.customUrl) {
        url = account.customUrl;
      }
      return {
        ...account,
        active: account.id === snapshot.activeAccountId,
        url,
        typeName: config ? config.name : account.type,
        typeShort: config && config.short ? config.short : account.type.slice(0, 2).toUpperCase(),
        userAgent: CHROME_USER_AGENT
      };
    })
  };
}

function applyLoginItemSettings(config = configStore.getSnapshot()) {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: config.autoLaunch,
      openAsHidden: config.isStartupMinimize
    });
  } catch (error) {
    console.error('设置开机自启失败:', error);
  }
}

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return event.sender.id === mainWindow.webContents.id;
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
}

function assertValidAccountId(accountId) {
  if (typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId)) {
    throw new Error('无效的账号 ID');
  }
}

function notifyAccountsChanged(snapshot = accountState.getSnapshot()) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('accounts:changed', publicState(snapshot));
  }
}

async function addAccount(_event, payload = {}) {
  assertTrustedSender(_event);
  const result = await accountState.add(payload);
  const account = result.account;
  const config = platformConfig(account.type);
  await proxyRuntime.applyAccount(account, configStore.getSnapshot());
  notifyAccountsChanged(result.snapshot);
  return {
    state: publicState(result.snapshot),
    account: {
      ...account,
      active: true,
      url: account.type === 'website' ? account.customUrl : config.url,
      userAgent: CHROME_USER_AGENT
    }
  };
}

async function switchAccount(event, accountId) {
  assertTrustedSender(event);
  const result = await accountState.activate(accountId);
  notifyAccountsChanged(result.snapshot);
  return publicState(result.snapshot);
}

async function removeAccount(event, accountId) {
  assertTrustedSender(event);
  const result = await accountState.remove(accountId);
  const removedAccount = result.removedAccount;

  translationRuntime?.deleteAccount(removedAccount.partition);
  proxyRuntime.forgetPartition(removedAccount.partition);

  try {
    const guests = webContents.getAllWebContents().filter(
      (wc) => wc.session?.partition === removedAccount.partition
    );
    for (const wc of guests) {
      if (!wc.isDestroyed()) wc.destroy();
    }
  } catch (e) { /* 销毁失败不影响 */ }

  const partDir = path.join(
    app.getPath('userData'),
    'Partitions',
    removedAccount.partition.replace(/^persist:/, '')
  );
  try {
    const accountSession = session.fromPartition(removedAccount.partition, { cache: true });
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
    await accountSession.clearHostResolverCache();
    await accountSession.flushStorageData();
    try {
      let removed = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rm(partDir, { recursive: true, force: true });
          removed = true;
          pendingPartitionDeletions.delete(partDir);
          break;
        } catch (rmError) {
          if (attempt === 4) throw rmError;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      if (!removed) {
        pendingPartitionDeletions.add(partDir);
        console.error(`分区目录删除失败（延迟到退出时清理）: ${partDir}`);
      }
    } catch (dirError) {
      pendingPartitionDeletions.add(partDir);
      console.error(`删除账号分区目录失败 (${removedAccount.partition}):`, dirError.message);
    }
  } catch (error) {
    pendingPartitionDeletions.add(partDir);
    console.error(`清理账号 ${accountId} 的会话数据失败:`, error);
    throw new Error('账号已删除，但登录数据清理失败');
  } finally {
    notifyAccountsChanged(result.snapshot);
  }

  return publicState(result.snapshot);
}

let accountIpcBoundary = null;
let configIpcBoundary = null;
let translationRuntime = null;
let desktopIpcBoundary = null;
let webviewIpcBoundary = null;

async function updateAccount(event, accountId, patchData) {
  assertTrustedSender(event);
  const result = await accountState.update(accountId, patchData);
  const account = result.account;
  await proxyRuntime.applyAccount(account, configStore.getSnapshot());
  notifyAccountsChanged(result.snapshot);
  return publicState(result.snapshot);
}

async function moveAccount(event, accountId, direction) {
  assertTrustedSender(event);
  const result = await accountState.move(accountId, direction);
  notifyAccountsChanged(result.snapshot);
  return publicState(result.snapshot);
}

async function moveAccountTo(event, accountId, targetIndex) {
  assertTrustedSender(event);
  const result = await accountState.moveTo(accountId, targetIndex);
  notifyAccountsChanged(result.snapshot);
  return publicState(result.snapshot);
}

function registerIpcHandlers() {
  const uiEntryPath = path.join(__dirname, '../ui/index.html');
  const remoteDebuggingRequested = externalDebuggingRequested({ argv: process.argv });
  const telegramNativeAttachments = createTelegramNativeAttachmentHandler({
    getAllWebContents: () => webContents.getAllWebContents(),
  });
  const broadcastFileBoundary = installBroadcastFileBoundary({
    ipcMain,
    dialog,
    BrowserWindow,
    fs,
    uiEntryPath,
    sendFile: ({ event, payload }) => sendBroadcastFile(event, payload),
    attachFile: ({ event, payload }) => attachBroadcastFile(event, payload),
    dropFile: ({ event, payload }) => dropBroadcastFile(event, payload),
    sendTelegramFiles: async ({ payload }) => {
      if (remoteDebuggingRequested) {
        const error = new Error('TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED');
        error.code = 'TG_NATIVE_ATTACH_EXTERNAL_DEBUG_UNSUPPORTED';
        throw error;
      }
      return telegramNativeAttachments.send(payload);
    },
  });
  const scheduledAttachmentBoundary = installScheduledBroadcastAttachmentBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    uiEntryPath,
    ephemeralRegistry: broadcastFileBoundary.registry,
    getUserDataDir: () => app.getPath('userData'),
  });
  const accountDataBoundary = installAccountDataBoundary({
    ipcMain,
    BrowserWindow,
    fs,
    createReadStream: nodeFs.createReadStream,
    getUserDataDir: () => app.getPath('userData'),
    uiEntryPath,
    allowedKeys: [...ACCOUNT_DATA_KEYS, ...BROADCAST_ACCOUNT_DATA_KEYS],
    resolveAccountPartition: accountId => accountState.resolvePartition(accountId),
    beforeAccountRemove: ({ accountId }) => scheduledAttachmentBoundary.cleanupAccount(accountId),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
    onCompactionError: (error) => {
      const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
      console.error('[account-data] compaction retry required:', code.slice(0, 80));
    },
  });
  accountIpcBoundary = installAccountIpc({
    ipcMain,
    assertTrustedSender,
    listAccounts: async () => publicState(accountState.getSnapshot()),
    addAccount,
    removeAccount: (event, accountId) => accountDataBoundary.runAccountRemoval(event, accountId, removeAccount),
    switchAccount,
    updateAccount,
    moveAccount,
    moveAccountTo,
  });
  translationRuntime = createTranslationRuntime({
    ipcMain,
    fs,
    safeStorage,
    getUserDataDir: () => app.getPath('userData'),
    accountState,
    createGatewayPool: require('./gateway-failover.cjs').createGatewayPool,
    assertSafeTranslationOutput: require('./translation-output-safety.cjs').assertSafeTranslationOutput,
    assertTrustedSender,
    assertValidAccountId,
    getSubscriptionStore: () => initSubscriptionStore(),
  }).install();

  webviewIpcBoundary = installWebviewIpc({
    ipcMain,
    assertTrustedSender,
    accountState,
    webviewOwnership,
    getWebContentsById: (guestId) => webContents.fromId(guestId),
    getSessionForPartition: (partition) => session.fromPartition(partition),
  });

  configIpcBoundary = installConfigIpc({
    ipcMain,
    assertTrustedSender,
    store: configStore,
    onCommitted: async (config) => {
      applyLoginItemSettings(config);
      const snapshot = accountState.getSnapshot();
      await proxyRuntime.applyAccounts(snapshot.accounts, config);
      notifyAccountsChanged(snapshot);
    },
  });

  desktopIpcBoundary = installDesktopIpc({
    ipcMain,
    assertTrustedSender,
    app,
    getMainWindow: () => mainWindow,
    platformCatalog: PLATFORM_CATALOG,
    runtimeAssetAllowed,
    resourcesDir: RESOURCES_DIR,
    quitAndInstallForUpdate,
    Notification,
    nativeTheme,
    dialog,
    fs,
  });

  async function waSendFileViaCdp(send, { filePath, chatId, caption }) {
    await send('DOM.enable');
    const created = await send('Runtime.evaluate', { expression: `(() => {
      const i = document.createElement('input');
      i.type = 'file';
      i.id = '__hw_file_input';
      i.style.display = 'none';
      document.body.appendChild(i);
      return !!i;
    })()`, returnByValue: true });
    if (!created.result.value) throw new Error('创建文件输入框失败');
    const doc = await send('DOM.getDocument', { depth: -1 });
    const q = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '#__hw_file_input' });
    const nodeIds = q.nodeIds || [];
    if (!nodeIds.length) throw new Error('找不到文件输入框');
    await send('DOM.setFileInputFiles', { nodeId: nodeIds[0], files: [filePath] });
    const expr = `(async () => {
      try {
        const inp = document.getElementById('__hw_file_input');
        const file = inp && inp.files && inp.files[0];
        if (!file) return 'NO_FILE';
        const W = window.require;
        const wpp = window.WPP || window.WAPLUS_WPP;
        const chatModel = wpp.whatsapp.ChatStore.get(${JSON.stringify(chatId)});
        if (!chatModel) return 'NO_CHAT';
        const mediaData = W('WAWebMediaOpaqueData').createFromData(file, file.type);
        const mime = file.type || '';
        const type = mime.startsWith('image') ? 'image' : mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'document';
        const prepOptions = { isPtt: false, asDocument: type === 'document', asGif: false, isAudio: type === 'audio', asSticker: type === 'sticker', precomputedFields: { duration: null, waveform: null } };
        const preparedMedia = W('WAWebMedia').prepRawMedia(mediaData, prepOptions);
        await preparedMedia.waitForPrep();
        const result = await W('WAWebMediaPrep').sendMediaMsgToChat({
          chat: chatModel,
          options: { addEvenWhilePreparing: false, caption: ${JSON.stringify(caption || '')}, type },
          prep: preparedMedia,
          earlyUpload: null,
        });
        inp.remove();
        return result ? 'SENT' : 'FAIL';
      } catch (e) { return 'ERR:' + e.message; }
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result ? r.result.value : 'EMPTY';
  }

  async function withExternalCdpSend(targetUrl, run) {
    return await new Promise((resolve, reject) => {
      const sock = new WebSocket(targetUrl);
      let nextId = 1;
      const pending = new Map();
      const listeners = new Set();
      sock.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        }
        if (msg.method) {
          for (const handler of listeners) {
            try { handler(msg.method, msg.params); } catch { /* 事件处理器异常不影响命令流 */ }
          }
        }
      });
      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        sock.send(JSON.stringify({ id, method, params }));
      });
      const onEvent = (handler) => { listeners.add(handler); return () => listeners.delete(handler); };
      const connectTimer = setTimeout(() => { try { sock.close(); } catch { /* ignore */ } reject(new Error('CDP 连接超时')); }, 10000);
      sock.addEventListener('open', async () => {
        clearTimeout(connectTimer);
        try {
          const result = await run({ send, onEvent });
          resolve(result);
        } catch (e) { reject(e); }
        finally { sock.close(); listeners.clear(); }
      });
      sock.addEventListener('error', () => { clearTimeout(connectTimer); reject(new Error('CDP 连接失败')); });
    });
  }

  async function externalTargets() {
    return await new Promise((resolve, reject) => {
      const httpMod = require('node:http');
      httpMod.get('http://127.0.0.1:9344/json', (res) => {
        let d = ''; res.on('data', (c) => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }

  function findExternalTarget(targets, platform) {
    const urlMatch = platform === 'whatsapp' ? ('web.whatsapp.com|127.0.0.1:' + WA_LOCAL_PORT)
      : platform === 'line' ? 'chrome-extension'
      : 'web.telegram.org';
    const isTarget = (u) => urlMatch.includes('|') ? (u.includes('web.whatsapp.com') || u.includes(`127.0.0.1:${WA_LOCAL_PORT}`)) : u.includes(urlMatch);
    const target = targets.find((t) => t.type === 'webview' && isTarget(t.url));
    if (!target || !target.webSocketDebuggerUrl) throw new Error('找不到账号页面');
    return target.webSocketDebuggerUrl;
  }

  async function sendBroadcastFile(event, payload) {
    assertTrustedSender(event);
    const { partition, filePath, chatId, caption } = payload || {};
    if (!partition || !filePath || !chatId) throw new Error('参数错误');
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, 'whatsapp');
      return await withExternalCdpSend(wsUrl, ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
    }
    return await internalCdp.run(partition, 'whatsapp', ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
  }

  async function attachFileViaCdp({ send, onEvent }, filePath) {
    await send('Page.enable');
    await send('DOM.enable');
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    const off = onEvent((method, params) => {
      if (method === 'Page.fileChooserOpened' && params && params.backendNodeId) {
        send('DOM.setFileInputFiles', { backendNodeId: params.backendNodeId, files: [filePath] })
          .then(() => console.log('[attach] 文件已喂给选择器'))
          .catch((e) => console.log('[attach] 喂文件失败:', e.message));
      }
    });
    const realClick = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let btn = await send('Runtime.evaluate', { expression: `(() => {
        const b = document.querySelector('[data-testid="plus-rounded"]');
        if (!b) return JSON.stringify({ ok: false });
        const r = b.getBoundingClientRect();
        return JSON.stringify({ ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      })()`, returnByValue: true });
      let bp = JSON.parse(btn.result.value);
      if (!bp.ok) {
        let opened = false;
        for (let attempt = 0; attempt < 6 && !opened; attempt++) {
          const row = await send('Runtime.evaluate', { expression: `(() => {
            const rows = [...document.querySelectorAll('div[role="row"]')];
            const r = rows.find(x => {
              const t = (x.textContent || '').trim();
              const testId = x.getAttribute('data-testid') || '';
              return testId !== 'list-item-0'
                && !/^(所有|未读|特别关注|群组|已归档|收件人)$/.test(t.slice(0, 4))
                && !/wds-ic-whatsapp|Principal|立即发布广告|只有 WhatsApp/.test(t.slice(0, 30));
            });
            if (!r) return JSON.stringify({ ok: false });
            const rc = r.getBoundingClientRect();
            return JSON.stringify({ ok: true, x: Math.round(rc.x + rc.width / 2), y: Math.round(rc.y + rc.height / 2) });
          })()`, returnByValue: true });
          const rp = JSON.parse(row.result.value);
          if (!rp.ok) break;
          await realClick(rp.x, rp.y);
          await sleep(2500);
          const chk = await send('Runtime.evaluate', { expression: `!!document.querySelector('[contenteditable="true"][data-tab="10"]')`, returnByValue: true });
          if (chk.result.value) { opened = true; break; }
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        }
        if (!opened) throw new Error('无法自动打开聊天');
        btn = await send('Runtime.evaluate', { expression: `(() => {
          const b = document.querySelector('[data-testid="plus-rounded"]');
          if (!b) return JSON.stringify({ ok: false });
          const r = b.getBoundingClientRect();
          return JSON.stringify({ ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        })()`, returnByValue: true });
        bp = JSON.parse(btn.result.value);
        if (!bp.ok) throw new Error('聊天打开后仍未找到附件按钮');
      }
      await realClick(bp.x, bp.y);
      await sleep(1200);
      const menu = await send('Runtime.evaluate', { expression: `(() => {
        const items = [...document.querySelectorAll('[role="menuitem"]')];
        const photo = items.find(b => /照片|photo/i.test(b.textContent || ''));
        if (!photo) return JSON.stringify({ ok: false });
        const r = photo.getBoundingClientRect();
        return JSON.stringify({ ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      })()`, returnByValue: true });
      const mp = JSON.parse(menu.result.value);
      if (mp.ok) {
        await realClick(mp.x, mp.y);
        console.log('[attach] 照片菜单已点，等待文件选择器…');
        await sleep(3000);
        return true;
      }
      const doc = await send('DOM.getDocument', { depth: -1 });
      const q = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
      const nodeIds = q.nodeIds || [];
      if (!nodeIds.length) throw new Error('找不到文件输入框');
      await send('DOM.setFileInputFiles', { nodeId: nodeIds[0], files: [filePath] });
      return true;
    } finally {
      off();
    }
  }

  async function attachBroadcastFile(event, payload) {
    assertTrustedSender(event);
    const { partition, filePath, platform } = payload || {};
    if (!partition || !filePath) throw new Error('参数错误');
    const targetPlatform = platform || 'whatsapp';
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, targetPlatform);
      return await withExternalCdpSend(wsUrl, (ctx) => attachFileViaCdp(ctx, filePath));
    }
    return await internalCdp.run(partition, targetPlatform, (ctx) => attachFileViaCdp(ctx, filePath));
  }

  async function dropFileViaCdp({ send }, { filePath, mime, pos, platform, action }) {
    if (platform === 'line' && action === 'send') {
      const point = await send('Runtime.evaluate', {
        expression: `(() => {
          const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');
          const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');
          const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;
          if (!modal || !sendButton) return JSON.stringify({ ok: false, reason: 'NO_FILE_SEND_BUTTON' });
          if (itemCount <= 0) return JSON.stringify({ ok: false, reason: 'LINE_FILE_ITEM_NOT_READY' });
          const rect = sendButton.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return JSON.stringify({ ok: false, reason: 'FILE_SEND_BUTTON_NOT_VISIBLE' });
          return JSON.stringify({ ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
        })()`,
        returnByValue: true
      });
      let state = {};
      try { state = JSON.parse(point?.result?.value || '{}'); } catch { state = {}; }
      if (!state.ok) {
        for (let attempt = 0; attempt < 80; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const retry = await send('Runtime.evaluate', {
            expression: `(() => {
              const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');
              const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');
              const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;
              if (!modal || !sendButton || itemCount <= 0) return JSON.stringify({ ok: false });
              const rect = sendButton.getBoundingClientRect();
              return JSON.stringify({ ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
            })()`,
            returnByValue: true
          });
          try { state = JSON.parse(retry?.result?.value || '{}'); } catch { state = {}; }
          if (state.ok) break;
        }
      }
      if (!state.ok) return state.reason || 'LINE_FILE_ITEM_NOT_READY';
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });
      await send('Runtime.evaluate', { expression: `document.getElementById('__geek_line_file_input')?.remove(); true`, returnByValue: true });
      return 'SEND_CLICK_DISPATCHED';
    }
    if (platform === 'line') {
      const before = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length`,
        returnByValue: true
      });
      const linePastedImageCount = Number(before?.result?.value || 0);
      const prepared = await send('Runtime.evaluate', {
        expression: `(() => {
          let input = document.getElementById('__geek_line_file_input');
          if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = '__geek_line_file_input';
            input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none';
            document.documentElement.appendChild(input);
          }
          input.value = '';
          return true;
        })()`,
        returnByValue: true
      });
      if (prepared?.result?.value !== true) return false;
      const documentNode = await send('DOM.getDocument', { depth: 1, pierce: true });
      const inputNode = await send('DOM.querySelector', {
        nodeId: documentNode?.root?.nodeId,
        selector: '#__geek_line_file_input'
      });
      if (!inputNode?.nodeId) return false;
      await send('DOM.setFileInputFiles', { files: [filePath], nodeId: inputNode.nodeId });
      const pasted = await send('Runtime.evaluate', {
        expression: `(() => {
          const input = document.getElementById('__geek_line_file_input');
          const file = input?.files?.[0];
          const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
          const target = host?.shadowRoot?.querySelector('textarea') || host;
          if (!file || !host || !target) return 'NO_FILE_OR_EDITOR';
          const event = new Event('paste', { bubbles: true, cancelable: true, composed: true });
          Object.defineProperty(event, 'clipboardData', {
            value: { files: input.files, getData: () => '' },
            configurable: true
          });
          target.dispatchEvent(event);
          return 'PASTE_DISPATCHED';
        })()`,
        returnByValue: true
      });
      if (pasted?.result?.value !== 'PASTE_DISPATCHED') return false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const chk = await send('Runtime.evaluate', {
          expression: `(() => {
            const count = document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length;
            return JSON.stringify({ count });
          })()`,
          returnByValue: true
        });
        let state = {};
        try { state = JSON.parse(chk?.result?.value || '{}'); } catch { state = {}; }
        if (Number(state.count || 0) > linePastedImageCount) {
          await send('Runtime.evaluate', { expression: `document.getElementById('__geek_line_file_input')?.remove(); true`, returnByValue: true });
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await send('Runtime.evaluate', { expression: `document.getElementById('__geek_line_file_input')?.remove(); true`, returnByValue: true });
      return 'LINE_PASTED_IMAGE_NOT_READY';
    }
    const dragData = {
      items: [{ mimeType: mime || 'application/octet-stream', data: 'file:///' + filePath.replace(/\\/g, '/') }],
      files: [filePath],
      dragOperationsMask: 1
    };
    await send('Input.dispatchDragEvent', { type: 'dragEnter', x: pos.x, y: pos.y, data: dragData });
    await send('Input.dispatchDragEvent', { type: 'dragOver', x: pos.x, y: pos.y, data: dragData });
    await send('Input.dispatchDragEvent', { type: 'drop', x: pos.x, y: pos.y, data: dragData });
    const chk = await send('Runtime.evaluate', { expression: `(() => {
      const modalBtn = [...document.querySelectorAll('.modal-dialog button, .modal-container button')].find(b => /primary/.test((b.className || '').toString()));
      return modalBtn ? 'MODAL_OK' : 'NO_MODAL';
    })()`, returnByValue: true });
    return chk?.result?.value === 'MODAL_OK';
  }

  async function getDropPos(partition) {
    const wc = webContents.getAllWebContents().find((w) => {
      if (w.isDestroyed()) return false;
      try { return (w.session?.storagePath || '').includes(partition.replace(/^persist:/, '')); } catch (e) { return false; }
    });
    let pos = null;
    if (wc) {
      try {
        const res = await wc.executeJavaScript(`(() => {
          const ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');
          if (!ed) return null;
          const rect = ed.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
        })()`);
        pos = res ? JSON.parse(res) : null;
      } catch (e) { /* ignore */ }
    }
    if (!pos) throw new Error('找不到输入区');
    return pos;
  }

  async function dropBroadcastFile(event, payload) {
    assertTrustedSender(event);
    const { partition, filePath, mime, platform, action, guestId } = payload || {};
    if (!partition || !filePath) throw new Error('参数错误');
    const targetPlatform = platform || 'whatsapp';
    const pos = targetPlatform === 'line' ? { x: 1, y: 1 } : await getDropPos(partition);
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, targetPlatform);
      return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }));
    }
    return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }), targetPlatform === 'line' ? guestId : null);
  }
}

function watchSystemTheme() {
  nativeTheme.on('updated', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theme:system-changed', theme);
    }
  });
}

function configureWebviewSecurity(window) {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.backgroundThrottling = false;
    const partition = String(params.partition || '');
    const source = String(params.src || '');

    const account = accountState.findByPartition(partition);
    const config = account ? platformConfig(account.type) : null;

    let parsedSource;
    try {
      parsedSource = new URL(source);
    } catch {
      event.preventDefault();
      return;
    }

    if (!account || !config) {
      event.preventDefault();
      return;
    }

    if (!isAccountNavigationAllowed(account, partition, parsedSource.href)) {
      event.preventDefault();
      return;
    }

    const globalConfig = configStore.getSnapshot();
    if (!proxyRuntime.isReadyForAccount(account, globalConfig)) {
      diagnostics.log('webview-proxy-not-ready', {
        partition,
        proxyEnabled: account.openProxy === true || globalConfig.openProxy === true
      });
      event.preventDefault();
      return;
    }

    delete webPreferences.preloadURL;
    const isLine = account.type === 'line' || account.type === 'line-business';
    const isWebsite = account.type === 'website';
    if (!isWebsite) {
      const integrityComponent = isLine ? 'lineExtension' : 'bridge';
      if (!runtimeAssetAllowed(integrityComponent)) {
        diagnostics.log('runtime-asset-blocked', { component: isLine ? 'line-extension' : 'bridge' });
        event.preventDefault();
        return;
      }
    }
    if (isLine) {
      webPreferences.preload = path.join(__dirname, '..', 'resources', 's3loYR.js');
      webPreferences.contextIsolation = false;
    } else if (isWebsite) {
      delete webPreferences.preload;
      webPreferences.contextIsolation = true;
    } else {
      webPreferences.preload = path.join(RESOURCES_DIR, 'bridge-preload.cjs');
      webPreferences.contextIsolation = true;
    }

    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.userAgent = CHROME_USER_AGENT;

    params.src = isWebsite ? normalizeWebsiteUrl(account.customUrl) : config.url;
    params.partition = partition;
    params.allowpopups = false;
    if (isLine) {
      const lwKey = Math.random().toString(36).slice(2, 8);
      params.src = `${LINE_EXTENSION_URL}?lw-key=${lwKey}&${Date.now()}`;
    }
    webPreferences.sandbox = true;
    params.webpreferences = isLine
      ? 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false'
      : isWebsite
        ? 'contextIsolation=yes,sandbox=true,nativeWindowOpen=no,spellcheck=no'
        : 'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no';

    if (account.type === 'line' || account.type === 'line-business') {
      loadLineExtension(partition);
    }
  });

  window.webContents.on('did-attach-webview', (_event, webContents) => {
    const part = webContents.session?.partition || '';
    webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      const safeUrl = sanitizeUrlForLog(validatedURL);
      console.log(`[wv] did-fail-load code=${errorCode} desc=${errorDescription} url=${safeUrl}`);
      diagnostics.log('webview-load-failed', {
        partition: part,
        errorCode,
        errorDescription,
        url: safeUrl
      });
    });
    webContents.on('render-process-gone', (_event, details) => {
      diagnostics.log('webview-render-process-gone', {
        partition: part,
        reason: details?.reason,
        exitCode: details?.exitCode
      });
    });
    webContents.on('did-navigate', (event, url) => {
      wppInjected.delete(part);
      console.log(`[wv] did-navigate url=${sanitizeUrlForLog(url)}`);
    });
    webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[wv] did-navigate-in-page url=${sanitizeUrlForLog(url)}`);
    });

    const ownerAccount = accountState.findByPartition(part);
    const ownerIsWhatsApp = ownerAccount?.type === 'whatsapp' || ownerAccount?.type === 'whatsapp-pure';
    webContents.on('did-finish-load', async () => {
      const url = webContents.getURL() || '';
      if (ownerIsWhatsApp && (url.includes('web.whatsapp.com') || url.includes(`127.0.0.1:${WA_LOCAL_PORT}`)) && !wppInjected.has(part)) {
        await injectWppWithRetry(webContents, part);
      }
    });

  async function injectWppWithRetry(wc, part) {
    const readinessProbe = `(async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const W = window.WPP;
        const ready = W?.isReady === true
          && typeof W?.loader?.moduleRequire === 'function'
          && typeof W?.whatsapp?._moduleIdMap?.get === 'function'
          && typeof W?.chat?.sendTextMessage === 'function'
          && typeof W?.chat?.sendFileMessage === 'function'
          && typeof W?.chat?.getActiveChat === 'function'
          && typeof W?.contact?.getPnLidEntry === 'function'
          && typeof W?.group?.getParticipants === 'function'
          && !!W?.whatsapp?.ChatStore
          && !!W?.whatsapp?.UserPrefs;
        if (ready) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    })()`;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');
        await wc.executeJavaScript(wppScript);
        const wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);
        if (!wppReady) {
          console.log(`[wpp] 第 ${attempt + 1} 次注入后 WA-JS 核心兼容面未就绪，3 秒后重试…`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        try {
          const waplusScript = await fs.readFile(path.join(__dirname, '../resources/waplus-wpp.js'), 'utf-8');
          await wc.executeJavaScript(waplusScript);
        } catch (e) {
          console.log('[wpp] WAPLUS 注入失败:', e.message);
        }

        const compatReady = await wc.executeJavaScript(`(() => {
          const primary = window.WPP;
          const fallback = window.WAPLUS_WPP;
          return primary?.isReady === true
            && typeof primary?.chat?.sendTextMessage === 'function'
            && typeof primary?.chat?.sendFileMessage === 'function'
            && typeof primary?.contact?.getPnLidEntry === 'function'
            && typeof primary?.group?.getParticipants === 'function'
            && !!primary?.whatsapp?.ChatStore
            && !!primary?.whatsapp?.UserPrefs
            && typeof fallback?.chat?.sendTextMessage === 'function'
            && typeof fallback?.chat?.sendFileMessage === 'function'
            && typeof fallback?.contact?.getPnLidEntry === 'function'
            && typeof fallback?.group?.getParticipants === 'function'
            && !!fallback?.whatsapp?.ChatStore
            && !!fallback?.whatsapp?.UserPrefs;
        })()`).catch(() => false);
        if (compatReady) {
          wppInjected.add(part);
          console.log('[wpp] WA-JS 4.6 runtime + WAPLUS compatibility boundary ready', part);
          wc.executeJavaScript(`(async () => {
            for (let i = 0; i < 10; i++) {
              const arrow = document.querySelector('.bulk-sender .el-icon-arrow-left');
              if (arrow) { arrow.click(); return 'COLLAPSED'; }
              await new Promise(r => setTimeout(r, 800));
            }
            return 'NO_ARROW';
          })()`).catch(() => null);
          return;
        }
        console.log(`[wpp] 第 ${attempt + 1} 次注入后兼容边界未就绪，3 秒后重试…`);
      } catch (e) {
        console.log('[wpp] 注入异常:', e.message);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log('[wpp] 注入失败（5 次重试后仍不可用）', part);
  }

  });
}

let subscriptionWindow = null;
let subscriptionStore = null;
let subscriptionCheckDone = false;
let subscriptionIpcBoundary = null;

function initSubscriptionStore() {
  if (!subscriptionStore) {
    subscriptionStore = createSubscriptionStore({ userDataDir: USER_DATA_DIR });
    try {
      subscriptionStore._injectCrypto({
        encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
        decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
      });
    } catch (e) { console.error('[subscription] 安全存储注入失败:', e.message); }
  }
  return subscriptionStore;
}

function isSubscriptionSender(event) {
  return subscriptionWindow && !subscriptionWindow.isDestroyed() && event.sender.id === subscriptionWindow.webContents.id;
}

function isTrustedSubscriptionSender(event) {
  return isTrustedSender(event) || isSubscriptionSender(event);
}

function createSubscriptionWindow() {
  if (subscriptionWindow && !subscriptionWindow.isDestroyed()) {
    subscriptionWindow.show();
    subscriptionWindow.focus();
    return subscriptionWindow;
  }
  subscriptionWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 780,
    minHeight: 540,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#0d0f12',
    title: '极客 · 登录',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  subscriptionWindow.once('ready-to-show', () => subscriptionWindow.show());
  subscriptionWindow.on('closed', () => { subscriptionWindow = null; });
  subscriptionWindow.loadFile(path.join(__dirname, '../ui/subscription.html'));
  return subscriptionWindow;
}

async function enforceSubscriptionGate() {
  if (subscriptionCheckDone) return;
  subscriptionCheckDone = true;
  try {
    const store = initSubscriptionStore();
    const local = await store.getState();
    if (local.loggedIn) {
      createMainWindow();
      store.refresh().catch(() => {});
      return;
    }
    createSubscriptionWindow();
  } catch (e) {
    console.error('[subscription] 启动门禁检查失败（放行）:', e.message);
    createMainWindow();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: true,
    frame: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#111318',
    title: '极客',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true
    }
  });

  configureWebviewSecurity(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.log('main-window-crash', { reason: details?.reason, exitCode: details?.exitCode });
    if (isUpdateInstalling()) {
      console.error('[crash] 更新安装中，跳过自动重启（避免与 quitAndInstall 竞态）');
      return;
    }
    if (relaunchLimiter.allow()) {
      console.error('[crash] 主窗口渲染进程崩溃，5分钟内限频2次内自动重启');
      Promise.all([accountState.whenIdle(), configStore.whenIdle()]).catch(() => {}).finally(() => {
        setTimeout(() => {
          try { app.relaunch(); app.exit(0); } catch (e) { console.error('[crash] 自动重启失败:', e.message); }
        }, 500);
      });
    } else {
      console.error('[crash] 主窗口崩溃超限，停止自动重启，请手动启动');
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url);
    const localIndex = new URL(`file://${path.join(__dirname, '../ui/index.html')}`);
    if (destination.protocol !== 'file:' || destination.pathname !== localIndex.pathname) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
}

let tray = null;
let isQuitting = false;

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('极客');

    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      { label: '锁屏', click: () => {
          showMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tray:lock');
      } },
      { type: 'separator' },
      { label: '一键重启', click: () => {
          isQuitting = true;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
          app.relaunch();
          app.exit(0);
      } },
      { label: '退出', click: () => {
          isQuitting = true;
          app.quit();
      } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else showMainWindow();
    });
  } catch (e) {
    console.error('[tray] 创建托盘失败:', e.message);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

try {
  app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
  app.commandLine.appendSwitch('dns-over-https-templates', 'https://dns.google/dns-query https://cloudflare-dns.com/dns-query');
  app.commandLine.appendSwitch('lang', 'zh-CN');
} catch (e) { /* 忽略 */ }

async function startWaLocalServer() {
  try {
    const httpMod = require('node:http');
    const waHtml = await fs.readFile(path.join(__dirname, '../resources/wa/index.html'), 'utf-8');
    const server = httpMod.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(waHtml);
    });
    server.listen(WA_LOCAL_PORT, '127.0.0.1', () => {
      console.log(`[wa-local] WhatsApp 本地页面 http://127.0.0.1:${WA_LOCAL_PORT}`);
    });
    server.on('error', (e) => console.log('[wa-local] 端口占用（HelloWorld 也在用？）:', e.code));
  } catch (e) { console.log('[wa-local] 启动失败:', e.message); }
}

async function cleanupOrphanPartitions() {
  try {
    const snapshot = accountState.getSnapshot();
    const partitionRoot = path.join(USER_DATA_DIR, 'Partitions');
    let entries;
    try { entries = await fs.readdir(partitionRoot); } catch { return; }
    const activePartitions = snapshot.accounts.map((account) => account.partition);
    const orphans = collectOrphanPartitions({ entries, activePartitions });
    if (!orphans.length) return;
    for (const name of orphans) {
      const dir = path.join(partitionRoot, name);
      if (pendingPartitionDeletions.has(dir)) continue;
      try {
        await fs.rm(dir, { recursive: true, force: true });
        diagnostics.log('orphan-partition-removed', { partition: name });
      } catch (e) {
        pendingPartitionDeletions.add(dir);
        console.error('[cleanup] 孤儿分区删除失败（退出时兜底）:', name, e.message);
      }
    }
  } catch (e) {
    console.error('[cleanup] 孤儿分区清理失败（不影响启动）:', e.message);
  }
}

app.whenReady().then(async () => {
  await runStartupAclRepair({
    shouldRun: app.isPackaged && process.platform === 'win32',
    userDataDir: USER_DATA_DIR,
    expectedUserDataDir: app.getPath('userData'),
    username: resolveUsername(process.env.USERNAME)
  });
  diagnostics.log('app-ready', { packaged: app.isPackaged, version: app.getVersion() });
  await verifyPackagedUnpackedAssets();
  await probeExternalDebugging();
  diagnostics.log('cdp-mode', { externalDebugging: externalDebuggingActive });
  try {
    await runtimePaths.migrateRuntimeFiles({
      userDataDir: USER_DATA_DIR,
      projectRoot: path.join(__dirname, '..')
    });
  } catch (e) {
    console.error('迁移历史运行数据失败（不影响启动）:', e.message);
  }
  await accountState.load();
  await configStore.load();
  proxyRuntime.installAuthenticationHandler();
  await proxyRuntime.applyAccounts(accountState.getSnapshot().accounts, configStore.getSnapshot());
  applyLoginItemSettings(configStore.getSnapshot());
  registerIpcHandlers();
  subscriptionIpcBoundary = installSubscriptionIpc({
    ipcMain,
    isTrustedSender: isTrustedSubscriptionSender,
    getStore: initSubscriptionStore,
    enterApp: async () => {
      if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
      else mainWindow.show();
      return { ok: true };
    },
    closeWindow: async () => {
      if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
      if (!mainWindow || mainWindow.isDestroyed()) { isQuitting = true; app.quit(); }
      return { ok: true };
    },
  });
  await enforceSubscriptionGate();
  createTray();
  initAutoUpdater();
  watchSystemTheme();
  setTimeout(() => { cleanupOrphanPartitions().catch(() => {}); }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) enforceSubscriptionGate();
  });

  app.on('will-quit', () => {
    diagnostics.log('app-will-quit', {});
    const cleanup = cleanupPendingPartitions(pendingPartitionDeletions);
    diagnostics.log('pending-partition-exit-cleanup', {
      attempted: cleanup.attempted,
      removed: cleanup.removed,
      failed: cleanup.failed
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('child-process-gone', (_event, details) => {
  diagnostics.log('child-process-gone', {
    type: details?.type,
    reason: details?.reason,
    exitCode: details?.exitCode,
    name: details?.name
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  accountIpcBoundary?.dispose();
  accountIpcBoundary = null;
  configIpcBoundary?.dispose();
  configIpcBoundary = null;
  translationRuntime?.dispose();
  translationRuntime = null;
  subscriptionIpcBoundary?.dispose();
  subscriptionIpcBoundary = null;
  webviewIpcBoundary?.dispose();
  webviewIpcBoundary = null;
  desktopIpcBoundary?.dispose();
  desktopIpcBoundary = null;
});
