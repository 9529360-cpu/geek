'use strict';

const CONFIG_GET_CHANNEL = 'config:get';
const CONFIG_SET_CHANNEL = 'config:set';

function installConfigIpc(options = {}) {
  const ipcMain = options.ipcMain;
  const assertTrustedSender = options.assertTrustedSender;
  const store = options.store;
  const onCommitted = typeof options.onCommitted === 'function' ? options.onCommitted : async () => {};
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') throw new TypeError('ipcMain is required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (!store || typeof store.getSnapshot !== 'function' || typeof store.update !== 'function') throw new TypeError('config store is required');

  let disposed = false;
  const getHandler = async event => {
    assertTrustedSender(event);
    return store.getSnapshot();
  };
  const setHandler = async (event, patchData) => {
    assertTrustedSender(event);
    const snapshot = await store.update(patchData);
    await onCommitted(snapshot);
    return snapshot;
  };

  ipcMain.handle(CONFIG_GET_CHANNEL, getHandler);
  ipcMain.handle(CONFIG_SET_CHANNEL, setHandler);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      ipcMain.removeHandler(CONFIG_GET_CHANNEL);
      ipcMain.removeHandler(CONFIG_SET_CHANNEL);
    },
  };
}

module.exports = { installConfigIpc };
