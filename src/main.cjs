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
const { normalizeWebsiteUrl, parseWebsiteUrl } = require('./website-url.cjs');
const { installAccountDataBoundary } = require('./account-data-boundary.cjs');
const { installAccountIpc } = require('./account-ipc.cjs');
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
const ACCOUNTS_FILE = runtimePaths.accountsFile(USER_DATA_DIR);
const CONFIG_FILE = runtimePaths.configFile(USER_DATA_DIR);
const PARTITION_PREFIX = 'persist:webview-page-';
// Ordinary Chrome UA so WhatsApp/Telegram Web don't reject the embedded browser.
// Same UA family the original Hello-GPT ships (verified working with WhatsApp Web).
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36';

// LINE 官方扩展 ID 与页面（原版方案：Line 聊天窗跑在扩展自身页面里）
const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const LINE_EXTENSION_URL = `chrome-extension://${LINE_EXTENSION_ID}/index.html`;

// WhatsApp 启动页使用当前官方 Web，避免冻结快照与在线静态资源失配。
// 旧本地快照仅保留历史兼容参考，不再作为产品启动入口。
const WA_LOCAL_PORT = 1843;
const WA_LOCAL_URL = `http://127.0.0.1:${WA_LOCAL_PORT}/`;
const WA_WEB_URL = 'https://web.whatsapp.com/';

const APP_TYPES = {
  whatsapp: {
    name: 'WhatsApp',
    short: 'WA',
    url: WA_WEB_URL,
    hostnames: ['web.whatsapp.com'],
    allowSuffix: '.whatsapp.com'
  },
  'whatsapp-pure': {
    name: 'WhatsApp 纯净版',
    short: 'WAP',
    url: WA_WEB_URL,
    hostnames: ['web.whatsapp.com'],
    allowSuffix: '.whatsapp.com'
  },
  'telegram-z': {
    name: 'TelegramZ',
    short: 'TGZ',
    url: 'https://web.telegram.org/a',
    hostnames: ['web.telegram.org'],
    allowSuffix: '.telegram.org'
  },
  'telegram-k': {
    name: 'TelegramK',
    short: 'TGK',
    url: 'https://web.telegram.org/k/',
    hostnames: ['web.telegram.org'],
    allowSuffix: '.telegram.org'
  },
  line: {
    name: 'Line',
    short: 'LN',
    url: LINE_EXTENSION_URL,
    hostnames: ['access.line.me', 'line.me'],
    allowSuffix: '.line.me',
    needsExtension: true
  },
  'line-business': {
    name: 'Line 商业版',
    short: 'LNB',
    url: 'https://manager.line.biz/',
    hostnames: ['manager.line.biz', 'access.line.me', 'line.me'],
    allowSuffix: '.line.me',
    needsExtension: true
  },
  website: {
    name: '自定义网站',
    short: 'WEB'
  }
};

function appTypeConfig(type) {
  return APP_TYPES[type] || null;
}

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
          // 安全日志：凭证头只记录存在性布尔值，绝不输出原值；
          // URL 只记录 host+pathname，去掉 query（可能携带会话/令牌参数）
          let urlSafe = '';
          try {
            const u = new URL(details.url);
            urlSafe = `${u.host}${u.pathname}`.slice(-60);
          } catch {
            urlSafe = String(details.url).replace(/[?#].*$/, '').slice(-60);
          }
          console.log(`[line-hdr] ${urlSafe} UA=${(h['User-Agent']||'').slice(0,50)} OriginPresent=${h['Origin']?'yes':'no'} RefererPresent=${h['Referer']?'yes':'no'} CT=${h['Content-Type']||''} XSID=${h['X-Line-Session-ID']?'yes':'no'} XLST=${h['X-LST']?'yes':'no'}`);
        }
        // 必须调用 callback，否则请求被阻塞（Electron webRequest API 要求）
        callback({ requestHeaders: details.requestHeaders });
      });
      ses.webRequest.onCompleted((details) => {
        if (/line-chrome-gw/.test(details.url)) {
          // 安全日志：URL 只记录 host+pathname，去掉 query（可能携带会话/令牌参数）
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
      // 扩展就绪后通知 renderer 重载对应 webview（原版 onPluginInstalled 模式）
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('line:extension-ready', partition);
      }
    }
  } catch (error) {
    console.error(`[line] 扩展加载失败 (${partition}):`, error.message);
  }
}

let mainWindow = null;
let accountsState = {
  activeAccountId: null,
  accounts: []
};

const DEFAULT_CONFIG = {
  autoLaunch: false,
  isStartupMinimize: false,
  messageSound: true,
  theme: 'system', // 整体主题：system | dark | light
  accent: 'green', // 强调色：green | blue | purple | cyan | orange | pink
  broadcastGroups: [], // 群组预设 [{id, name, chatIds:[], createdAt}]
  lockPassword: '', // 锁屏密码（挂机锁）
  openProxy: false,
  protocal: 'http', // 代理协议：http | socks5（对齐原版字段名）
  host: '',
  port: '',
  login: '',
  password: ''
};

let configState = { ...DEFAULT_CONFIG };
let configQueue = Promise.resolve();

let persistenceQueue = Promise.resolve();

function createAccountId() {
  return crypto.randomUUID();
}

function partitionFor(accountId) {
  return `${PARTITION_PREFIX}${accountId}`;
}

function sanitizeAccountName(name, fallback) {
  if (typeof name !== 'string') {
    return fallback;
  }

  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 40) || fallback;
}

function normalizeStoredState(value) {
  const rawAccounts = Array.isArray(value)
    ? value
    : Array.isArray(value?.accounts)
      ? value.accounts
      : [];

  const seenIds = new Set();
  const accounts = [];

  for (const item of rawAccounts) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    const type = appTypeConfig(item.type) ? item.type : 'whatsapp';
    accounts.push({
      id,
      type,
      name: sanitizeAccountName(item.name, `账号 ${accounts.length + 1}`),
      partition: partitionFor(id),
      customUrl: typeof item.customUrl === 'string' ? item.customUrl : '',
      fontSize: Number.isInteger(item.fontSize) ? item.fontSize : 16,
      fontColor: typeof item.fontColor === 'string' ? item.fontColor : '#18A058',
      openProxy: item.openProxy === true,
      protocal: item.protocal === 'https' || item.protocal === 'socks4' || item.protocal === 'socks5' ? item.protocal : 'http',
      host: typeof item.host === 'string' ? item.host : '',
      port: typeof item.port === 'string' ? item.port : '',
      huser: typeof item.huser === 'string' ? item.huser : '',
      // 代理密码：兼容旧版明文 + 新版 enc: 密文
      hpwd: typeof item.hpwd === 'string'
        ? (item.hpwd.startsWith('enc:') ? safeDecrypt(item.hpwd.slice(4)) : item.hpwd)
        : '',
      createdAt:
        typeof item.createdAt === 'string'
          ? item.createdAt
          : new Date().toISOString()
    });
  }

  const requestedActiveId =
    !Array.isArray(value) && typeof value?.activeAccountId === 'string'
      ? value.activeAccountId
      : rawAccounts.find((item) => item?.active)?.id;

  const activeAccountId = accounts.some(
    (account) => account.id === requestedActiveId
  )
    ? requestedActiveId
    : accounts[0]?.id ?? null;

  return {
    activeAccountId,
    accounts
  };
}

function publicState() {
  return {
    activeAccountId: accountsState.activeAccountId,
    accounts: accountsState.accounts.map((account) => {
      const config = appTypeConfig(account.type);
      let url = config ? config.url : APP_TYPES[account.type].url;
      // WhatsApp 强制本地托管（旧版页面——媒体 API 匹配，图+文秒发）——已验证可用方案
      if (account.type === 'whatsapp' || account.type === 'whatsapp-pure') url = WA_LOCAL_URL;
      if (account.type === 'website' && account.customUrl) {
        url = account.customUrl;
      }
      return {
        ...account,
        active: account.id === accountsState.activeAccountId,
        url,
        typeName: config ? config.name : account.type,
        typeShort: config && config.short ? config.short : account.type.slice(0, 2).toUpperCase(),
        userAgent: CHROME_USER_AGENT
      };
    })
  };
}

function normalizeConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    autoLaunch: typeof value.autoLaunch === 'boolean' ? value.autoLaunch : DEFAULT_CONFIG.autoLaunch,
    isStartupMinimize: typeof value.isStartupMinimize === 'boolean' ? value.isStartupMinimize : DEFAULT_CONFIG.isStartupMinimize,
    messageSound: typeof value.messageSound === 'boolean' ? value.messageSound : DEFAULT_CONFIG.messageSound,
    theme: ['system','light'].includes(value.theme) ? value.theme : value.theme === 'dark' ? 'dark' : 'system',
    broadcastGroups: Array.isArray(value.broadcastGroups) ? value.broadcastGroups.filter(g => g && g.id && g.name) : [],
    // 迁移：旧版 theme 存的是强调色（green/blue...）→ 转为 accent + 跟随系统
    accent: ['green','blue','purple','cyan','orange','pink'].includes(value.theme) ? value.theme
      : ['green','blue','purple','cyan','orange','pink'].includes(value.accent) ? value.accent : 'green',
    lockPassword: typeof value.lockPassword === 'string'
      ? (value.lockPassword.startsWith('enc:') ? safeDecrypt(value.lockPassword.slice(4)) : value.lockPassword)
      : '',
    openProxy: typeof value.openProxy === 'boolean' ? value.openProxy : DEFAULT_CONFIG.openProxy,
    protocal: value.protocal === 'https' || value.protocal === 'socks4' || value.protocal === 'socks5' ? value.protocal : 'http',
    host: typeof value.host === 'string' ? value.host : DEFAULT_CONFIG.host,
    port: typeof value.port === 'string' ? value.port : DEFAULT_CONFIG.port,
    login: typeof value.login === 'string' ? value.login : DEFAULT_CONFIG.login,
    // 代理密码加密存储（safeStorage DPAPI），兼容旧版明文（enc: 前缀是加密的）
    password: typeof value.password === 'string'
      ? (value.password.startsWith('enc:') ? safeDecrypt(value.password.slice(4)) : value.password)
      : DEFAULT_CONFIG.password
  };
}

async function loadConfig() {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    configState = normalizeConfig(JSON.parse(content));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('读取配置文件失败:', error);
    }
    configState = { ...DEFAULT_CONFIG };
    await persistConfig();
    return;
  }
  // 迁移失败不能进入“读取失败”分支，否则会用默认值覆盖用户配置。
  try {
    await persistConfig();
  } catch (error) {
    console.error('[security] 配置敏感字段迁移失败，保留原文件:', error.message);
  }
}

function safeDecrypt(b64) {
  try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); } catch { return ''; }
}
function safeEncrypt(text) {
  if (!safeStorage.isEncryptionAvailable()) {
    const error = new Error('系统安全存储不可用，拒绝明文保存敏感配置');
    error.code = 'SECURE_STORAGE_UNAVAILABLE';
    throw error;
  }
  try {
    return 'enc:' + safeStorage.encryptString(String(text)).toString('base64');
  } catch (cause) {
    const error = new Error('敏感配置加密失败，未写入磁盘');
    error.code = 'SECURE_STORAGE_ENCRYPT_FAILED';
    error.cause = cause;
    throw error;
  }
}

function persistConfig() {
  // 代理密码、锁屏密码等敏感字段加密后再落盘（内存里保留明文用于鉴权/解锁，磁盘不落明文）
  const snapshot = JSON.stringify({
    ...configState,
    lockPassword: configState.lockPassword ? safeEncrypt(configState.lockPassword) : '',
    password: configState.password ? safeEncrypt(configState.password) : ''
  }, null, 2);
  configQueue = configQueue
    .catch(() => {})
    .then(async () => {
      const directory = path.dirname(CONFIG_FILE);
      const temporaryFile = `${CONFIG_FILE}.tmp`;
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporaryFile, snapshot, 'utf8');
      await fs.rename(temporaryFile, CONFIG_FILE);
    });
  return configQueue;
}

function applyLoginItemSettings() {
  if (process.platform !== 'win32') {
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: configState.autoLaunch,
      openAsHidden: configState.isStartupMinimize
    });
  } catch (error) {
    console.error('设置开机自启失败:', error);
  }
}

function proxyRulesFor(config) {
  if (!config || !config.openProxy) {
    return null;
  }
  const host = String(config.host || '').trim();
  const port = String(config.port || '').trim();
  if (!host || !port) {
    return null;
  }
  // 协议：http | https | socks4 | socks5（对齐原版 http/socks5 并补全）
  const protocal = config.protocal === 'https' || config.protocal === 'socks4' || config.protocal === 'socks5'
    ? config.protocal
    : 'http';
  // 认证：账号代理用 huser/hpwd，全局代理用 login/password
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

async function loadAccounts() {
  await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });

  try {
    const content = await fs.readFile(ACCOUNTS_FILE, 'utf8');
    accountsState = normalizeStoredState(JSON.parse(content));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('读取账号文件失败:', error);
    }

    accountsState = {
      activeAccountId: null,
      accounts: []
    };

    await persistAccounts();
    return;
  }
  // 迁移失败不能清空账号列表；保留已加载内存状态和原磁盘文件。
  try {
    await persistAccounts();
  } catch (error) {
    console.error('[security] 账号敏感字段迁移失败，保留原文件:', error.message);
  }
}

function persistAccounts() {
  // 敏感字段（代理密码 hpwd）加密落盘，内存保留明文用于代理鉴权
  const accountsForDisk = accountsState.accounts.map((account) => ({
    ...account,
    hpwd: account.hpwd ? safeEncrypt(account.hpwd) : '',
  }));
  const snapshot = JSON.stringify(
    {
      activeAccountId: accountsState.activeAccountId,
      accounts: accountsForDisk
    },
    null,
    2
  );

  persistenceQueue = persistenceQueue
    .catch(() => {})
    .then(async () => {
      const directory = path.dirname(ACCOUNTS_FILE);
      const temporaryFile = `${ACCOUNTS_FILE}.tmp`;

      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporaryFile, snapshot, 'utf8');
      await fs.rename(temporaryFile, ACCOUNTS_FILE);
    });

  return persistenceQueue;
}

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  return event.sender.id === mainWindow.webContents.id;
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) {
    throw new Error('拒绝来自未授权页面的 IPC 请求');
  }
}

function assertValidAccountId(accountId) {
  if (
    typeof accountId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId)
  ) {
    throw new Error('无效的账号 ID');
  }
}

function notifyAccountsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('accounts:changed', publicState());
  }
}

async function addAccount(_event, payload = {}) {
  assertTrustedSender(_event);

  const raw = typeof payload === 'string' ? { name: payload } : payload || {};
  const type = raw.type === undefined ? 'whatsapp' : raw.type;
  const config = appTypeConfig(type);
  if (!config) {
    const error = new Error('ACCOUNT_TYPE_UNSUPPORTED');
    error.code = 'ACCOUNT_TYPE_UNSUPPORTED';
    throw error;
  }

  const customUrl = type === 'website' ? normalizeWebsiteUrl(raw.customUrl) : '';

  const id = createAccountId();
  const account = {
    id,
    type,
    name: sanitizeAccountName(raw.name, `账号 ${accountsState.accounts.length + 1}`),
    partition: partitionFor(id),
    customUrl,
    createdAt: new Date().toISOString()
  };

  accountsState.accounts.push(account);
  accountsState.activeAccountId = id;

  await persistAccounts();
  notifyAccountsChanged();

  return {
    state: publicState(),
    account: {
      ...account,
      active: true,
      url: type === 'website' ? customUrl : config.url,
      userAgent: CHROME_USER_AGENT
    }
  };
}

async function switchAccount(event, accountId) {
  assertTrustedSender(event);
  assertValidAccountId(accountId);

  const exists = accountsState.accounts.some(
    (account) => account.id === accountId
  );

  if (!exists) {
    throw new Error('账号不存在');
  }

  accountsState.activeAccountId = accountId;
  await persistAccounts();
  notifyAccountsChanged();

  return publicState();
}

async function removeAccount(event, accountId) {
  assertTrustedSender(event);
  assertValidAccountId(accountId);

  const accountIndex = accountsState.accounts.findIndex(
    (account) => account.id === accountId
  );

  if (accountIndex === -1) {
    throw new Error('账号不存在');
  }

  const [removedAccount] = accountsState.accounts.splice(accountIndex, 1);
  deletedTranslationPartitions.add(removedAccount.partition);
  translationCaches.delete(removedAccount.partition);
  translationCacheLoaded.delete(removedAccount.partition);
  translationCacheWrites.delete(removedAccount.partition);
  for (const key of translationLatestRequest.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationLatestRequest.delete(key);
  for (const key of translationInflight.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationInflight.delete(key);

  if (accountsState.activeAccountId === accountId) {
    accountsState.activeAccountId =
      accountsState.accounts[accountIndex]?.id ??
      accountsState.accounts[accountIndex - 1]?.id ??
      null;
  }

  await persistAccounts();

  // 强制销毁该账号的 webContents（释放 session 文件锁，否则分区目录删不掉）
  try {
    const guests = webContents.getAllWebContents().filter(
      (wc) => wc.session?.partition === removedAccount.partition
    );
    for (const wc of guests) {
      if (!wc.isDestroyed()) wc.destroy();
    }
  } catch (e) { /* 销毁失败不影响 */ }

  const accountSession = session.fromPartition(removedAccount.partition, {
    cache: true
  });

  try {
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    await accountSession.clearAuthCache();
    await accountSession.clearHostResolverCache();
    await accountSession.flushStorageData();
    // 沙箱自毁：物理删除该账号的分区目录（磁盘上不留任何数据）
    // Windows 文件锁可能延迟释放 → 重试，仍失败则记录到退出时兜底清理
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
    notifyAccountsChanged();
  }

  return publicState();
}

const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2';
const translationCaches = new Map(); // partition -> Map(hash -> encrypted-local translation)
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
  assertValidAccountId(accountId);
  const account = accountsState.accounts.find(item => item.id === accountId);
  if (!account?.partition) throw new Error('账号沙箱不存在');
  return account.partition;
}

function translationGatewayEndpoints() {
  const configured = String(process.env.GEEK_TRANSLATION_GATEWAY_URL || '').trim();
  const list = configured
    ? configured.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
    : [];
  // 未配置环境变量时：默认走云端翻译 Worker（geek-translate.9529360.workers.dev）。
  // 本地网关（127.0.0.1:18991）仅当显式通过 GEEK_TRANSLATION_GATEWAY_URL 配置时才使用。
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
  // 不暴露端点 URL 列表（内部网络信息），只返回数量与状态
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
  const account = accountsState.accounts.find(item => item.id === accountId);
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
  // 字符余额检查：只读本地缓存（不发起网络请求），额度用完抛错（UI 静默处理）。
  // 额度固定：服务端原子扣减并返回剩余值，客户端本地更新；本地无缓存则放行（服务端兜底 402）。
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
    // 多端点故障切换：优先健康端点（primary），失败切换 backup；全部失败抛最后错误。
    // 整个请求有 30s 总预算，避免端点×超时放大。
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
        // 远程翻译 Worker 已服务端原子扣额；客户端不再二次上报，避免重复计费。
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

async function updateAccount(event, accountId, patchData) {
  assertTrustedSender(event);
  assertValidAccountId(accountId);

  const account = accountsState.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error('账号不存在');
  }

  const raw = patchData && typeof patchData === 'object' ? patchData : {};

  if (typeof raw.name === 'string') {
    const name = sanitizeAccountName(raw.name, account.name);
    if (name) {
      account.name = name;
    }
  }
  if (Number.isInteger(raw.fontSize) && raw.fontSize >= 10 && raw.fontSize <= 28) {
    account.fontSize = raw.fontSize;
  }
  if (typeof raw.fontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.fontColor)) {
    account.fontColor = raw.fontColor;
  }
  if (typeof raw.openProxy === 'boolean') {
    account.openProxy = raw.openProxy;
  }
  if (raw.protocal === 'http' || raw.protocal === 'https' || raw.protocal === 'socks4' || raw.protocal === 'socks5') {
    account.protocal = raw.protocal;
  }
  if (typeof raw.host === 'string') account.host = raw.host;
  if (typeof raw.port === 'string') account.port = raw.port;
  if (typeof raw.huser === 'string') account.huser = raw.huser;
  if (typeof raw.hpwd === 'string') account.hpwd = raw.hpwd;

  await persistAccounts();
  await applyProxyForPartition(
    account.partition,
    account.openProxy ? account : (configState.openProxy ? configState : null)
  );
  notifyAccountsChanged();

  return publicState();
}

async function moveAccount(event, accountId, direction) {
  assertTrustedSender(event);
  assertValidAccountId(accountId);

  const index = accountsState.accounts.findIndex((item) => item.id === accountId);
  if (index === -1) {
    throw new Error('账号不存在');
  }
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= accountsState.accounts.length) {
    throw new Error('已经是边缘位置');
  }

  const [moved] = accountsState.accounts.splice(index, 1);
  accountsState.accounts.splice(target, 0, moved);

  await persistAccounts();
  notifyAccountsChanged();

  return publicState();
}

async function moveAccountTo(event, accountId, targetIndex) {
  assertTrustedSender(event);
  assertValidAccountId(accountId);

  const index = accountsState.accounts.findIndex((item) => item.id === accountId);
  if (index === -1) {
    throw new Error('账号不存在');
  }
  const insertAt = Math.max(0, Math.min(accountsState.accounts.length - 1, targetIndex | 0));
  const [moved] = accountsState.accounts.splice(index, 1);
  accountsState.accounts.splice(insertAt, 0, moved);

  await persistAccounts();
  notifyAccountsChanged();

  return publicState();
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
    listAccounts: async () => publicState(),
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
    const account = accountsState.accounts.find(item => item.id === accountId);
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
    return Object.entries(APP_TYPES).map(([type, cfg]) => ({
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

  ipcMain.handle('config:get', async (event) => {
    assertTrustedSender(event);
    return { ...configState };
  });

  ipcMain.handle('config:set', async (event, patchData) => {
    assertTrustedSender(event);
    const raw = patchData && typeof patchData === 'object' ? patchData : {};
    configState = normalizeConfig({ ...configState, ...raw });
    await persistConfig();
    applyLoginItemSettings();

    const globalProxy = configState.openProxy ? configState : null;
    await Promise.all(
      accountsState.accounts.map((account) =>
        applyProxyForPartition(
          account.partition,
          account.openProxy ? account : globalProxy
        )
      )
    );
    notifyAccountsChanged();

    return { ...configState };
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
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

  // 系统主题（跟随系统用）
  ipcMain.handle('theme:get-system', async (event) => {
    assertTrustedSender(event);
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  // WA 媒体发送链路（HelloWorld 同款）：隐藏 input 接收 File → prepRawMedia → sendMediaMsgToChat
  // 传输层由调用方提供 send(method, params)，不关心内部/外部 CDP。
  async function waSendFileViaCdp(send, { filePath, chatId, caption }) {
    await send('DOM.enable');
    // 1. 页面创建隐藏 input
    const created = await send('Runtime.evaluate', { expression: `(() => {
      const i = document.createElement('input');
      i.type = 'file';
      i.id = '__hw_file_input';
      i.style.display = 'none';
      document.body.appendChild(i);
      return !!i;
    })()`, returnByValue: true });
    if (!created.result.value) throw new Error('创建文件输入框失败');
    // 2. 注入文件（File 对象到 input.files）
    const doc = await send('DOM.getDocument', { depth: -1 });
    const q = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '#__hw_file_input' });
    const nodeIds = q.nodeIds || [];
    if (!nodeIds.length) throw new Error('找不到文件输入框');
    await send('DOM.setFileInputFiles', { nodeId: nodeIds[0], files: [filePath] });
    // 3. 页面内 File → prepRawMedia → sendMediaMsgToChat（HelloWorld 同款链路）
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

  // 外部 CDP（9344）传输：给页面级流程提供 { send, onEvent }
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

  // 群发文件（WA 底层 API——HelloWorld 同款）：CDP 注入 File 对象到页面（不传 base64——大图不卡）
  async function sendBroadcastFile(event, payload) {
    assertTrustedSender(event);
    const { partition, filePath, chatId, caption, mime, name } = payload || {};
    if (!partition || !filePath || !chatId) throw new Error('参数错误');
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, 'whatsapp');
      return await withExternalCdpSend(wsUrl, ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
    }
    return await internalCdp.run(partition, 'whatsapp', ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
  }

  // 群发附件（WA UI 路径）：拦截文件选择器 + 点附件 + 照片菜单 + 喂文件（真实鼠标——React 一定响应）
  // UI 文件注入：拦截文件选择器 + 真实鼠标点附件/照片 + 喂文件（React 一定响应）
  async function attachFileViaCdp({ send, onEvent }, filePath) {
    await send('Page.enable');
    await send('DOM.enable');
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    // 文件选择器打开 → 喂文件
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
      // 1. 确保打开了聊天（附件按钮只在聊天页）——没打开就真实点击第一个聊天行
      let btn = await send('Runtime.evaluate', { expression: `(() => {
        const b = document.querySelector('[data-testid="plus-rounded"]');
        if (!b) return JSON.stringify({ ok: false });
        const r = b.getBoundingClientRect();
        return JSON.stringify({ ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      })()`, returnByValue: true });
      let bp = JSON.parse(btn.result.value);
      if (!bp.ok) {
        // 循环尝试点击聊天行（排除过滤行/Business 广告行），直到聊天打开（输入框出现）
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
          // 没打开：关掉可能的弹层（Esc）再试下一个
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
      // 2. 点"照片和视频"菜单
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
        // 3. 等 fileChooserOpened（onEvent 处理器喂文件）
        await sleep(3000);
        return true;
      }
      // 没有照片菜单（可能菜单没开/或当前没有附件按钮）——直接注入 file input
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

  // 群发附件：真实拖拽文件到账号页面（应用内 CDP；开发模式探测到 9344 时走外部 CDP）
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
          return JSON.stringify({
            ok: true,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
          });
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
    // 验证弹窗
    const chk = await send('Runtime.evaluate', { expression: `(() => {
      const modalBtn = [...document.querySelectorAll('.modal-dialog button, .modal-container button')].find(b => /primary/.test((b.className || '').toString()));
      return modalBtn ? 'MODAL_OK' : 'NO_MODAL';
    })()`, returnByValue: true });
    return chk?.result?.value === 'MODAL_OK';
  }

  async function getDropPos(partition) {
    // 拿输入区坐标（同 webContents executeJavaScript——先通过主窗口 webContents 找 guest）
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
  // 保存文件（群发失败名单导出）
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

// 系统深/浅色变化 → 通知 renderer（跟随系统主题）
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
    // 禁止后台节流：display:none 的 webview 页面 JS 继续运行（后台平台收消息实时更新未读）
    webPreferences.backgroundThrottling = false;
    const partition = String(params.partition || '');
    const source = String(params.src || '');

    const account = accountsState.accounts.find(
      (item) => item.partition === partition
    );
    const config = account ? appTypeConfig(account.type) : null;

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

    const hostname = parsedSource.hostname.toLowerCase();

    let customAllowed = false;
    if (account.type === 'website' && account.customUrl) {
      try {
        const customHost = parseWebsiteUrl(account.customUrl).hostname.toLowerCase();
        customAllowed = parsedSource.protocol === 'https:' &&
          (hostname === customHost || hostname.endsWith(`.${customHost}`));
      } catch {
        customAllowed = false;
      }
    }

    // Line 账号允许加载 LINE 官方扩展页面（chrome-extension://）
    const isLineExtensionPage =
      (account.type === 'line' || account.type === 'line-business') &&
      parsedSource.protocol === 'chrome-extension:' &&
      parsedSource.host === LINE_EXTENSION_ID;

    // WhatsApp 本地托管服务例外（http://127.0.0.1:1843——旧版页面媒体 API 匹配）
    const isWaLocal =
      parsedSource.protocol === 'http:' &&
      parsedSource.hostname === '127.0.0.1' &&
      parsedSource.port === String(WA_LOCAL_PORT);

    const isAllowed =
      isLineExtensionPage ||
      isWaLocal ||
      (config &&
        parsedSource.protocol === 'https:' &&
        ((config.hostnames && config.hostnames.includes(hostname)) ||
          (config.allowSuffix && hostname.endsWith(config.allowSuffix)) ||
          customAllowed));

    if (!isAllowed) {
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
      // LINE 扩展页面兼容注入 —— 原版 s3loYR.js（chrome API mock + _pluginKD 补全）
      webPreferences.preload = path.join(__dirname, '..', 'resources', 's3loYR.js');
      webPreferences.contextIsolation = false;
    } else if (isWebsite) {
      // 任意第三方 Website 只获得纯 Chromium Web 能力，不继承 Geek/LINE preload。
      delete webPreferences.preload;
      webPreferences.contextIsolation = true;
    } else {
      // WA/TG：桥 preload（翻译/原生输入 sendToHost）由主进程直接设置，
      // 避免 params.webpreferences 覆盖 renderer 属性时把 preload 丢弃。
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
    // 对齐原版：LINE 页面 URL 带 lw-key 参数（原版: ?lw-key=mw1fq&1786627670770）
    if (isLine) {
      const lwKey = Math.random().toString(36).slice(2, 8);
      params.src = `${LINE_EXTENSION_URL}?lw-key=${lwKey}&${Date.now()}`;
    }
    // 对齐原版 webview 配置（逆向自原版 DOM: contextIsolation=no,sandbox=false,nativeWindowOpen=yes,spellcheck=no[,backgroundThrottling=false]）
    // 沙箱强化：sandbox 改为 true（Chromium OS 沙箱保护渲染进程）
    webPreferences.sandbox = true;
    params.webpreferences = isLine
      ? 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false'
      : isWebsite
        ? 'contextIsolation=yes,sandbox=true,nativeWindowOpen=no,spellcheck=no'
        : 'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no';

    // 按账号配置（账号优先，否则全局）应用代理。
    const accountProxy = account.openProxy
      ? account
      : configState.openProxy
        ? configState
        : null;
    applyProxyForPartition(partition, accountProxy);

    // LINE 系列账号加载官方扩展（登录聊天必需）。
    if (account.type === 'line' || account.type === 'line-business') {
      loadLineExtension(partition);
    }
    // WhatsApp 系列账号：不加载第三方 pragmaz 扩展（安全：含原版硬编码代理凭据 + pragmaz.ai 通信）
    // 极客自有群发/翻译/发送走 WPP+CDP，无需扩展
  });

  window.webContents.on('did-attach-webview', (_event, webContents) => {
    // 收集 LINE guest webContents（token 定时备份用）
    const part = webContents.session?.partition || '';
    if (part.startsWith(PARTITION_PREFIX)) {
      webContents.on('did-navigate', (event, url) => {
        if (url.startsWith(`chrome-extension://${LINE_EXTENSION_ID}`)) {
          lineGuestContents.set(part, webContents);
        }
      });
    }
    // 诊断：记录 webview 导航与失败（Line 扩展页面排查用）
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
      wppInjected.delete(part); // 主框架导航后需要重新注入 WPP（刷新/重载）
      console.log(`[wv] did-navigate url=${sanitizeUrlForLog(url)}`);
    });
    webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[wv] did-navigate-in-page url=${sanitizeUrlForLog(url)}`);
    });

    // WhatsApp：页面加载完成后注入 WPP（内部 API 直发，对齐原版/HelloWorld）
    const ownerAccount = accountsState.accounts.find((account) => account.partition === part);
    const ownerIsWhatsApp = ownerAccount?.type === 'whatsapp' || ownerAccount?.type === 'whatsapp-pure';
    webContents.on('did-finish-load', async () => {
      const url = webContents.getURL() || '';
      if (ownerIsWhatsApp && (url.includes('web.whatsapp.com') || url.includes(`127.0.0.1:${WA_LOCAL_PORT}`)) && !wppInjected.has(part)) {
        await injectWppWithRetry(webContents, part);
      }
    });

  // 注入 WPP/WAPLUS 并验证（WAPLUS_WPP.chat 就绪才算成功，失败重试——新账号登录过程中页面会多次导航）
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
          // 扩展面板默认收起（不挡聊天——需要时用户点展开/或群发菜单触发）
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

    function hostAllowed(url) {
      try {
        const target = new URL(url);

        // Line 扩展页面（chrome-extension://）
        if (
          target.protocol === 'chrome-extension:' &&
          target.hostname === LINE_EXTENSION_ID
        ) {
          return true;
        }

        const hostname = target.hostname.toLowerCase();
        if (target.protocol !== 'https:') {
          // WhatsApp 本地托管服务例外（http://127.0.0.1:1843——旧版页面媒体 API 匹配）
          if (hostname === '127.0.0.1' && target.port === String(WA_LOCAL_PORT)) return true;
          return false;
        }
        const types = Object.values(APP_TYPES);
        if (types.some((config) =>
          config.hostnames?.includes(hostname) ||
          (config.allowSuffix && hostname.endsWith(config.allowSuffix))
        )) {
          return true;
        }
        // 自定义网站：放行该账号 customUrl 的域名
        return accountsState.accounts.some((a) => {
          if (a.type !== 'website' || !a.customUrl) {
            return false;
          }
          try {
            const customHost = parseWebsiteUrl(a.customUrl).hostname.toLowerCase();
            return hostname === customHost || hostname.endsWith(`.${customHost}`);
          } catch {
            return false;
          }
        });
      } catch {
        return false;
      }
    }

    webContents.setWindowOpenHandler(({ url }) => {
      if (hostAllowed(url)) {
        return { action: 'allow' };
      }
      return { action: 'deny' };
    });

    webContents.on('will-navigate', (event, url) => {
      if (!hostAllowed(url)) {
        event.preventDefault();
      }
    });

    webContents.on('will-redirect', (event, url) => {
      if (!hostAllowed(url)) {
        event.preventDefault();
      }
    });
  });
}

// ---------- 付费订阅（登录/锁定窗口） ----------
let subscriptionWindow = null;
let subscriptionStore = null;
let subscriptionCheckDone = false; // 启动检查是否完成（避免重复弹窗）

function initSubscriptionStore() {
  if (!subscriptionStore) {
    subscriptionStore = createSubscriptionStore({ userDataDir: USER_DATA_DIR });
    // 注入 safeStorage 加解密：token 落盘加密（DPAPI），防止木马直接读明文凭据
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
  // 订阅窗口点"进入极客"→ 关闭订阅窗，打开主窗口
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
    // 若主窗口也没开（启动锁定页直接关）→ 退出应用
    if (!mainWindow || mainWindow.isDestroyed()) { isQuitting = true; app.quit(); }
    return { ok: true };
  });
}

// 启动时登录门禁（Freemium）：已登录 → 直接进主窗口（翻译额度用完不锁客户端）；
// 未登录 → 弹登录/注册窗口。有本地 token 但本地状态不明确时先进主窗口并后台刷新。
async function enforceSubscriptionGate() {
  if (subscriptionCheckDone) return;
  subscriptionCheckDone = true;
  try {
    const store = initSubscriptionStore();
    const local = await store.getState();
    if (local.loggedIn) {
      // 已登录 → 进主窗口（无论是否有订阅；翻译额度用完不锁客户端）
      createMainWindow();
      store.refresh().catch(() => {});
      return;
    }
    // 未登录 → 弹登录/注册窗口
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
    frame: false, // 无边框，自绘窗口控制按钮（对齐原版）
    icon: path.join(__dirname, '..', 'build', 'icon.ico'), // 窗口/任务栏图标
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

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  // 主窗口渲染进程崩溃 → 限频 relaunch（避免崩溃循环；更新安装期间跳过，防竞态）
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.log('main-window-crash', { reason: details?.reason, exitCode: details?.exitCode });
    if (isUpdateInstalling()) {
      console.error('[crash] 更新安装中，跳过自动重启（避免与 quitAndInstall 竞态）');
      return;
    }
    if (relaunchLimiter.allow()) {
      console.error('[crash] 主窗口渲染进程崩溃，5分钟内限频2次内自动重启');
      // 等待账号/配置持久化队列落盘后再重启，避免丢失最后一次变更
      Promise.all([persistenceQueue, configQueue]).catch(() => {}).finally(() => {
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

    if (
      destination.protocol !== 'file:' ||
      destination.pathname !== localIndex.pathname
    ) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 关闭窗口 → 缩到托盘（挂机收消息），托盘菜单"退出"才真正退出
  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
}

// ---------- 系统托盘 ----------
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
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tray:lock');
          }
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
    // 左键单击：显示/隐藏切换
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        showMainWindow();
      }
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

// 网络优化：DNS over HTTPS（DoH，用 Google/Cloudflare 加密 DNS——避免 ISP DNS 慢/污染）
try {
  app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
  app.commandLine.appendSwitch('dns-over-https-templates', 'https://dns.google/dns-query https://cloudflare-dns.com/dns-query');
  // 界面/扩展语言固定中文（WAPlus 扩展按浏览器语言 i18n——不设则英文面板）
  app.commandLine.appendSwitch('lang', 'zh-CN');
} catch (e) { /* 忽略 */ }

// WhatsApp 本地托管服务（HelloWorld 同款：固定旧版页面——媒体 API 匹配，图+文秒发）
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

// 启动时清理已删除账号遗留的孤儿分区目录（不误删当前账号 partition）
async function cleanupOrphanPartitions() {
  try {
    // 安全闸：账号列表为空（读取失败/首次启动）时绝不清理——避免误删全部真实分区
    if (!accountsState.accounts || !accountsState.accounts.length) return;
    const partitionRoot = path.join(USER_DATA_DIR, 'Partitions');
    let entries;
    try { entries = await fs.readdir(partitionRoot); } catch { return; }
    const activePartitions = accountsState.accounts.map((account) => account.partition);
    const orphans = collectOrphanPartitions({ entries, activePartitions });
    if (!orphans.length) return;
    for (const name of orphans) {
      const dir = path.join(partitionRoot, name);
      // 已在待删列表（removeAccount 失败兜底）→ 跳过，避免重复尝试
      if (pendingPartitionDeletions.has(dir)) continue;
      try {
        await fs.rm(dir, { recursive: true, force: true });
        diagnostics.log('orphan-partition-removed', { partition: name });
      } catch (e) {
        // 文件锁等原因删除失败 → 退出时兜底
        pendingPartitionDeletions.add(dir);
        console.error('[cleanup] 孤儿分区删除失败（退出时兜底）:', name, e.message);
      }
    }
  } catch (e) {
    console.error('[cleanup] 孤儿分区清理失败（不影响启动）:', e.message);
  }
}

app.whenReady().then(async () => {
  // 0) Windows 正式版启动：先修复 userData ACL（一次性、幂等；老版本 /inheritance:r 曾清空子目录 ACL）。
  //    diagnostics 对象在模块加载时创建，但 log() 每次写入前会自动重试 mkdir——
  //    因此即使修复前目录损坏，修复完成后日志自动恢复，无需重新初始化。
  //    runStartupAclRepair 从不抛出；后续流程（含 createMainWindow）照常执行，不受修复成败影响。
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
  await loadAccounts();
  await loadConfig();
  applyLoginItemSettings();
  registerIpcHandlers();
  registerSubscriptionIpcHandlers();
  // 订阅门禁：有有效订阅→主窗口；未登录/过期→订阅窗口
  await enforceSubscriptionGate();
  createTray();
  initAutoUpdater();
  watchSystemTheme();
  // 窗口/会话建立后再清理孤儿分区（避免竞态）；账号为空时清理函数内部自保护
  setTimeout(() => { cleanupOrphanPartitions().catch(() => {}); }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      enforceSubscriptionGate();
    }
  });

  // 退出时兜底清理：删除账号后因文件锁未删掉的分区目录。
  // will-quit 不能等待异步 Promise，因此这里必须使用同步文件系统删除。
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
  isQuitting = true; // 允许窗口真正关闭（托盘"退出"路径）
  accountIpcBoundary?.dispose();
  accountIpcBoundary = null;
  ipcMain.removeHandler('config:get');
  ipcMain.removeHandler('config:set');
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
