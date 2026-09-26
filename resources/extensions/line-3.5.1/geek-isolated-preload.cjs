'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const MAX_LINE_DOWNLOAD_BYTES = 2 ** 30;
const MAX_LINE_DOWNLOAD_CHUNK_BYTES = 1024 * 1024;

function downloadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertBlob(blob) {
  const size = Number(blob?.size);
  if (!blob
    || !Number.isSafeInteger(size)
    || size < 0
    || size > MAX_LINE_DOWNLOAD_BYTES
    || (typeof blob.stream !== 'function' && typeof blob.arrayBuffer !== 'function')) {
    throw downloadError('LINE_DOWNLOAD_BLOB_INVALID', 'LINE 下载 Blob 不合法');
  }
  return size;
}

async function* blobChunks(blob) {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const bytes = value instanceof Uint8Array
        ? value
        : new Uint8Array(value?.buffer || value);
      for (let offset = 0; offset < bytes.byteLength; offset += MAX_LINE_DOWNLOAD_CHUNK_BYTES) {
        yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + MAX_LINE_DOWNLOAD_CHUNK_BYTES));
      }
    }
  } else {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_LINE_DOWNLOAD_CHUNK_BYTES) {
      yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + MAX_LINE_DOWNLOAD_CHUNK_BYTES));
    }
  }
}

async function saveBlob(blob, filename, saveAs) {
  const size = assertBlob(blob);
  const begin = await ipcRenderer.invoke('line-download:begin', {
    filename: String(filename || ''),
    size,
    saveAs: saveAs === true,
  });
  if (begin?.canceled === true || !begin?.id) return null;

  const id = String(begin.id);
  let seq = 0;
  try {
    for await (const bytes of blobChunks(blob)) {
      if (!bytes.byteLength) continue;
      await ipcRenderer.invoke('line-download:chunk', { id, seq, bytes });
      seq += 1;
    }
    await ipcRenderer.invoke('line-download:finish', { id, seq });
    return 1;
  } catch (error) {
    try { await ipcRenderer.invoke('line-download:cancel', { id }); } catch {}
    throw error;
  }
}

contextBridge.exposeInMainWorld('GeekLineDownloads', Object.freeze({
  saveBlob,
}));
