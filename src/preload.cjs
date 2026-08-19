const { contextBridge, ipcRenderer } = require('electron');

const channels = Object.freeze({
  accounts: Object.freeze({
    list: 'accounts:list',
    add: 'accounts:add',
    remove: 'accounts:remove',
    switch: 'accounts:switch',
    update: 'accounts:update',
    move: 'accounts:move',
  }),
  config: Object.freeze({
    get: 'config:get',
    set: 'config:set',
  }),
});

const SUBSCRIPTION_ERROR_CODES = Object.freeze([
  'invalid_credentials',
  'password_reset_required',
  'account_disabled',
  'email_exists',
  'invalid_email',
  'password_length_invalid',
  'rate_limited',
  'invalid_plan',
  'SECURE_STORAGE_UNAVAILABLE',
  'SECURE_STORAGE_ENCRYPT_FAILED',
]);

function normalizeSubscriptionIpcError(error) {
  const message = String(error?.message || error || '');
  const known = SUBSCRIPTION_ERROR_CODES.find((code) => message.includes(code));
  if (known) return known;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|certificate|TLS/i.test(message)) {
    return 'network_error';
  }
  const http = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (http) return `http_${http[1]}`;
  return 'subscription_error';
}

async function invokeSubscription(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw new Error(normalizeSubscriptionIpcError(error));
  }
}

// ui/app.js historically calls the selected-file capability `filePath`.
// Keep that renderer-only shape for compatibility, but the value is now an opaque token.
function mapSelectedFile(file) {
  if (!file || typeof file !== 'object' || typeof file.token !== 'string') return null;
  return Object.freeze({
    name: String(file.name || ''),
    size: Number(file.size) || 0,
    mime: String(file.mime || 'application/octet-stream'),
    filePath: file.token,
  });
}

function mapSelectedFiles(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(mapSelectedFile).filter(Boolean));
  return mapSelectedFile(value);
}

function toFileTokenPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const result = { ...source, fileToken: String(source.fileToken || source.filePath || '') };
  delete result.filePath;
  return result;
}

contextBridge.exposeInMainWorld(
  'api',
  Object.freeze({
    accounts: Object.freeze({
      list: () => ipcRenderer.invoke(channels.accounts.list),

      add: (account) => ipcRenderer.invoke(channels.accounts.add, account),

      remove: (accountId) =>
        ipcRenderer.invoke(channels.accounts.remove, accountId),

      switch: (accountId) =>
        ipcRenderer.invoke(channels.accounts.switch, accountId),

      update: (accountId, patch) =>
        ipcRenderer.invoke(channels.accounts.update, accountId, patch),

      move: (accountId, direction) =>
        ipcRenderer.invoke(channels.accounts.move, accountId, direction),

      moveTo: (accountId, targetIndex) =>
        ipcRenderer.invoke('accounts:move-to', accountId, targetIndex),
    }),
    config: Object.freeze({
      get: () => ipcRenderer.invoke(channels.config.get),
      set: (patch) => ipcRenderer.invoke(channels.config.set, patch),
    }),
    platforms: Object.freeze({
      list: () => ipcRenderer.invoke('platforms:list'),
    }),
    line: Object.freeze({
      onExtensionReady: (callback) => {
        ipcRenderer.on('line:extension-ready', (_event, partition) => callback(partition));
      },
    }),
    translation: Object.freeze({
      translate: (payload) => ipcRenderer.invoke('translation:translate', payload),
      health: () => ipcRenderer.invoke('translation:health'),
    }),
    webviewInput: Object.freeze({
      register: (accountId, guestId, token) => ipcRenderer.invoke('webview:register', accountId, guestId, token),
      insertText: (accountId, guestId, text, token) => ipcRenderer.invoke('webview:insert-text', accountId, guestId, text, token),
    }),
    bridge: Object.freeze({
      preloadPath: () => ipcRenderer.invoke('bridge:get-preload-path'),
    }),
    accountData: Object.freeze({
      getAll: (accountId) => ipcRenderer.invoke('account-data:get-all', accountId),
      set: (accountId, key, value) => ipcRenderer.invoke('account-data:set', accountId, key, value),
      remove: (accountId, key) => ipcRenderer.invoke('account-data:remove', accountId, key),
    }),
    window: Object.freeze({
      relaunch: () => ipcRenderer.invoke('window:relaunch'),
      minimize: () => ipcRenderer.invoke('window:minimize'),
      maximize: () => ipcRenderer.invoke('window:maximize'),
      close: () => ipcRenderer.invoke('window:close'),
    }),
    notify: Object.freeze({
      show: (payload) => ipcRenderer.invoke('notify:show', payload),
    }),
    updater: Object.freeze({
      install: () => ipcRenderer.invoke('updater:install'),
      onStatus: (callback) => {
        ipcRenderer.on('updater:status', (_event, status) => callback(status));
      },
    }),
    theme: Object.freeze({
      getSystem: () => ipcRenderer.invoke('theme:get-system'),
      onSystemChanged: (callback) => {
        ipcRenderer.on('theme:system-changed', (_event, theme) => callback(theme));
      },
    }),
    file: Object.freeze({
      pick: async () => mapSelectedFiles(await ipcRenderer.invoke('file:pick-token')),
      pickCsv: () => ipcRenderer.invoke('file:pick-csv-limited'),
      save: (payload) => ipcRenderer.invoke('file:save', payload),
    }),
    broadcast: Object.freeze({
      dropFile: (payload) => ipcRenderer.invoke('broadcast:drop-file-token', toFileTokenPayload(payload)),
      attachFile: (payload) => ipcRenderer.invoke('broadcast:attach-file-token', toFileTokenPayload(payload)),
      sendFile: (payload) => ipcRenderer.invoke('broadcast:send-file-token', toFileTokenPayload(payload)),
    }),
    tray: Object.freeze({
      onLock: (callback) => {
        ipcRenderer.on('tray:lock', () => callback());
      },
    }),
    subscription: Object.freeze({
      getState: () => invokeSubscription('subscription:get-state'),
      refresh: () => invokeSubscription('subscription:refresh'),
      login: (email, password) => invokeSubscription('subscription:login', email, password),
      register: (email, password) => invokeSubscription('subscription:register', email, password),
      createOrder: (plan) => invokeSubscription('subscription:create-order', plan),
      getQuota: (force) => invokeSubscription('subscription:get-quota', force === true),
      logout: () => invokeSubscription('subscription:logout'),
      enterApp: () => invokeSubscription('subscription:enter-app'),
      closeWindow: () => invokeSubscription('subscription:close-window'),
    }),
  }),
);
