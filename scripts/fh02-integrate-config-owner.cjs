'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'src', 'main.cjs');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(oldText, newText);
}

replaceOnce(
  "const { createAccountStateStore, ACCOUNT_PARTITION_PREFIX } = require('./account-state.cjs');",
  "const { createAccountStateStore, ACCOUNT_PARTITION_PREFIX } = require('./account-state.cjs');\nconst { createConfigStateStore } = require('./config-state.cjs');\nconst { installConfigIpc } = require('./config-ipc.cjs');",
  'config imports'
);

replaceOnce(
  "// LINE 官方浏览器扩展（复刻项目自带副本，供 line / line-business 账号登录使用）",
  `const configStore = createConfigStateStore({
  fs,
  filePath: CONFIG_FILE,
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(String(value)).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(String(value), 'base64')),
  onRecoveryEvent: (error, meta) => {
    const code = typeof error?.code === 'string' ? error.code : String(error?.name || 'UNKNOWN');
    const phase = typeof meta?.phase === 'string' ? meta.phase : 'load';
    console.error(\`[config-state] \${phase} failed: \${code.slice(0, 80)} recovered=\${meta?.recovered === true ? 'yes' : 'no'}\`);
  },
});

// LINE 官方浏览器扩展（复刻项目自带副本，供 line / line-business 账号登录使用）`,
  'config store composition'
);

const defaultsStart = source.indexOf('const DEFAULT_CONFIG = {');
const publicStateStart = source.indexOf('function publicState(', defaultsStart);
if (defaultsStart < 0 || publicStateStart <= defaultsStart) throw new Error('legacy config state block not found');
source = source.slice(0, defaultsStart) + source.slice(publicStateStart);

const normalizeStart = source.indexOf('function normalizeConfig(raw) {');
const loginSettingsStart = source.indexOf('function applyLoginItemSettings()', normalizeStart);
if (normalizeStart < 0 || loginSettingsStart <= normalizeStart) throw new Error('legacy config persistence block not found');
source = source.slice(0, normalizeStart) + source.slice(loginSettingsStart);

replaceOnce(
  `function applyLoginItemSettings() {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: configState.autoLaunch,
      openAsHidden: configState.isStartupMinimize
    });`,
  `function applyLoginItemSettings(config = configStore.getSnapshot()) {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: config.autoLaunch,
      openAsHidden: config.isStartupMinimize
    });`,
  'login item settings'
);

replaceOnce(
  `  await applyProxyForPartition(
    account.partition,
    account.openProxy ? account : (configState.openProxy ? configState : null)
  );`,
  `  const globalConfig = configStore.getSnapshot();
  await applyProxyForPartition(
    account.partition,
    account.openProxy ? account : (globalConfig.openProxy ? globalConfig : null)
  );`,
  'account proxy fallback'
);

replaceOnce(
  'let accountIpcBoundary = null;',
  'let accountIpcBoundary = null;\nlet configIpcBoundary = null;',
  'config ipc lifecycle slot'
);

const configGetStart = source.indexOf("  ipcMain.handle('config:get'");
const relaunchStart = source.indexOf("  ipcMain.handle('window:relaunch'", configGetStart);
if (configGetStart < 0 || relaunchStart <= configGetStart) throw new Error('direct config IPC block not found');
const configOwnerInstall = `  configIpcBoundary = installConfigIpc({
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

`;
source = source.slice(0, configGetStart) + configOwnerInstall + source.slice(relaunchStart);

replaceOnce(
  `    const accountProxy = account.openProxy
      ? account
      : configState.openProxy
        ? configState
        : null;`,
  `    const globalConfig = configStore.getSnapshot();
    const accountProxy = account.openProxy
      ? account
      : globalConfig.openProxy
        ? globalConfig
        : null;`,
  'webview proxy fallback'
);

replaceOnce(
  'Promise.all([accountState.whenIdle(), configQueue])',
  'Promise.all([accountState.whenIdle(), configStore.whenIdle()])',
  'crash idle barrier'
);

replaceOnce(
  `  await accountState.load();
  await loadConfig();
  applyLoginItemSettings();`,
  `  await accountState.load();
  await configStore.load();
  applyLoginItemSettings(configStore.getSnapshot());`,
  'startup config load'
);

replaceOnce(
  `  accountIpcBoundary?.dispose();
  accountIpcBoundary = null;
  ipcMain.removeHandler('config:get');
  ipcMain.removeHandler('config:set');`,
  `  accountIpcBoundary?.dispose();
  accountIpcBoundary = null;
  configIpcBoundary?.dispose();
  configIpcBoundary = null;`,
  'config IPC teardown'
);

for (const forbidden of [
  /\blet configState\b/,
  /\blet configQueue\b/,
  /function normalizeConfig\s*\(/,
  /function loadConfig\s*\(/,
  /function persistConfig\s*\(/,
  /function safeDecrypt\s*\(/,
  /function safeEncrypt\s*\(/,
  /ipcMain\.handle\(['\"]config:/,
  /ipcMain\.removeHandler\(['\"]config:/,
]) {
  if (forbidden.test(source)) throw new Error(`forbidden legacy config ownership remains: ${forbidden}`);
}
if (!source.includes('createConfigStateStore({') || !source.includes('installConfigIpc({')) throw new Error('config owner composition missing');

fs.writeFileSync(file, source, 'utf8');
console.log('FH02_MAIN_CONFIG_OWNER_INTEGRATION_OK');
