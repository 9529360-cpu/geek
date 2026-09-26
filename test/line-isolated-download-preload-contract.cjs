'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(
  __dirname,
  '../resources/extensions/line-3.5.1/geek-isolated-preload.cjs',
);
const source = fs.readFileSync(file, 'utf8');

assert.match(source, /contextBridge\.exposeInMainWorld\(['"]GeekLineDownloads['"]/);
assert.doesNotMatch(source, /exposeInMainWorld\([^\n]+ipcRenderer/);
assert.match(source, /line-download:begin/);
assert.match(source, /line-download:chunk/);
assert.match(source, /line-download:finish/);
assert.match(source, /line-download:cancel/);

async function loadPreload({ failChunk = false } = {}) {
  const calls = [];
  let exposed = null;
  const contextBridge = {
    exposeInMainWorld(name, api) {
      assert.equal(name, 'GeekLineDownloads');
      exposed = api;
    },
  };
  const ipcRenderer = {
    async invoke(channel, payload) {
      calls.push([channel, payload]);
      if (channel === 'line-download:begin') return { canceled: false, id: 'download-1' };
      if (channel === 'line-download:chunk' && failChunk) throw new Error('chunk failed');
      return true;
    },
  };
  const sandbox = {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge, ipcRenderer };
    },
    Uint8Array,
    ArrayBuffer,
    Promise,
    Object,
    Number,
    String,
    Error,
  };
  vm.runInNewContext(source, sandbox, { filename: file });
  assert.ok(exposed);
  return { calls, api: exposed };
}

function createSizedEmptyBlob(size) {
  return {
    size,
    stream() {
      return { getReader: () => ({ async read() { return { done: true, value: undefined }; } }) };
    },
  };
}

function createBlob(chunks) {
  const normalized = chunks.map(value => new Uint8Array(value));
  return {
    size: normalized.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    stream() {
      let index = 0;
      return {
        getReader() {
          return {
            async read() {
              if (index >= normalized.length) return { done: true, value: undefined };
              return { done: false, value: normalized[index++] };
            },
          };
        },
      };
    },
  };
}

(async () => {
  {
    const { calls, api } = await loadPreload();
    const result = await api.saveBlob(
      createBlob([[1, 2], [3, 4, 5]]),
      '../probe.txt',
      true,
    );
    assert.equal(result, 1);
    assert.deepEqual(calls.map(([channel]) => channel), [
      'line-download:begin',
      'line-download:chunk',
      'line-download:chunk',
      'line-download:finish',
    ]);
    assert.equal(calls[0][1].filename, '../probe.txt');
    assert.equal(calls[0][1].size, 5);
    assert.equal(calls[0][1].saveAs, true);
    assert.equal(calls[1][1].id, 'download-1');
    assert.equal(calls[1][1].seq, 0);
    assert.deepEqual(Array.from(calls[1][1].bytes), [1, 2]);
    assert.equal(calls[2][1].seq, 1);
    assert.deepEqual(Array.from(calls[2][1].bytes), [3, 4, 5]);
    assert.equal(calls[3][1].id, 'download-1');
    assert.equal(calls[3][1].seq, 2);
  }

  {
    const { calls, api } = await loadPreload();
    const result = await api.saveBlob(createSizedEmptyBlob(2 ** 30), 'max.bin', false);
    assert.equal(result, 1);
    assert.equal(calls[0][0], 'line-download:begin');
    assert.equal(calls[0][1].size, 2 ** 30);
  }

  {
    const { calls, api } = await loadPreload();
    await assert.rejects(
      api.saveBlob(createSizedEmptyBlob((2 ** 30) + 1), 'too-large.bin', false),
      error => error?.code === 'LINE_DOWNLOAD_BLOB_INVALID',
    );
    assert.equal(calls.length, 0);
  }

  {
    const { calls, api } = await loadPreload({ failChunk: true });
    await assert.rejects(
      api.saveBlob(createBlob([[1, 2, 3]]), 'probe.txt', false),
      /chunk failed/,
    );
    assert.equal(calls.at(-1)[0], 'line-download:cancel');
    assert.equal(calls.at(-1)[1].id, 'download-1');
  }

  {
    const { calls, api } = await loadPreload();
    const invalid = { size: -1, stream() { throw new Error('must not stream'); } };
    await assert.rejects(
      api.saveBlob(invalid, 'probe.txt', false),
      error => error?.code === 'LINE_DOWNLOAD_BLOB_INVALID',
    );
    assert.equal(calls.length, 0);
  }

  console.log('LINE_ISOLATED_DOWNLOAD_PRELOAD_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
