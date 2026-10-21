'use strict';

const assert = require('node:assert/strict');

const { installDesktopIpc } = require('../src/desktop-ipc.cjs');

function harness(options = {}) {
  const handlers = new Map();
  const mainFrame = {};
  const sender = { id: 1, mainFrame };
  const boundary = installDesktopIpc({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    assertTrustedSender: () => {},
    app: { getVersion: () => '9.8.7', relaunch: () => {}, exit: () => {} },
    getMainWindow: () => null,
    platformCatalog: {},
    runtimeAssetAllowed: () => true,
    resourcesDir: '/runtime/resources',
    quitAndInstallForUpdate: () => 'UPDATE_RESULT',
    Notification: Object.assign(function Notification() {}, { isSupported: () => false }),
    nativeTheme: { shouldUseDarkColors: false },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    fs: { writeFile: async () => {} },
    collectPartitionMemorySample: options.collectPartitionMemorySample,
  });
  return {
    boundary,
    invoke: (channel, ...args) => handlers.get(channel)({ sender, senderFrame: mainFrame }, ...args),
  };
}

(async () => {
  const expected = { partitions: [], totals: { processCount: 0, workingSetSize: 0 } };
  const wired = harness({ collectPartitionMemorySample: () => expected });
  assert.equal(
    await wired.invoke('diagnostics:partition-memory-sample'),
    expected,
    'channel must return the injected sampler result',
  );
  wired.boundary.dispose();

  // Without an injected sampler the channel fails closed, it does not invent data.
  const missing = harness();
  await assert.rejects(
    missing.invoke('diagnostics:partition-memory-sample'),
    /partition memory sampling unavailable/,
  );
  missing.boundary.dispose();

  // A non-function sampler is rejected at install time.
  assert.throws(
    () => harness({ collectPartitionMemorySample: 'nope' }),
    /collectPartitionMemorySample is required to be a function/,
  );

  console.log('desktop-ipc-partition-memory contract: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
