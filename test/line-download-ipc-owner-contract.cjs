'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createOwnershipRegistry } = require('../src/webview-ownership.cjs');
const {
  LINE_DOWNLOAD_IPC_CHANNELS,
  MAX_LINE_DOWNLOAD_BYTES,
  installLineDownloadIpc,
  sanitizeLineDownloadFilename,
} = require('../src/line-download-ipc.cjs');

const PART = 'persist:webview-page-line-a';
const LINE_URL = 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html#/friends';

function createIpcMain() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, fn) { handlers.set(channel, fn); },
    removeHandler(channel) { removed.push(channel); handlers.delete(channel); },
    invoke(channel, sender, payload, senderFrame = sender.mainFrame) {
      const fn = handlers.get(channel);
      assert.equal(typeof fn, 'function', 'missing handler: ' + channel);
      return fn({ sender, senderFrame }, payload);
    },
  };
}

function createFs() {
  const opened = [];
  const unlinked = [];
  const mkdirs = [];
  const files = new Map();
  return {
    opened,
    unlinked,
    mkdirs,
    files,
    async mkdir(dir) { mkdirs.push(dir); },
    async open(filePath, flag) {
      if (flag === 'wx' && files.has(filePath)) {
        const error = new Error('exists');
        error.code = 'EEXIST';
        throw error;
      }
      const state = { filePath, flag, chunks: [], closed: false, synced: false };
      files.set(filePath, state);
      opened.push(state);
      return {
        async write(bytes) { state.chunks.push(Buffer.from(bytes)); },
        async sync() { state.synced = true; },
        async close() { state.closed = true; },
      };
    },
    async unlink(filePath) {
      unlinked.push(filePath);
      files.delete(filePath);
    },
  };
}

function createGuest({ id = 77, hostId = 101, session, url = LINE_URL } = {}) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    id,
    mainFrame: {},
    hostWebContents: { id: hostId },
    session,
    getURL: () => url,
  });
}

function createHarness(overrides = {}) {
  const ipcMain = createIpcMain();
  const fs = createFs();
  const lineSession = { partition: PART };
  const ownership = createOwnershipRegistry();
  const account = { id: 'line-a', type: 'line', partition: PART };
  const accountState = {
    findById(id) { return id === 'line-a' ? account : null; },
    resolvePartition(id) {
      if (id !== 'line-a') throw new Error('missing account');
      return PART;
    },
  };
  const dialogCalls = [];
  const dialog = {
    async showSaveDialog(_window, options) {
      dialogCalls.push(options);
      return { canceled: false, filePath: '/chosen/report.txt' };
    },
  };
  let seq = 0;
  const deps = {
    ipcMain,
    accountState,
    webviewOwnership: ownership,
    getSessionForPartition: partition => partition === PART ? lineSession : null,
    getMainWindow: () => ({ id: 1 }),
    dialog,
    fs,
    getDownloadsDir: () => '/downloads',
    pathModule: path.posix,
    idFactory: () => 'download-' + (++seq),
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn() {},
    ...overrides,
  };
  const owner = installLineDownloadIpc(deps);
  const guest = createGuest({ session: lineSession });
  const register = () => ownership.register({
    guestId: guest.id,
    accountId: 'line-a',
    partition: PART,
    token: '0123456789abcdef0123456789abcdef',
    senderId: guest.hostWebContents.id,
    now: 1000,
  });
  return { ipcMain, fs, lineSession, ownership, account, accountState, dialogCalls, owner, guest, register };
}

async function rejects(promise, predicate) {
  await assert.rejects(promise, predicate);
}

(async () => {
  assert.equal(MAX_LINE_DOWNLOAD_BYTES, 2 ** 30, 'LINE 3.5.1 supports files up to 1 GiB');
  assert.equal(sanitizeLineDownloadFilename('../probe.txt'), 'probe.txt');
  assert.equal(sanitizeLineDownloadFilename('..\\nested\\report?.txt'), 'report_.txt');
  assert.equal(sanitizeLineDownloadFilename('CON'), '_CON');
  assert.equal(sanitizeLineDownloadFilename('   '), 'download');

  {
    const h = createHarness();
    assert.deepEqual([...h.ipcMain.handlers.keys()], LINE_DOWNLOAD_IPC_CHANNELS);
    await rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, { filename: 'a.txt', size: 1, saveAs: false }),
      error => error?.code === 'LINE_DOWNLOAD_SENDER_UNAUTHORIZED',
    );
  }

  {
    const h = createHarness();
    h.register();
    await rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, { filename: 'a.txt', size: 1 }, {}),
      error => error?.code === 'MAIN_FRAME_IPC_SENDER_INVALID',
    );
    h.guest.hostWebContents.id = 999;
    await rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, { filename: 'a.txt', size: 1 }),
      error => error?.code === 'LINE_DOWNLOAD_SENDER_UNAUTHORIZED',
    );
  }

  {
    const h = createHarness();
    h.register();
    h.guest.session = {};
    await rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, { filename: 'a.txt', size: 1 }),
      error => error?.code === 'LINE_DOWNLOAD_SENDER_UNAUTHORIZED',
    );
  }

  {
    const h = createHarness();
    h.account.type = 'telegram';
    h.register();
    await rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, { filename: 'a.txt', size: 1 }),
      error => error?.code === 'LINE_DOWNLOAD_SENDER_UNAUTHORIZED',
    );
  }

  {
    const h = createHarness();
    h.register();
    const max = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'max.bin',
      size: MAX_LINE_DOWNLOAD_BYTES,
      saveAs: false,
    });
    assert.ok(max.id);
    await h.ipcMain.invoke('line-download:cancel', h.guest, { id: max.id });
  }

  {
    const h = createHarness();
    h.register();
    await assert.rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, {
        filename: 'too-large.bin',
        size: MAX_LINE_DOWNLOAD_BYTES + 1,
        saveAs: false,
      }),
      error => error?.code === 'LINE_DOWNLOAD_SIZE_INVALID',
    );
    assert.equal(h.fs.opened.length, 0);
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: '../probe.txt',
      size: 5,
      saveAs: false,
    });
    assert.deepEqual(begin, { canceled: false, id: 'download-1' });
    assert.equal(h.fs.opened[0].filePath, '/downloads/probe.txt');
    await h.ipcMain.invoke('line-download:chunk', h.guest, {
      id: begin.id,
      seq: 0,
      bytes: new Uint8Array(Buffer.from('hello')),
    });
    await h.ipcMain.invoke('line-download:finish', h.guest, { id: begin.id, seq: 1 });
    const state = h.fs.opened[0];
    assert.equal(Buffer.concat(state.chunks).toString('utf8'), 'hello');
    assert.equal(state.synced, true);
    assert.equal(state.closed, true);
    assert.deepEqual(h.fs.unlinked, []);
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'bad.txt',
      size: 2,
      saveAs: false,
    });
    await rejects(
      h.ipcMain.invoke('line-download:chunk', h.guest, {
        id: begin.id,
        seq: 1,
        bytes: new Uint8Array([1]),
      }),
      error => error?.code === 'LINE_DOWNLOAD_SEQUENCE_INVALID',
    );
    assert.deepEqual(h.fs.unlinked, ['/downloads/bad.txt']);
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'cancel.txt',
      size: 3,
      saveAs: false,
    });
    await h.ipcMain.invoke('line-download:chunk', h.guest, {
      id: begin.id,
      seq: 0,
      bytes: new Uint8Array([1]),
    });
    await h.ipcMain.invoke('line-download:cancel', h.guest, { id: begin.id });
    assert.deepEqual(h.fs.unlinked, ['/downloads/cancel.txt']);
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'destroyed.txt',
      size: 3,
      saveAs: false,
    });
    h.guest.emit('destroyed');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.fs.unlinked, ['/downloads/destroyed.txt']);
    await assert.rejects(
      h.ipcMain.invoke('line-download:finish', h.guest, { id: begin.id, seq: 0 }),
      error => error?.code === 'LINE_DOWNLOAD_TRANSFER_NOT_FOUND',
    );
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: '../report.txt',
      size: 0,
      saveAs: true,
    });
    assert.equal(h.dialogCalls.length, 1);
    assert.equal(h.dialogCalls[0].defaultPath, '/downloads/report.txt');
    assert.equal(h.fs.opened[0].filePath, '/chosen/report.txt');
    await h.ipcMain.invoke('line-download:finish', h.guest, { id: begin.id, seq: 0 });
  }

  {
    const h = createHarness({
      dialog: { async showSaveDialog() { return { canceled: true }; } },
    });
    h.register();
    const result = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'cancel-save-as.txt',
      size: 0,
      saveAs: true,
    });
    assert.deepEqual(result, { canceled: true, id: null });
    assert.equal(h.fs.opened.length, 0);
  }

  {
    const h = createHarness();
    h.register();
    const begin = await h.ipcMain.invoke('line-download:begin', h.guest, {
      filename: 'dispose.txt',
      size: 1,
      saveAs: false,
    });
    h.owner.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.ipcMain.handlers.size, 0);
    assert.deepEqual(h.fs.unlinked, ['/downloads/dispose.txt']);
    assert.ok(begin.id);
  }


  {
    const h = createHarness({ getDownloadsDir: () => '' });
    h.register();
    await assert.rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, {
        filename: 'bad-root.txt',
        size: 0,
        saveAs: false,
      }),
      error => error?.code === 'LINE_DOWNLOAD_DIRECTORY_INVALID',
    );
  }

  {
    const h = createHarness({
      dialog: {
        async showSaveDialog() {
          return { canceled: false, filePath: 'relative.txt' };
        },
      },
    });
    h.register();
    await assert.rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, {
        filename: 'relative.txt',
        size: 0,
        saveAs: true,
      }),
      error => error?.code === 'LINE_DOWNLOAD_PATH_INVALID',
    );
  }


  {
    const h = createHarness({ idFactory: () => '' });
    h.register();
    await assert.rejects(
      h.ipcMain.invoke('line-download:begin', h.guest, {
        filename: 'no-side-effect.txt',
        size: 0,
        saveAs: false,
      }),
      error => error?.code === 'LINE_DOWNLOAD_ID_INVALID',
    );
    assert.equal(h.fs.opened.length, 0);
    assert.equal(h.dialogCalls.length, 0);
  }

  console.log('LINE_DOWNLOAD_IPC_OWNER_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
