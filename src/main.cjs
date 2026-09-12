'use strict';

const { app, BrowserWindow, dialog, ipcMain, session, Notification, nativeTheme, webContents, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const nodeFs = require('node:fs');
const fs = nodeFs.promises;
const crypto = require('node:crypto');
const { initAutoUpdater } = require('./updater.cjs');
const { quitAndInstallForUpdate, isUpdateInstalling } = require('./updater.cjs');
const { createOwnershipRegistry } = require('./webview-ownership.cjs');
const webviewOwnership = createOwnershipRegistry();
const runtimePaths = require('./runtime-paths.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const { createInternalCdp } = require('./internal-cdp.cjs');
const { createRateLimiter } = require('./crash-recovery.cjs');
const { createGatewayPool } = require('./gateway-failover.cjs');
const { collectOrphanPartitions } = require('./partition-cleanup.cjs');
const { createSubscriptionStore } = require('./subscription.cjs');
const { runStartupAclRepair, resolveUsername } = require('./acl-repair.cjs');
const { verifyRuntimeIntegrity } = require('./unpacked-integrity.cjs');
const { cleanupPendingPartitions } = require('./exit-partition-cleanup.cjs');
const { sanitizeUrlForLog } = require('./log-url.cjs');
const { assertSafeTranslationOutput } = require('./translation-output-safety.cjs');
const { normalizeWebsiteUrl } = require('./website-url.cjs');
const { LINE_EXTENSION_ID, LINE_EXTENSION_URL, WA_LOCAL_PORT, WA_LOCAL_URL, WA_WEB_URL, PLATFORM_CATALOG, platformConfig } = require('./platform-catalog.cjs');
const { isAccountNavigationAllowed } = require('./webview-navigation-boundary.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { installAccountIpc } = require('./account-ipc.cjs');
const { createAccountStateStore, ACCOUNT_PARTITION_PREFIX } = require('./account-state.cjs');
const { createConfigStateStore } = require('./config-state.cjs');
const { installConfigIpc } = require('./config-ipc.cjs');
const { ACCOUNT_DATA_KEYS } = require('./account-data-store.cjs');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('./broadcast-account-data-keys.cjs');
const { installBroadcastFileBoundary } = require('./broadcast-files.cjs');
const { installScheduledBroadcastAttachmentBoundary } = require('./scheduled-broadcast-attachment-boundary.cjs');
const { createTelegramNativeAttachmentHandler } = require('./telegram-native-attachments.cjs');
const { externalDebuggingRequested } = require('./external-debugging-policy.cjs');
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

// LINE 登录 token 宿主文件备份（对齐原版 line.json 机制：登出清 localStorage 也不丢）
// 敏感数据：token 用 safeStorage(DPAPI) 加密落盘，防止木马直接读明文
const LINE_TOKENS_FILE = () => path.join(app.getPath('userData'), 'line-tokens.json');
let lineTokensCache = {}; // partition -> token JSON 字符串
const lineGuestContents = new Map(); // partition -> LINE guest webContents（token 备份用）
const wppInjected = new Set(); // 已注入 WPP 的 partition（WA 内部 API 直发）
const pendingPartitionDeletions = new Set(); // 删除失败的分区目录，退出时兜底清理
function lineTokenEncrypt(text) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，拒绝明文保存 LINE token');
  return 'enc:' + safeStorage.encryptString(String(text)).toString('base64');
}
function lineTokenDecrypt(value) {
  if (typeof value === 'string' && value.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')); } catch { return ''; }
  }
  return value;
}
async function writeLineTokensEncrypted(values) {
  const encrypted = {};
  for (const [key, value] of Object.entries(values)) encrypted[key] = lineTokenEncrypt(value);
  const target = LINE_TOKENS_FILE();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(encrypted), 'utf-8');
  await fs.rename(temporary, target);
}
async function loadLineTokens() {
  try {
    const raw = await fs.readFile(LINE_TOKENS_FILE(), 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    let needsMigrate = false;
    // 兼容旧版明文：解密 enc: 前缀字段
    for (const [k, v] of Object.entries(parsed)) {
      lineTokensCache[k] = lineTokenDecrypt(v);
      if (typeof v === 'string' && !v.startsWith('enc:')) needsMigrate = true;
    }
    // 安全迁移：旧明文 token 立即加密重写（防止明文长期滞留磁盘）
    if (needsMigrate) {
      try {
        await writeLineTokensEncrypted(lineTokensCache);
      } catch (error) {
        console.error('[security] LINE token 明文迁移失败，保留原文件且本次不写新明文:', error.message);
      }
    }
  } catch { lineTokensCache = {}; }
}
async function saveLineToken(partition, tokenJson) {
  if (!tokenJson) return;
  lineTokensCache[partition] = tokenJson;
  try {
    await writeLineTokensEncrypted(lineTokensCache);
  } catch (e) { /* 写失败不影响 */ }
}

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

function proxyRulesFor(config) {
  if (!config || !config.openProxy) return null;
  const host = String(config.host || '').trim();
  const port = String(config.port || '').trim();
  if (!host || !port) return null;
  const protocal = config.protocal === 'https' || config.protocal === 'socks4' || config.protocal === 'socks5'
    ? config.protocal
    : 'http';
  const login = String(config.login || config.huser || '').trim();
  const password = String(config.password || config.hpwd || '');
  const auth = login ? `${encodeURIComponent(login)}:${encodeURIComponent(password)}@` : '';
  const base = `${auth}${host}:${port}`;
  if (protocal === 'http') return `http=${base};https=${base}`;
  if (protocal === 'https') return `https=${base}`;
  return `${protocal}://${base}`;
}

async function applyProxyForPartition(partition, config) {
  try {
    const ses = session.fromPartition(partition, { cache: true });
    const rules = proxyRulesFor(config);
    if (!rules) {
      await ses.setProxy({ mode: 'direct' });
      return;
    }
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: rules,
      proxyBypassRules: '<local>'
    });
  } catch (error) {
    console.error(`应用代理失败 (${partition}):`, error.message);
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

  deletedTranslationPartitions.add(removedAccount.partition);
  translationCaches.delete(removedAccount.partition);
  translationCacheLoaded.delete(removedAccount.partition);
  translationCacheWrites.delete(removedAccount.partition);
  for (const key of translationLatestRequest.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationLatestRequest.delete(key);
  for (const key of translationInflight.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationInflight.delete(key);

  try {
    const guests = webContents.getAllWebContents().filter(
      (wc) => wc.session?.partition === removedAccount.partition
    );
    for (const wc of guests) {
      if (!wc.isDestroyed()) wc.destroy();
    }
  } catch (e) { /* 销毁失败不影响 */ }

  const accountSession = session.fromPartition(removedAccount.partition, { cache: true });
  try {
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
    await accountSession.clearHostResolverCache();
    await accountSession.flushStorageData();
    try {
      const dirName = removedAccount.partition.replace(/^persist:/, '');
      const partDir = path.join(app.getPath('userData'), 'Partitions', dirName);
      let removed = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rm(partDir, { recursive: true, force: true });
          removed = true;
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
      pendingPartitionDeletions.add(path.join(app.getPath('userData'), 'Partitions', removedAccount.partition.replace(/^persist:/, '')));
      console.error(`删除账号分区目录失败 (${removedAccount.partition}):`, dirError.message);
    }
  } catch (error) {
    console.error(`清理账号 ${accountId} 的会话数据失败:`, error);
    throw new Error('账号已删除，但登录数据清理失败');
  } finally {
    notifyAccountsChanged(result.snapshot);
  }

  return publicState(result.snapshot);
}

const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2';
const translationCaches = new Map();
const translationCacheLoaded = new Set();
const deletedTranslationPartitions = new Set();
const translationInflight = new Map();
const translationCacheWrites = new Map();
const translationLatestRequest = new Map();
let translationRequestSequence = 0;

function translationCacheFile(partition) {
  const dirName = String(partition || '').replace(/^persist:/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) throw new Error('账号沙箱不合法');
  return path.join(app.getPath('userData'), 'Partitions', dirName, 'geek-translation-cache.jsonl');
}
function translationCacheKey(body, text, target) {
  return crypto.createHash('sha256').update(JSON.stringify({ version: TRANSLATION_CACHE_VERSION, text, source: body.source || 'auto', target, provider: body.provider || 'auto', route: body.route || 'default' })).digest('hex');
}
async function loadTranslationCache(partition) {
  if (!translationCaches.has(partition)) translationCaches.set(partition, new Map());
  const cache = translationCaches.get(partition);
  if (translationCacheLoaded.has(partition)) return cache;
  translationCacheLoaded.add(partition);
  if (!safeStorage.isEncryptionAvailable()) return cache;
  try {
    const lines = (await fs.readFile(translationCacheFile(partition), 'utf-8')).split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.version !== TRANSLATION_CACHE_VERSION || !item.key || !item.value) continue;
        cache.set(item.key, { text: safeStorage.decryptString(Buffer.from(item.value, 'base64')), at: Number(item.at) || 0 });
      } catch {}
    }
  } catch {}
  return cache;
}
async function appendTranslationCache(partition, key, item) {
  if (deletedTranslationPartitions.has(partition) || !safeStorage.isEncryptionAvailable()) return;
  const file = translationCacheFile(partition);
  const record = { version: TRANSLATION_CACHE_VERSION, key, at: item.at, value: safeStorage.encryptString(item.text).toString('base64') };
  const previous = translationCacheWrites.get(partition) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => { if (deletedTranslationPartitions.has(partition)) return; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf-8'); });
  translationCacheWrites.set(partition, write);
  try { await write; } catch {} finally { if (translationCacheWrites.get(partition) === write) translationCacheWrites.delete(partition); }
}

function resolveAccountPartition(accountId) {
  return accountState.resolvePartition(accountId);
}

function translationGatewayEndpoints() {
  const configured = String(process.env.GEEK_TRANSLATION_GATEWAY_URL || '').trim();
  const list = configured
    ? configured.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
    : [];
  const endpoints = list.length ? list : ['https://geek-translate.9529360.workers.dev'];
  if (!endpoints.length) throw new Error('远程翻译服务尚未配置');
  for (const endpoint of endpoints) {
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new Error('翻译服务配置不安全'); }
    const allowedLocal = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
    const allowedHttps = parsed.protocol === 'https:';
    if (!allowedLocal && !allowedHttps) throw new Error('翻译服务配置不安全');
    if (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535)) throw new Error('翻译服务配置不安全');
  }
  return endpoints;
}

let translationGatewayPool = null;
function getTranslationGatewayPool() {
  if (!translationGatewayPool) {
    translationGatewayPool = createGatewayPool({
      endpoints: translationGatewayEndpoints(),
      healthFetch: async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return { ok: false };
          const data = await response.json().catch(() => ({}));
          return { ok: data.ok !== false };
        } finally { clearTimeout(timer); }
      }
    });
  }
  return translationGatewayPool;
}

async function checkTranslationGateway(event) {
  assertTrustedSender(event);
  const pool = getTranslationGatewayPool();
  const health = await pool.healthCheckAll();
  const okCount = Object.values(health).filter(Boolean).length;
  return { ok: okCount > 0, models: okCount, endpointCount: Object.keys(health).length };
}

const translationRemoteQueue = [];
let translationRemoteActive = 0;
const TRANSLATION_REMOTE_LIMIT = 20;
function enqueueTranslationRemote(task) {
  return new Promise((resolve, reject) => {
    translationRemoteQueue.push({ task, resolve, reject });
    drainTranslationRemoteQueue();
  });
}
function drainTranslationRemoteQueue() {
  while (translationRemoteActive < TRANSLATION_REMOTE_LIMIT && translationRemoteQueue.length) {
    const item = translationRemoteQueue.shift();
    translationRemoteActive++;
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
      translationRemoteActive--;
      drainTranslationRemoteQueue();
    });
  }
}

async function translateViaRemoteGateway(event, payload) {
  assertTrustedSender(event);
  const body = payload && typeof payload === 'object' ? payload : {};
  const pool = getTranslationGatewayPool();
  const text = String(body.text || '');
  const target = String(body.target || '').toLowerCase();
  if (!text.trim()) throw new Error('翻译内容不能为空');
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(target) || target === 'auto') throw new Error('目标语言不合法');
  const accountId = String(body.accountId || '');
  assertValidAccountId(accountId);
  const account = accountState.findById(accountId);
  if (!account?.partition) throw new Error('翻译账号沙箱不存在');
  const partition = account.partition;
  const cache = await loadTranslationCache(partition);
  const key = translationCacheKey(body, text, target);
  const inflightKey = `${partition}:${key}`;
  if (body.refresh !== true) {
    const cached = cache.get(key);
    if (cached) {
      try {
        const safeCachedText = assertSafeTranslationOutput({ source: text, output: cached.text, target });
        return { text: safeCachedText, source: body.source || 'auto', target, cached: true };
      } catch {
        cache.delete(key);
      }
    }
    if (body.isHistory === true && body.translateHistory !== true) return { text: '', source: body.source || 'auto', target, cached: false, skipped: true, history: true };
    if (translationInflight.has(inflightKey)) return translationInflight.get(inflightKey);
  }
  if (body.skipQuota !== true) {
    const sub = initSubscriptionStore();
    const quota = await sub.getQuota({ network: false }).catch(() => ({ remaining_chars: null }));
    if (quota.remaining_chars != null && quota.remaining_chars <= 0) {
      const error = new Error('翻译额度已用完，请前往个人中心开通');
      error.code = 'QUOTA_EXHAUSTED';
      throw error;
    }
  }
  const requestSequence = ++translationRequestSequence;
  const needsRemoteAuthorization = pool.endpoints.some((endpoint) => {
    const parsed = new URL(endpoint);
    return !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
  });
  const remoteAuthorization = needsRemoteAuthorization ? await initSubscriptionStore().getTranslationToken() : '';
  const translationRequestId = crypto.randomUUID();
  translationLatestRequest.set(inflightKey, requestSequence);
  const request = enqueueTranslationRemote(async () => {
    let lastError = null;
    const attempts = Math.max(1, pool.endpoints.length);
    const deadline = Date.now() + 30000;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { lastError = lastError || new Error('翻译网关请求超时'); break; }
      const picked = pool.pick();
      const endpoint = picked.endpoint;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        const parsedEndpoint = new URL(endpoint);
        const isLocalGateway = parsedEndpoint.protocol === 'http:' && parsedEndpoint.hostname === '127.0.0.1';
        const headers = { 'Content-Type': 'application/json', 'X-Geek-Client': '1', 'X-Request-ID': translationRequestId };
        if (!isLocalGateway) headers.Authorization = `Bearer ${remoteAuthorization}`;
        const response = await fetch(`${endpoint}/v1/translate`, { method: 'POST', headers, body: JSON.stringify({ text, source: body.source || 'auto', target, provider: body.provider || 'auto', route: body.route || picked.route }), signal: controller.signal });
        const raw = await response.text();
        let result; try { result = JSON.parse(raw); } catch { result = {}; }
        if (!response.ok) { pool.reportFailure(endpoint); lastError = new Error(String(result.error || `翻译网关错误 ${response.status}`).slice(0, 300)); continue; }
        if (!result.text || typeof result.text !== 'string') { pool.reportFailure(endpoint); lastError = new Error('翻译网关返回格式错误'); continue; }
        let translated;
        try {
          translated = assertSafeTranslationOutput({ source: text, output: result.text, target });
        } catch (error) {
          pool.reportFailure(endpoint);
          lastError = error;
          continue;
        }
        pool.reportSuccess(endpoint);
        if (deletedTranslationPartitions.has(partition)) throw new Error('翻译账号已删除');
        if (translationLatestRequest.get(inflightKey) !== requestSequence) return { text: translated, source: result.source || body.source || 'auto', target: result.target || target, cached: false, superseded: true, route: picked.route };
        const item = { text: translated, at: Date.now() };
        cache.set(key, item);
        await appendTranslationCache(partition, key, item);
        return { text: translated, source: result.source || body.source || 'auto', target: result.target || target, cached: false, route: picked.route };
      } catch (error) {
        pool.reportFailure(endpoint);
        if (error?.name === 'AbortError') lastError = new Error('翻译网关请求超时');
        else if (error?.message === '翻译账号已删除') { lastError = error; break; }
        else lastError = error;
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('翻译网关不可用');
  });
  translationInflight.set(inflightKey, request);
  try { return await request; } finally { if (translationInflight.get(inflightKey) === request) translationInflight.delete(inflightKey); }
}

let accountIpcBoundary = null;
let configIpcBoundary = null;

async function updateAccount(event, accountId, patchData) {
  assertTrustedSender(event);
  const result = await accountState.update(accountId, patchData);
  const account = result.account;
  const globalConfig = configStore.getSnapshot();
  await applyProxyForPartition(
    account.partition,
    account.openProxy ? account : (globalConfig.openProxy ? globalConfig : null)
  );
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
  ipcMain.handle('translation:translate', translateViaRemoteGateway);
  ipcMain.handle('webview:register', async (event, accountId, guestId, token) => {
    assertTrustedSender(event);
    const partition = resolveAccountPartition(accountId);
    const account = accountState.findById(accountId);
    const guest = webContents.fromId(Number(guestId));
    const guestUrl = guest?.getURL?.() || '';
    const isTelegram = ['telegram-z', 'telegram', 'telegram-pure', 'telegram-k'].includes(account?.type);
    const isLine = account?.type === 'line' || account?.type === 'line-business';
    const allowedPage = (isTelegram && /^https:\/\/web\.telegram\.org\//.test(guestUrl))
      || (isLine && /^chrome-extension:\/\/ophjlpahpchlmihnnnihgmmeilfjmjjc\//.test(guestUrl));
    if (!account || !guest || guest === event.sender || guest.hostWebContents !== event.sender || guest.session !== session.fromPartition(partition) || !allowedPage) throw new Error('WebView登记失败');
    webviewOwnership.register({ guestId: guest.id, accountId, partition, token, senderId: event.sender.id });
    guest.once('destroyed', () => webviewOwnership.remove(guest.id));
    return true;
  });
  ipcMain.handle('webview:insert-text', async (event, accountId, guestId, text, token) => {
    assertTrustedSender(event);
    const partition = resolveAccountPartition(accountId);
    const value = String(text ?? '');
    if (!value || value.length > 10000) throw new Error('输入文本不合法');
    const guest = webContents.fromId(Number(guestId));
    const guestUrl = guest?.getURL?.() || '';
    const allowedInputPage = /^https:\/\/web\.telegram\.org\//.test(guestUrl) || /^chrome-extension:\/\/ophjlpahpchlmihnnnihgmmeilfjmjjc\//.test(guestUrl);
    const ownershipOk = webviewOwnership.authorize({ guestId, accountId, partition, token, senderId: event.sender.id });
    if (!guest || guest === event.sender || guest.session !== session.fromPartition(partition) || !allowedInputPage || !ownershipOk || typeof guest.insertText !== 'function') throw new Error('账号输入页面不可用');
    const focusedComposer = await guest.executeJavaScript(`(() => {
      if (/^https:\\/\\/web\\.telegram\\.org\\//.test(location.href)) {
        const editor = document.querySelector('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"]');
        return !!editor && (document.activeElement === editor || editor.contains(document.activeElement));
      }
      if (/^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(location.href)) {
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        return /#\\/chats\\/[^/?#]+/.test(location.hash) && !!textarea && (document.activeElement === host || host.shadowRoot?.activeElement === textarea);
      }
      return false;
    })()`);
    if (!focusedComposer) throw new Error('消息输入框未获得焦点');
    await guest.insertText(value);
    return true;
  });
  ipcMain.handle('translation:health', checkTranslationGateway);
  ipcMain.handle('app:get-version', async (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });
  ipcMain.handle('platforms:list', async (event) => {
    assertTrustedSender(event);
    return Object.entries(PLATFORM_CATALOG).map(([type, cfg]) => ({
      type,
      name: cfg.name,
      short: cfg.short || type.slice(0, 2).toUpperCase(),
      needsExtension: !!cfg.needsExtension,
      isWebsite: type === 'website'
    }));
  });

  ipcMain.handle('bridge:get-preload-path', async (event) => {
    assertTrustedSender(event);
    if (!runtimeAssetAllowed('bridge')) throw new Error('翻译桥完整性校验失败，已阻止加载');
    const { pathToFileURL } = require('node:url');
    return pathToFileURL(path.join(RESOURCES_DIR, 'bridge-preload.cjs')).href;
  });

  configIpcBoundary = installConfigIpc({
    ipcMain,
    assertTrustedSender,
    store: configStore,
    onCommitted: async (config) => {
      applyLoginItemSettings(config);
      const globalProxy = config.openProxy ? config : null;
      const snapshot = accountState.getSnapshot();
      await Promise.all(
        snapshot.accounts.map((account) =>
          applyProxyForPartition(
            account.partition,
            account.openProxy ? account : globalProxy
          )
        )
      );
      notifyAccountsChanged(snapshot);
    },
  });

  ipcMain.handle('window:relaunch', async (event) => {
    assertTrustedSender(event);
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('updater:install', async (event) => {
    assertTrustedSender(event);
    return quitAndInstallForUpdate();
  });

  ipcMain.handle('window:minimize', async (event) => {
    assertTrustedSender(event);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', async (event) => {
    assertTrustedSender(event);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', async (event) => {
    assertTrustedSender(event);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle('notify:show', async (event, payload) => {
    assertTrustedSender(event);
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: String(payload?.title || '新消息'),
        body: String(payload?.body || ''),
        silent: false,
        timeoutType: 'default'
      });
      n.show();
    } catch (e) {
      console.error('[notify] 失败', e.message);
    }
  });

  ipcMain.handle('theme:get-system', async (event) => {
    assertTrustedSender(event);
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
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
        const wpp = window.WAPLUS_WPP || window.WPP;
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
  ipcMain.handle('file:save', async (event, payload) => {
    assertTrustedSender(event);
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: payload?.defaultName || '导出.csv',
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, payload?.content || '', 'utf-8');
    return result.filePath;
  });
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

    const globalConfig = configStore.getSnapshot();
    const accountProxy = account.openProxy
      ? account
      : globalConfig.openProxy
        ? globalConfig
        : null;
    applyProxyForPartition(partition, accountProxy);

    if (account.type === 'line' || account.type === 'line-business') {
      loadLineExtension(partition);
    }
  });

  window.webContents.on('did-attach-webview', (_event, webContents) => {
    const part = webContents.session?.partition || '';
    if (part.startsWith(PARTITION_PREFIX)) {
      webContents.on('did-navigate', (event, url) => {
        if (url.startsWith(`chrome-extension://${LINE_EXTENSION_ID}`)) {
          lineGuestContents.set(part, webContents);
        }
      });
    }
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
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');
        await wc.executeJavaScript(wppScript).catch(() => null);
        try {
          const waplusScript = await fs.readFile(path.join(__dirname, '../resources/waplus-wpp.js'), 'utf-8');
          await wc.executeJavaScript(waplusScript).catch(() => null);
        } catch (e) { console.log('[wpp] WAPLUS 注入失败:', e.message); }
        const ok = await wc.executeJavaScript('!!(window.WPP && window.WAPLUS_WPP && window.WAPLUS_WPP.chat && window.WAPLUS_WPP.chat.sendTextMessage)').catch(() => false);
        if (ok) {
          wppInjected.add(part);
          console.log('[wpp] 注入成功', part);
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
        console.log(`[wpp] 第 ${attempt + 1} 次注入后 WPP 未就绪，3 秒后重试…`);
      } catch (e) { console.log('[wpp] 注入异常:', e.message); }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log('[wpp] 注入失败（5 次重试后仍不可用）', part);
  }

  });
}

let subscriptionWindow = null;
let subscriptionStore = null;
let subscriptionCheckDone = false;

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

function registerSubscriptionIpcHandlers() {
  ipcMain.handle('subscription:get-state', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().getState();
  });
  ipcMain.handle('subscription:refresh', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().refresh();
  });
  ipcMain.handle('subscription:login', async (event, email, password) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().login(String(email || ''), String(password || ''));
  });
  ipcMain.handle('subscription:register', async (event, email, password) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().register(String(email || ''), String(password || ''));
  });
  ipcMain.handle('subscription:create-order', async (event, plan) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().createOrder(String(plan || ''));
  });
  ipcMain.handle('subscription:get-quota', async (event, force) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().getQuota(force === true);
  });
  ipcMain.handle('subscription:report-usage', async (event, chars) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().reportUsage(Number(chars) || 0);
  });
  ipcMain.handle('subscription:logout', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    return initSubscriptionStore().logout();
  });
  ipcMain.handle('subscription:enter-app', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.show();
    return { ok: true };
  });
  ipcMain.handle('subscription:close-window', async (event) => {
    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');
    if (subscriptionWindow && !subscriptionWindow.isDestroyed()) subscriptionWindow.close();
    if (!mainWindow || mainWindow.isDestroyed()) { isQuitting = true; app.quit(); }
    return { ok: true };
  });
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
    if (!snapshot.accounts.length) return;
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
  applyLoginItemSettings(configStore.getSnapshot());
  registerIpcHandlers();
  registerSubscriptionIpcHandlers();
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
  ipcMain.removeHandler('window:relaunch');
  ipcMain.removeHandler('subscription:get-state');
  ipcMain.removeHandler('subscription:refresh');
  ipcMain.removeHandler('subscription:login');
  ipcMain.removeHandler('subscription:register');
  ipcMain.removeHandler('subscription:create-order');
  ipcMain.removeHandler('subscription:logout');
  ipcMain.removeHandler('subscription:enter-app');
  ipcMain.removeHandler('subscription:close-window');
});
