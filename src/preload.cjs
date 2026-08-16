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
    theme: Object.freeze({
      getSystem: () => ipcRenderer.invoke('theme:get-system'),
      onSystemChanged: (callback) => {
        ipcRenderer.on('theme:system-changed', (_event, theme) => callback(theme));
      },
    }),
    file: Object.freeze({
      pick: () => ipcRenderer.invoke('file:pick'),
      pickCsv: () => ipcRenderer.invoke('file:pick-csv'),
      save: (payload) => ipcRenderer.invoke('file:save', payload),
    }),
    broadcast: Object.freeze({
      dropFile: (payload) => ipcRenderer.invoke('broadcast:drop-file', payload),
      attachFile: (payload) => ipcRenderer.invoke('broadcast:attach-file', payload),
      sendFile: (payload) => ipcRenderer.invoke('broadcast:send-file', payload),
    }),
    tray: Object.freeze({
      onLock: (callback) => {
        ipcRenderer.on('tray:lock', () => callback());
      },
    }),
  }),
);
