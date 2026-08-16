'use strict';

const { app, BrowserWindow, ipcMain, session, Notification, nativeTheme, webContents, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { initAutoUpdater } = require('./updater.cjs');
const { createOwnershipRegistry } = require('./webview-ownership.cjs');
const webviewOwnership = createOwnershipRegistry();
const runtimePaths = require('./runtime-paths.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const { createInternalCdp } = require('./internal-cdp.cjs');
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
const LINE_TOKENS_FILE = () => path.join(app.getPath('userData'), 'line-tokens.json');
let lineTokensCache = {}; // partition -> token JSON 字符串
const lineGuestContents = new Map(); // partition -> LINE guest webContents（token 备份用）
const wppInjected = new Set(); // 已注入 WPP 的 partition（WA 内部 API 直发）
const pendingPartitionDeletions = new Set(); // 删除失败的分区目录，退出时兜底清理
async function loadLineTokens() {
  try {
    const raw = await fs.readFile(LINE_TOKENS_FILE(), 'utf-8');
    lineTokensCache = JSON.parse(raw || '{}');
  } catch { lineTokensCache = {}; }
}
async function saveLineToken(partition, tokenJson) {
  if (!tokenJson) return;
  lineTokensCache[partition] = tokenJson;
  try {
    await fs.writeFile(LINE_TOKENS_FILE(), JSON.stringify(lineTokensCache), 'utf-8');
  } catch (e) { /* 写失败不影响 */ }
}

// 对齐原版 Hello-GPT 的进程参数（原版 renderer 带 --no-sandbox/--no-zygote/--js-flags/
// --service-worker-schemes 等；webview 扩展 SW 注册与沙箱行为可能受影响）
try {
  // 沙箱强化：不再全局 --no-sandbox（保留原版其余参数）。
  // 若 LINE 扩展/启动出现兼容问题，改回 app.commandLine.appendSwitch('no-sandbox')。
  app.commandLine.appendSwitch('no-zygote');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
  app.commandLine.appendSwitch('service-worker-schemes', 'http,https');
} catch (e) { /* 参数设置失败不影响 */ }
try {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'http', privileges: { standard: true, bypassCSP: true, corsEnabled: true, fetch: true, serviceWorkers: true, streaming: true } },
    { scheme: 'https', privileges: { standard: true, bypassCSP: true, corsEnabled: true, fetch: true, serviceWorkers: true, streaming: true } },
  ]);
} catch (e) { /* scheme 设置失败不影响 */ }

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

// WhatsApp 本地托管（HelloWorld 同款方案）：固定旧版页面——媒体 API 与 WPP 匹配，图+文秒发
// 最新版 web.whatsapp.com 的 createFromData/prepRawMedia 不产生 mediaEntry（发送失败红感叹号）
const WA_LOCAL_PORT = 1843;
const WA_LOCAL_URL = `http://127.0.0.1:${WA_LOCAL_PORT}/`;

const APP_TYPES = {
  whatsapp: {
    name: 'WhatsApp',
    short: 'WA',
    url: WA_LOCAL_URL,
    hostnames: ['127.0.0.1'],
    allowSuffix: '.whatsapp.com'
  },
  'whatsapp-pure': {
    name: 'WhatsApp 纯净版',
    short: 'WAP',
    url: WA_LOCAL_URL,
    hostnames: ['127.0.0.1'],
    allowSuffix: '.whatsapp.com'
  },
  'telegram-z': {
    name: 'TelegramZ',
    short: 'TGZ',
    url: 'https://web.telegram.org/a',
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
  }
};

function appTypeConfig(type) {
  return APP_TYPES[type] || null;
}

// LINE 官方浏览器扩展（复刻项目自带副本，供 line / line-business 账号登录使用）
// 用 MV3 原始扩展（与 Hello-GPT 原版完全一致）；Electron 35.5.1 下 SW 注册行为待验证
// 打包后扩展目录会被 asarUnpack 到真实磁盘（session.loadExtension 需要真实文件），
// 因此资源目录在打包模式下解析到 app.asar.unpacked；开发模式仍指向项目 resources/。
const RESOURCES_DIR = runtimePaths.resourcesDirFor({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname
});
const LINE_EXTENSION_PATH = path.join(
  RESOURCES_DIR, 'extensions', 'line-3.5.1'
);

// HelloWorld 剥离的 WhatsApp 扩展（WAPlus——b_test 英文版，功能最全）
const WAPLUS_EXTENSION_PATH = path.join(
  RESOURCES_DIR, 'waplus-ext', '1.7.96_0'
);
// HelloWorld 剥离的 WhatsApp 扩展（Pragmaz——a_test 中文版，用户截图的中文群发面板）
const PRAGMAZ_EXTENSION_PATH = path.join(
  RESOURCES_DIR, 'pragmaz-ext', '1.7_0'
);

async function loadWaplusExtension(partition) {
  try {
    const ses = session.fromPartition(partition, { cache: true });
    const ext = await ses.loadExtension(PRAGMAZ_EXTENSION_PATH); // 中文面板（a_test）优先
    if (ext) {
      console.log(`[waplus] 扩展已加载到 ${partition}: ${ext.name} ${ext.version}`);
    }
  } catch (error) {
    console.error(`[waplus] 扩展加载失败 (${partition}):`, error.message);
  }
}

async function loadLineExtension(partition) {
  try {
    const ses = session.fromPartition(partition, { cache: true });
    try {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        if (/checkQrCodeVerified/.test(details.url)) {
          const h = details.requestHeaders || {};
          console.log(`[line-hdr] ${details.url.slice(-60)} UA=${(h['User-Agent']||'').slice(0,50)} Origin=${h['Origin']||''} Referer=${h['Referer']||''} CT=${h['Content-Type']||''} XSID=${h['X-Line-Session-ID']||''} XLST=${h['X-LST']||''}`);
        }
        // 必须调用 callback，否则请求被阻塞（Electron webRequest API 要求）
        callback({ requestHeaders: details.requestHeaders });
      });
      ses.webRequest.onCompleted((details) => {
        if (/line-chrome-gw/.test(details.url)) {
          console.log(`[line-api] ${details.statusCode} ${details.method} ${details.url.slice(0, 150)}`);
        }
      });
    } catch (e) { /* webRequest 监听失败不影响 */ }
    const ext = await ses.loadExtension(LINE_EXTENSION_PATH);
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
      hpwd: typeof item.hpwd === 'string' ? item.hpwd : '',
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
    lockPassword: typeof value.lockPassword === 'string' ? value.lockPassword : '',
    openProxy: typeof value.openProxy === 'boolean' ? value.openProxy : DEFAULT_CONFIG.openProxy,
    protocal: value.protocal === 'https' || value.protocal === 'socks4' || value.protocal === 'socks5' ? value.protocal : 'http',
    host: typeof value.host === 'string' ? value.host : DEFAULT_CONFIG.host,
    port: typeof value.port === 'string' ? value.port : DEFAULT_CONFIG.port,
    login: typeof value.login === 'string' ? value.login : DEFAULT_CONFIG.login,
    password: typeof value.password === 'string' ? value.password : DEFAULT_CONFIG.password
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
  }
}

function persistConfig() {
  const snapshot = JSON.stringify(configState, null, 2);
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
  }
}

function persistAccounts() {
  const snapshot = JSON.stringify(
    {
      activeAccountId: accountsState.activeAccountId,
      accounts: accountsState.accounts
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
  const type = appTypeConfig(raw.type) ? raw.type : 'whatsapp';
  const config = appTypeConfig(type);

  let customUrl = '';
  if (type === 'website') {
    customUrl = typeof raw.customUrl === 'string' ? raw.customUrl.trim() : '';
    if (!/^https?:\/\/.+\..+/.test(customUrl)) {
      throw new Error('自定义网站需要填写合法的 URL（http/https）');
    }
  }

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
  accountDataCaches.delete(removedAccount.partition);
  accountDataLoaded.delete(removedAccount.partition);
  accountDataWrites.delete(removedAccount.partition);
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

const TRANSLATION_CACHE_VERSION = 'prompt-20260815-1';
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

const accountDataCaches = new Map();
const accountDataLoaded = new Set();
const accountDataWrites = new Map();
function accountDataFile(partition) {
  const dirName = String(partition || '').replace(/^persist:/, '');
  if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) throw new Error('账号沙箱不合法');
  return path.join(app.getPath('userData'), 'Partitions', dirName, 'geek-account-data.jsonl');
}
async function loadAccountData(partition) {
  if (!accountDataCaches.has(partition)) accountDataCaches.set(partition, new Map());
  const cache = accountDataCaches.get(partition);
  if (accountDataLoaded.has(partition)) return cache;
  accountDataLoaded.add(partition);
  if (!safeStorage.isEncryptionAvailable()) return cache;
  try {
    for (const line of (await fs.readFile(accountDataFile(partition), 'utf-8')).split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line); if (!item.key || !item.value) continue;
        const value = safeStorage.decryptString(Buffer.from(item.value, 'base64'));
        item.deleted ? cache.delete(item.key) : cache.set(item.key, value);
      } catch {}
    }
  } catch (error) { if (error?.code !== 'ENOENT') { accountDataLoaded.delete(partition); throw error; } }
  return cache;
}
async function appendAccountData(partition, key, value, deleted = false) {
  if (deletedTranslationPartitions.has(partition)) return;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，账号数据未保存');
  const file = accountDataFile(partition);
  const record = { key, deleted, at: Date.now(), value: safeStorage.encryptString(String(value ?? '')).toString('base64') };
  const previous = accountDataWrites.get(partition) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => { if (deletedTranslationPartitions.has(partition)) return; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf-8'); });
  accountDataWrites.set(partition, write);
  try { await write; } finally { if (accountDataWrites.get(partition) === write) accountDataWrites.delete(partition); }
}
function resolveAccountPartition(accountId) {
  assertValidAccountId(accountId);
  const account = accountsState.accounts.find(item => item.id === accountId);
  if (!account?.partition) throw new Error('账号沙箱不存在');
  return account.partition;
}

function translationGatewayEndpoint() {
  const configured = String(process.env.GEEK_TRANSLATION_GATEWAY_URL || '').trim().replace(/\/$/, '');
  const endpoint = configured || (app.isPackaged ? '' : 'http://127.0.0.1:18991');
  if (!endpoint) throw new Error('远程翻译服务尚未配置');
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(endpoint)) throw new Error('翻译服务配置不安全');
  return endpoint;
}

async function checkTranslationGateway(event) {
  assertTrustedSender(event);
  const endpoint = translationGatewayEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${endpoint}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    const data = await response.json().catch(() => ({}));
    return { ok: data.ok !== false, models: Number(data.models || 0) };
  } finally { clearTimeout(timer); }
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
  const endpoint = translationGatewayEndpoint();
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
    if (cached) return { text: cached.text, source: body.source || 'auto', target, cached: true };
    if (body.isHistory === true && body.translateHistory !== true) return { text: '', source: body.source || 'auto', target, cached: false, skipped: true, history: true };
    if (translationInflight.has(inflightKey)) return translationInflight.get(inflightKey);
  }
  const requestSequence = ++translationRequestSequence;
  translationLatestRequest.set(inflightKey, requestSequence);
  const request = enqueueTranslationRemote(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${endpoint}/v1/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Geek-Client': '1' }, body: JSON.stringify({ text, source: body.source || 'auto', target, provider: body.provider || 'auto', route: body.route || 'default' }), signal: controller.signal });
      const raw = await response.text();
      let result; try { result = JSON.parse(raw); } catch { result = {}; }
      if (!response.ok) throw new Error(String(result.error || `翻译网关错误 ${response.status}`).slice(0, 300));
      if (!result.text || typeof result.text !== 'string') throw new Error('翻译网关返回格式错误');
      const translated = result.text;
      if (deletedTranslationPartitions.has(partition)) throw new Error('翻译账号已删除');
      if (translationLatestRequest.get(inflightKey) !== requestSequence) return { text: translated, source: result.source || body.source || 'auto', target: result.target || target, cached: false, superseded: true };
      const item = { text: translated, at: Date.now() };
      cache.set(key, item);
      await appendTranslationCache(partition, key, item);
      return { text: translated, source: result.source || body.source || 'auto', target: result.target || target, cached: false };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('翻译网关请求超时');
      throw error;
    } finally { clearTimeout(timer); }
  });
  translationInflight.set(inflightKey, request);
  try { return await request; } finally { if (translationInflight.get(inflightKey) === request) translationInflight.delete(inflightKey); }
}

function registerIpcHandlers() {
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
  ipcMain.handle('account-data:get-all', async (event, accountId) => {
    assertTrustedSender(event); const partition = resolveAccountPartition(accountId); const cache = await loadAccountData(partition); return Object.fromEntries(cache);
  });
  ipcMain.handle('account-data:set', async (event, accountId, key, value) => {
    assertTrustedSender(event); if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(key || ''))) throw new Error('账号数据键不合法');
    const raw = String(value ?? ''); if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) throw new Error('账号数据过大');
    const partition = resolveAccountPartition(accountId); const cache = await loadAccountData(partition); cache.set(key, raw); await appendAccountData(partition, key, raw); return true;
  });
  ipcMain.handle('account-data:remove', async (event, accountId, key) => {
    assertTrustedSender(event); if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(key || ''))) throw new Error('账号数据键不合法');
    const partition = resolveAccountPartition(accountId); const cache = await loadAccountData(partition); cache.delete(key); await appendAccountData(partition, key, '', true); return true;
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

  ipcMain.handle('accounts:list', async (event) => {
    assertTrustedSender(event);
    return publicState();
  });

  ipcMain.handle('accounts:add', addAccount);
  ipcMain.handle('accounts:remove', removeAccount);
  ipcMain.handle('accounts:switch', switchAccount);

  ipcMain.handle('accounts:update', async (event, accountId, patchData) => {
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
    if (raw.protocal === 'https' || raw.protocal === 'socks4' || raw.protocal === 'socks5') {
      account.protocal = raw.protocal;
    }
    if (typeof raw.host === 'string') account.host = raw.host;
    if (typeof raw.port === 'string') account.port = raw.port;
    if (typeof raw.huser === 'string') account.huser = raw.huser;
    if (typeof raw.hpwd === 'string') account.hpwd = raw.hpwd;

    await persistAccounts();
    await applyProxyForPartition(
      account.partition,
      account.openProxy ? account : null
    );
    notifyAccountsChanged();

    return publicState();
  });

  ipcMain.handle('accounts:move', async (event, accountId, direction) => {
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
  });

  // 拖拽排序：把账号移动到指定下标（对齐原版拖拽排序体验）
  ipcMain.handle('accounts:move-to', async (event, accountId, targetIndex) => {
    assertTrustedSender(event);
    assertValidAccountId(accountId);

    const index = accountsState.accounts.findIndex((item) => item.id === accountId);
    if (index === -1) {
      throw new Error('账号不存在');
    }
    let insertAt = Math.max(0, Math.min(accountsState.accounts.length - 1, targetIndex | 0));
    const [moved] = accountsState.accounts.splice(index, 1);
    // 目标位置在移除位置之后时，插入下标不变（因为前面的元素少了一个）
    accountsState.accounts.splice(insertAt, 0, moved);

    await persistAccounts();
    notifyAccountsChanged();

    return publicState();
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

  // 选择文件（群发附件）
  ipcMain.handle('file:pick', async (event) => {
    assertTrustedSender(event);
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要群发的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片/文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'mp4', 'mp3'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const files = [];
    for (const filePath of result.filePaths) {
      const data = await fs.readFile(filePath);
      files.push({
        name: path.basename(filePath),
        size: data.length,
        base64: data.toString('base64'),
        mime: guessMime(filePath),
        filePath: filePath // 真实路径（群发真实拖拽用）
      });
    }
    return files.length === 1 ? files[0] : files;
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
  ipcMain.handle('broadcast:send-file', async (event, payload) => {
    assertTrustedSender(event);
    const { partition, filePath, chatId, caption, mime, name } = payload || {};
    if (!partition || !filePath || !chatId) throw new Error('参数错误');
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, 'whatsapp');
      return await withExternalCdpSend(wsUrl, ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
    }
    return await internalCdp.run(partition, 'whatsapp', ({ send }) => waSendFileViaCdp(send, { filePath, chatId, caption }));
  });

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

  ipcMain.handle('broadcast:attach-file', async (event, payload) => {
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
  });

  // 群发附件：真实拖拽文件到账号页面（应用内 CDP；开发模式探测到 9344 时走外部 CDP）
  async function dropFileViaCdp({ send }, { filePath, mime, pos }) {
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

  ipcMain.handle('broadcast:drop-file', async (event, payload) => {
    assertTrustedSender(event);
    const { partition, filePath, mime, platform } = payload || {};
    if (!partition || !filePath) throw new Error('参数错误');
    const targetPlatform = platform || 'whatsapp';
    const pos = await getDropPos(partition);
    if (externalDebuggingActive) {
      const targets = await externalTargets();
      const wsUrl = findExternalTarget(targets, targetPlatform);
      return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));
    }
    return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));
  });
  // 选择 CSV 联系人文件（群发导入）
  ipcMain.handle('file:pick-csv', async (event) => {
    assertTrustedSender(event);
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择联系人 CSV 文件',
      properties: ['openFile'],
      filters: [
        { name: '联系人表格', extensions: ['csv', 'txt', 'xlsx', 'xls'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.read(await fs.readFile(filePath), { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
      return { name: path.basename(filePath), rows };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return { name: path.basename(filePath), content };
  });

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

function guessMime(p) {
  const ext = path.extname(p).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
  };
  return map[ext] || 'application/octet-stream';
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

    const hostname = parsedSource.hostname.toLowerCase();

    let customAllowed = false;
    if (account.type === 'website' && account.customUrl) {
      try {
        const customHost = new URL(account.customUrl).hostname.toLowerCase();
        customAllowed =
          hostname === customHost || hostname.endsWith(`.${customHost}`);
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

    if (!account || !config || !isAllowed) {
      event.preventDefault();
      return;
    }

    delete webPreferences.preloadURL;
    const isLine = account.type === 'line' || account.type === 'line-business';
    if (isLine) {
      // LINE 扩展页面兼容注入 —— 原版 s3loYR.js（chrome API mock + _pluginKD 补全）
      webPreferences.preload = path.join(__dirname, '..', 'resources', 's3loYR.js');
      webPreferences.contextIsolation = false;
    } else {
      // WhatsApp 保持原有无 preload 配置，避免旧版 1843 页面白屏。
      delete webPreferences.preload;
      webPreferences.contextIsolation = false;
    }

    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.userAgent = CHROME_USER_AGENT;

    params.src = config.url;
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
      : 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no';

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
    // WhatsApp 系列账号加载 HelloWorld 剥离的 WA 扩展（WAPlus——群发面板/完整功能）
    if (account.type === 'whatsapp' || account.type === 'whatsapp-pure') {
      loadWaplusExtension(partition);
    }
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
      console.log(`[wv] did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
      diagnostics.log('webview-load-failed', {
        partition: part,
        errorCode,
        errorDescription,
        url: validatedURL
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
      console.log(`[wv] did-navigate url=${url}`);
    });
    webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[wv] did-navigate-in-page url=${url}`);
    });

    // WhatsApp：页面加载完成后注入 WPP（内部 API 直发，对齐原版/HelloWorld）
    webContents.on('did-finish-load', async () => {
      const url = webContents.getURL() || '';
      if ((url.includes('web.whatsapp.com') || url.includes(`127.0.0.1:${WA_LOCAL_PORT}`)) && !wppInjected.has(part)) {
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
          config.hostnames.includes(hostname) ||
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
            const customHost = new URL(a.customUrl).hostname.toLowerCase();
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

app.whenReady().then(async () => {
  diagnostics.log('app-ready', { packaged: app.isPackaged, version: app.getVersion() });
  await probeExternalDebugging();
  diagnostics.log('cdp-mode', { externalDebugging: externalDebuggingActive });
  startWaLocalServer();
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
  createMainWindow();
  createTray();
  initAutoUpdater();
  watchSystemTheme();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // 退出时兜底清理：删除账号后因文件锁未删掉的分区目录
  app.on('will-quit', () => {
    diagnostics.log('app-will-quit', {});
    for (const dir of pendingPartitionDeletions) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
    }
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
  ipcMain.removeHandler('accounts:list');
  ipcMain.removeHandler('accounts:add');
  ipcMain.removeHandler('accounts:remove');
  ipcMain.removeHandler('accounts:switch');
  ipcMain.removeHandler('accounts:update');
  ipcMain.removeHandler('accounts:move');
  ipcMain.removeHandler('config:get');
  ipcMain.removeHandler('config:set');
  ipcMain.removeHandler('window:relaunch');
});
