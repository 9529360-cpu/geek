'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { assertMainFrameIpcSender } = require('./main-frame-ipc-boundary.cjs');

const LINE_DOWNLOAD_IPC_CHANNELS = Object.freeze([
  'line-download:begin',
  'line-download:chunk',
  'line-download:finish',
  'line-download:cancel',
]);

const LINE_EXTENSION_URL = /^chrome-extension:\/\/ophjlpahpchlmihnnnihgmmeilfjmjjc\//;
const MAX_LINE_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_LINE_DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const MAX_ACTIVE_PER_GUEST = 2;
const TRANSFER_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

function createLineDownloadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeLineDownloadFilename(value) {
  let name = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!name) name = 'download';
  name = name.slice(0, 180).replace(/[. ]+$/g, '') || 'download';

  const stem = name.split('.')[0];
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) name = `_${name}`;
  return name;
}

function toBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw createLineDownloadError('LINE_DOWNLOAD_CHUNK_INVALID', 'LINE 下载数据块不合法');
}

function installLineDownloadIpc(options = {}) {
  const {
    ipcMain,
    accountState,
    webviewOwnership,
    getSessionForPartition,
    getMainWindow,
    dialog,
    fs,
    getDownloadsDir,
    pathModule = path,
    idFactory = () => crypto.randomUUID(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain handle/removeHandler API is required');
  }
  if (!accountState || typeof accountState.findById !== 'function' || typeof accountState.resolvePartition !== 'function') {
    throw new TypeError('accountState find/resolve authority is required');
  }
  if (!webviewOwnership || typeof webviewOwnership.bindingForGuest !== 'function') {
    throw new TypeError('webviewOwnership binding authority is required');
  }
  if (typeof getSessionForPartition !== 'function') throw new TypeError('getSessionForPartition is required');
  if (typeof getMainWindow !== 'function') throw new TypeError('getMainWindow is required');
  if (!dialog || typeof dialog.showSaveDialog !== 'function') throw new TypeError('dialog is required');
  if (!fs || typeof fs.mkdir !== 'function' || typeof fs.open !== 'function' || typeof fs.unlink !== 'function') {
    throw new TypeError('fs promises adapter is required');
  }
  if (typeof getDownloadsDir !== 'function') throw new TypeError('getDownloadsDir is required');

  const handlers = new Set();
  const transfers = new Map();
  const pendingBegins = new Map();
  const cleanupBoundSenders = new WeakSet();
  let disposed = false;

  const transferFor = (id, senderId) => {
    const transfer = transfers.get(String(id || ''));
    if (!transfer || transfer.senderId !== Number(senderId)) {
      throw createLineDownloadError('LINE_DOWNLOAD_TRANSFER_NOT_FOUND', 'LINE 下载事务不存在');
    }
    return transfer;
  };

  const clearTransferTimer = (transfer) => {
    if (!transfer?.timer) return;
    try { clearTimeoutFn(transfer.timer); } catch {}
    transfer.timer = null;
  };

  const cleanupTransfer = async (transfer, { removeFile = true } = {}) => {
    if (!transfer) return;
    transfers.delete(transfer.id);
    clearTransferTimer(transfer);
    if (!transfer.closed) {
      transfer.closed = true;
      try { await transfer.handle.close(); } catch {}
    }
    if (removeFile && transfer.filePath) {
      try { await fs.unlink(transfer.filePath); } catch {}
    }
  };

  const armTransferTimer = (transfer) => {
    clearTransferTimer(transfer);
    transfer.timer = setTimeoutFn(() => {
      void cleanupTransfer(transfer, { removeFile: true });
    }, TRANSFER_IDLE_TIMEOUT_MS);
    try { transfer.timer?.unref?.(); } catch {}
  };

  const cleanupSender = async (senderId) => {
    const active = [...transfers.values()].filter(item => item.senderId === Number(senderId));
    await Promise.all(active.map(item => cleanupTransfer(item, { removeFile: true })));
  };

  const bindSenderCleanup = (sender) => {
    if (!sender || cleanupBoundSenders.has(sender) || typeof sender.once !== 'function') return;
    cleanupBoundSenders.add(sender);
    sender.once('destroyed', () => {
      void cleanupSender(sender.id);
    });
  };

  const authorizeSender = (event) => {
    assertMainFrameIpcSender(event);
    const sender = event.sender;
    const binding = webviewOwnership.bindingForGuest(sender.id);
    const reject = () => {
      throw createLineDownloadError('LINE_DOWNLOAD_SENDER_UNAUTHORIZED', 'LINE 下载页面未授权');
    };
    if (!binding) reject();

    const account = accountState.findById(binding.accountId);
    let partition = '';
    try { partition = accountState.resolvePartition(binding.accountId); } catch { reject(); }

    let hostId = 0;
    let url = '';
    try {
      hostId = Number(sender.hostWebContents?.id || 0);
      url = String(sender.getURL?.() || '');
    } catch {
      reject();
    }

    if (!account
      || (account.type !== 'line' && account.type !== 'line-business')
      || String(account.partition || '') !== partition
      || binding.partition !== partition
      || hostId !== binding.senderId
      || sender.session !== getSessionForPartition(partition)
      || !LINE_EXTENSION_URL.test(url)) {
      reject();
    }

    bindSenderCleanup(sender);
    return { sender, account, partition };
  };

  const openUniqueDownload = async (downloadsDir, filename) => {
    await fs.mkdir(downloadsDir, { recursive: true });
    const ext = pathModule.extname(filename);
    const stem = ext ? filename.slice(0, -ext.length) : filename;
    for (let index = 0; index < 10000; index += 1) {
      const candidateName = index === 0 ? filename : `${stem} (${index})${ext}`;
      const filePath = pathModule.join(downloadsDir, candidateName);
      try {
        const handle = await fs.open(filePath, 'wx');
        return { filePath, handle };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    throw createLineDownloadError('LINE_DOWNLOAD_FILENAME_EXHAUSTED', 'LINE 下载文件名冲突过多');
  };

  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, payload) => {
      if (disposed) throw createLineDownloadError('LINE_DOWNLOAD_OWNER_DISPOSED', 'LINE 下载边界已关闭');
      try {
        return await handler(event, payload || {});
      } catch (error) {
        const code = String(error?.code || '');
        if (/^LINE_DOWNLOAD_/.test(code) || code === 'MAIN_FRAME_IPC_SENDER_INVALID') throw error;
        throw createLineDownloadError('LINE_DOWNLOAD_IO_FAILED', 'LINE 下载写入失败');
      }
    });
    handlers.add(channel);
  };

  register('line-download:begin', async (event, payload) => {
    const { sender } = authorizeSender(event);
    const size = Number(payload.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LINE_DOWNLOAD_BYTES) {
      throw createLineDownloadError('LINE_DOWNLOAD_SIZE_INVALID', 'LINE 下载文件大小不合法');
    }

    const activeForSender = [...transfers.values()].filter(item => item.senderId === sender.id).length;
    const pendingForSender = pendingBegins.get(sender.id) || 0;
    if (activeForSender + pendingForSender >= MAX_ACTIVE_PER_GUEST) {
      throw createLineDownloadError('LINE_DOWNLOAD_BUSY', 'LINE 下载任务过多');
    }
    const filename = sanitizeLineDownloadFilename(payload.filename);
    const rawDownloadsDir = String(getDownloadsDir() || '').trim();
    if (!rawDownloadsDir || !pathModule.isAbsolute(rawDownloadsDir)) {
      throw createLineDownloadError('LINE_DOWNLOAD_DIRECTORY_INVALID', 'LINE 下载目录不合法');
    }
    const downloadsDir = pathModule.resolve(rawDownloadsDir);
    pendingBegins.set(sender.id, pendingForSender + 1);

    try {
      const id = String(idFactory());
      if (!id || id.length > 128 || transfers.has(id)) {
        throw createLineDownloadError('LINE_DOWNLOAD_ID_INVALID', 'LINE 下载事务标识不合法');
      }

      let opened;
      if (payload.saveAs === true) {
        const result = await dialog.showSaveDialog(getMainWindow(), {
          title: '保存文件',
          defaultPath: pathModule.join(downloadsDir, filename),
        });
        if (result?.canceled || !result?.filePath) return { canceled: true, id: null };
        const selectedPath = String(result.filePath).trim();
        if (!pathModule.isAbsolute(selectedPath)) {
          throw createLineDownloadError('LINE_DOWNLOAD_PATH_INVALID', 'LINE 下载目标路径不合法');
        }
        const filePath = pathModule.resolve(selectedPath);
        opened = {
          filePath,
          handle: await fs.open(filePath, 'w'),
        };
      } else {
        opened = await openUniqueDownload(downloadsDir, filename);
      }

      const transfer = {
        id,
        senderId: sender.id,
        filePath: opened.filePath,
        handle: opened.handle,
        expectedSize: size,
        received: 0,
        nextSeq: 0,
        closed: false,
        timer: null,
      };
      transfers.set(id, transfer);
      armTransferTimer(transfer);
      return { canceled: false, id };
    } finally {
      const remaining = Math.max(0, (pendingBegins.get(sender.id) || 1) - 1);
      if (remaining) pendingBegins.set(sender.id, remaining);
      else pendingBegins.delete(sender.id);
    }
  });

  register('line-download:chunk', async (event, payload) => {
    const { sender } = authorizeSender(event);
    const transfer = transferFor(payload.id, sender.id);
    try {
      const seq = Number(payload.seq);
      if (!Number.isSafeInteger(seq) || seq !== transfer.nextSeq) {
        throw createLineDownloadError('LINE_DOWNLOAD_SEQUENCE_INVALID', 'LINE 下载数据块顺序不合法');
      }
      const bytes = toBuffer(payload.bytes);
      if (bytes.length <= 0 || bytes.length > MAX_LINE_DOWNLOAD_CHUNK_BYTES) {
        throw createLineDownloadError('LINE_DOWNLOAD_CHUNK_INVALID', 'LINE 下载数据块大小不合法');
      }
      if (transfer.received + bytes.length > transfer.expectedSize) {
        throw createLineDownloadError('LINE_DOWNLOAD_SIZE_MISMATCH', 'LINE 下载数据超过声明大小');
      }
      await transfer.handle.write(bytes);
      transfer.received += bytes.length;
      transfer.nextSeq += 1;
      armTransferTimer(transfer);
      return true;
    } catch (error) {
      await cleanupTransfer(transfer, { removeFile: true });
      throw error;
    }
  });

  register('line-download:finish', async (event, payload) => {
    const { sender } = authorizeSender(event);
    const transfer = transferFor(payload.id, sender.id);
    try {
      const seq = Number(payload.seq);
      if (!Number.isSafeInteger(seq) || seq !== transfer.nextSeq) {
        throw createLineDownloadError('LINE_DOWNLOAD_SEQUENCE_INVALID', 'LINE 下载结束序号不合法');
      }
      if (transfer.received !== transfer.expectedSize) {
        throw createLineDownloadError('LINE_DOWNLOAD_SIZE_MISMATCH', 'LINE 下载文件大小不匹配');
      }
      clearTransferTimer(transfer);
      if (typeof transfer.handle.sync === 'function') await transfer.handle.sync();
      await transfer.handle.close();
      transfer.closed = true;
      transfers.delete(transfer.id);
      return true;
    } catch (error) {
      await cleanupTransfer(transfer, { removeFile: true });
      throw error;
    }
  });

  register('line-download:cancel', async (event, payload) => {
    const { sender } = authorizeSender(event);
    const transfer = transfers.get(String(payload.id || ''));
    if (!transfer || transfer.senderId !== sender.id) return true;
    await cleanupTransfer(transfer, { removeFile: true });
    return true;
  });

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const channel of handlers) ipcMain.removeHandler(channel);
      handlers.clear();
      for (const transfer of [...transfers.values()]) {
        void cleanupTransfer(transfer, { removeFile: true });
      }
    },
  });
}

module.exports = {
  LINE_DOWNLOAD_IPC_CHANNELS,
  MAX_LINE_DOWNLOAD_BYTES,
  MAX_LINE_DOWNLOAD_CHUNK_BYTES,
  sanitizeLineDownloadFilename,
  installLineDownloadIpc,
};
