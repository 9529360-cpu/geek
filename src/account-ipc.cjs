'use strict';

const ACCOUNT_IPC_CHANNELS = Object.freeze({
  list: 'accounts:list',
  add: 'accounts:add',
  remove: 'accounts:remove',
  switch: 'accounts:switch',
  update: 'accounts:update',
  move: 'accounts:move',
  moveTo: 'accounts:move-to',
});

function normalizeAccountAddPayload(payload) {
  if (typeof payload === 'string') return { name: payload };
  return payload || {};
}

function installAccountIpc(options = {}) {
  const { ipcMain, assertTrustedSender } = options;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');

  const callbacks = {
    list: options.listAccounts,
    add: options.addAccount,
    remove: options.removeAccount,
    switch: options.switchAccount,
    update: options.updateAccount,
    move: options.moveAccount,
    moveTo: options.moveAccountTo,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== 'function') throw new TypeError(`${name} account callback is required`);
  }

  const registeredChannels = new Set();
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    registeredChannels.add(channel);
  };
  const guarded = (callback) => async (event, ...args) => {
    assertTrustedSender(event);
    return callback(event, ...args);
  };

  register(ACCOUNT_IPC_CHANNELS.list, guarded(callbacks.list));
  register(ACCOUNT_IPC_CHANNELS.add, async (event, payload) => {
    assertTrustedSender(event);
    const normalized = normalizeAccountAddPayload(payload);
    return callbacks.add(event, normalized);
  });
  register(ACCOUNT_IPC_CHANNELS.remove, guarded(callbacks.remove));
  register(ACCOUNT_IPC_CHANNELS.switch, guarded(callbacks.switch));
  register(ACCOUNT_IPC_CHANNELS.update, guarded(callbacks.update));
  register(ACCOUNT_IPC_CHANNELS.move, guarded(callbacks.move));
  register(ACCOUNT_IPC_CHANNELS.moveTo, guarded(callbacks.moveTo));

  return Object.freeze({
    dispose() {
      if (typeof ipcMain.removeHandler !== 'function') return;
      for (const channel of registeredChannels) ipcMain.removeHandler(channel);
      registeredChannels.clear();
    },
  });
}

module.exports = {
  ACCOUNT_IPC_CHANNELS,
  installAccountIpc,
  normalizeAccountAddPayload,
};
