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
  'invalid_order_id',
  'SECURE_STORAGE_UNAVAILABLE',
  'SECURE_STORAGE_ENCRYPT_FAILED',
]);
const TRANSLATION_ERROR_ENVELOPE_PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';

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

function translationErrorEnvelope(detail = {}) {
  const payload = {
    code: String(detail.code || 'TRANSLATION_FAILED').slice(0, 100),
    message: String(detail.message || '翻译请求失败').slice(0, 300),
    category: String(detail.category || 'gateway').slice(0, 64),
    retryable: detail.retryable === true,
  };
  if (Number.isInteger(detail.status)) payload.status = detail.status;
  return TRANSLATION_ERROR_ENVELOPE_PREFIX + JSON.stringify(payload);
}

function unwrapTranslationIpcResponse(response) {
  // Compatibility for a mixed old-main/new-preload process during restart or
  // development: old main returned the translation result directly.
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') return response;
  if (response.ok) return response.result;
  const detail = response.error && typeof response.error === 'object' ? response.error : {};
  const humanMessage = String(detail.message || '翻译请求失败').slice(0, 300);
  // ui/app.js intentionally exposes only the Error message to an untrusted
  // guest page. Carry a bounded, privacy-safe envelope in that message so the
  // WebView can recover code/category/status without receiving tokens, headers,
  // provider credentials or arbitrary main-process error objects.
  const error = new Error(translationErrorEnvelope({ ...detail, message: humanMessage }));
  error.userMessage = humanMessage;
  error.code = String(detail.code || 'TRANSLATION_FAILED');
  error.category = String(detail.category || 'gateway');
  error.retryable = detail.retryable === true;
  if (Number.isInteger(detail.status)) error.status = detail.status;
  throw error;
}

async function invokeTranslation(payload) {
  return unwrapTranslationIpcResponse(await ipcRenderer.invoke('translation:translate', payload));
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

function selectedFileTokens(value) {
  const files = Array.isArray(value) ? value : value ? [value] : [];
  return files.map(file => typeof file === 'string'
    ? file
    : String(file?.filePath || file?.token || '')).map(String).filter(Boolean);
}

async function releaseSelectedFiles(value) {
  const tokens = selectedFileTokens(value);
  if (!tokens.length) return 0;
  return ipcRenderer.invoke('file:release-tokens', tokens);
}

async function pickSelectedFiles(options) {
  const mapped = mapSelectedFiles(await ipcRenderer.invoke('file:pick-token'));
  if (!mapped || options?.multiple !== true || typeof document === 'undefined') return mapped;
  const occupied = document.querySelectorAll('#broadcast-files .bf-item').length;
  const remaining = Math.max(0, 10 - occupied);
  if (Array.isArray(mapped)) {
    const accepted = mapped.slice(0, remaining);
    const overflow = mapped.slice(remaining);
    if (overflow.length) await releaseSelectedFiles(overflow);
    return Object.freeze(accepted);
  }
  if (remaining > 0) return mapped;
  await releaseSelectedFiles(mapped);
  return null;
}

function mapScheduledRef(file) {
  if (!file || typeof file !== 'object' || typeof file.ref !== 'string') return null;
  return Object.freeze({
    ref: file.ref,
    name: String(file.name || ''),
    size: Number(file.size) || 0,
    mime: String(file.mime || 'application/octet-stream'),
  });
}

function mapScheduledRefs(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map(mapScheduledRef).filter(Boolean));
}

function mapMaterializedFile(file) {
  if (!file || typeof file !== 'object' || typeof file.token !== 'string') return null;
  return Object.freeze({
    token: file.token,
    name: String(file.name || ''),
    size: Number(file.size) || 0,
    mime: String(file.mime || 'application/octet-stream'),
  });
}

function mapMaterializedFiles(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map(mapMaterializedFile).filter(Boolean));
}

function toFileTokenPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const result = { ...source, fileToken: String(source.fileToken || source.filePath || '') };
  delete result.filePath;
  return result;
}

function toTelegramFilesTokenPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const files = Array.isArray(source.files) ? source.files : [];
  return {
    partition: String(source.partition || ''),
    guestId: Number(source.guestId),
    targetChatId: String(source.targetChatId || ''),
    caption: String(source.caption || ''),
    fileTokens: files.map((file) => String(file?.fileToken || file?.filePath || '')),
  };
}

function toScheduledPersistPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const files = Array.isArray(source.files) ? source.files : [];
  const explicitTokens = Array.isArray(source.fileTokens) ? source.fileTokens : [];
  return {
    accountId: String(source.accountId || ''),
    taskId: String(source.taskId || ''),
    fileTokens: explicitTokens.length
      ? explicitTokens.map(token => String(token || ''))
      : files.map(file => String(file?.fileToken || file?.filePath || '')),
  };
}

function toScheduledMaterializePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const refs = Array.isArray(source.refs) ? source.refs : [];
  return {
    accountId: String(source.accountId || ''),
    taskId: String(source.taskId || ''),
    refs: refs.map(item => String(typeof item === 'string' ? item : item?.ref || '')),
  };
}

function toScheduledCleanupPayload(payload, taskId) {
  if (payload && typeof payload === 'object') {
    return { accountId: String(payload.accountId || ''), taskId: String(payload.taskId || '') };
  }
  return { accountId: String(payload || ''), taskId: String(taskId || '') };
}

contextBridge.exposeInMainWorld(
  'api',
  Object.freeze({
    app: Object.freeze({ version: () => ipcRenderer.invoke('app:get-version') }),
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
      translate: (payload) => invokeTranslation(payload),
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
      pick: (options) => pickSelectedFiles(options),
      release: (value) => releaseSelectedFiles(value),
      pickCsv: () => ipcRenderer.invoke('file:pick-csv-limited'),
      save: (payload) => ipcRenderer.invoke('file:save', payload),
    }),
    broadcast: Object.freeze({
      dropFile: (payload) => ipcRenderer.invoke('broadcast:drop-file-token', toFileTokenPayload(payload)),
      attachFile: (payload) => ipcRenderer.invoke('broadcast:attach-file-token', toFileTokenPayload(payload)),
      sendFile: (payload) => ipcRenderer.invoke('broadcast:send-file-token', toFileTokenPayload(payload)),
      sendTelegramAttachments: (payload) => ipcRenderer.invoke('broadcast:telegram-files-token', toTelegramFilesTokenPayload(payload)),
    }),
    broadcastScheduled: Object.freeze({
      persist: async (payload) => mapScheduledRefs(await ipcRenderer.invoke('broadcast-scheduled-attachments:persist', toScheduledPersistPayload(payload))),
      materialize: async (payload) => mapMaterializedFiles(await ipcRenderer.invoke('broadcast-scheduled-attachments:materialize', toScheduledMaterializePayload(payload))),
      cleanup: (payload, taskId) => ipcRenderer.invoke('broadcast-scheduled-attachments:cleanup', toScheduledCleanupPayload(payload, taskId)),
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
      getOrderStatus: (orderId) => invokeSubscription('subscription:get-order-status', orderId),
      getQuota: (force) => invokeSubscription('subscription:get-quota', force === true),
      logout: () => invokeSubscription('subscription:logout'),
      enterApp: () => invokeSubscription('subscription:enter-app'),
      closeWindow: () => invokeSubscription('subscription:close-window'),
    }),
  }),
);
