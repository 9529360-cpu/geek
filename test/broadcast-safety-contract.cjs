'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const safety = require('../ui/broadcast-safety.js');
const { createBroadcastFileRegistry } = require('../src/broadcast-files.cjs');

assert.equal(safety.sameChat('-5387155004', '-5387155004'), true);
assert.equal(safety.sameChat('#-5387155004', '-5387155004'), true);
assert.equal(safety.sameChat('other-chat', '-5387155004'), false);

assert.deepEqual(
  safety.authorizeSend({ opened: false, currentChatId: 'old', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: false, reason: 'OPEN_FAILED' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'old', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: false, reason: 'WRONG_CHAT' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'NO_EDITOR', needsComposer: true }),
  { ok: false, reason: 'COMPOSER_FAILED:NO_EDITOR' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true, expectedComposerText: 'hello', actualComposerText: 'old draft' }),
  { ok: false, reason: 'COMPOSER_MISMATCH' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true, expectedComposerText: 'hello', actualComposerText: 'hello' }),
  { ok: true, reason: '' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: true, reason: '' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'NO_SET', needsComposer: false }),
  { ok: true, reason: '' }
);

function createFakeFs(files) {
  const records = new Map();
  for (const [name, value] of Object.entries(files)) {
    records.set(path.resolve(name), {
      data: Buffer.from(value.data || ''),
      size: value.size ?? Buffer.byteLength(value.data || ''),
      mtimeMs: value.mtimeMs ?? 1,
      isFile: value.isFile !== false,
    });
  }
  const api = {
    records,
    reads: 0,
    async realpath(value) {
      const absolute = path.resolve(value);
      if (!records.has(absolute)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return absolute;
    },
    async stat(value) {
      const record = records.get(path.resolve(value));
      if (!record) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isFile };
    },
    async open(value) {
      const record = records.get(path.resolve(value));
      if (!record) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return {
        async stat() { return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => record.isFile }; },
        async read(buffer, offset, length) {
          api.reads += 1;
          const bytes = record.data.subarray(0, length);
          bytes.copy(buffer, offset);
          return { bytesRead: bytes.length, buffer };
        },
        async close() {},
      };
    },
  };
  return api;
}

(async () => {
  let currentTime = 1000;
  let tokenCounter = 0;
  const fakeFs = createFakeFs({
    'a.txt': { data: 'aaaa', mtimeMs: 10 },
    'b.pdf': { data: 'bbbbb', mtimeMs: 20 },
    'large.zip': { size: 11, data: '01234567890', mtimeMs: 30 },
    'contacts.csv': { data: 'name\nAlice\n', mtimeMs: 40 },
    'oversize.csv': { size: 21, data: '123456789012345678901', mtimeMs: 50 },
    'contacts.xlsx': { data: 'nope', mtimeMs: 60 },
  });
  const registry = createBroadcastFileRegistry({
    fs: fakeFs,
    now: () => currentTime,
    randomBytes: () => Buffer.alloc(24, ++tokenCounter),
    limits: {
      maxFiles: 2,
      maxFileBytes: 10,
      maxTotalBytes: 9,
      maxImportBytes: 20,
      tokenTtlMs: 100,
      maxRegistryEntries: 10,
    },
  });

  const selected = await registry.registerSelection(['a.txt', 'b.pdf'], 'owner-1');
  assert.equal(selected.length, 2);
  assert.deepEqual(Object.keys(selected[0]).sort(), ['mime', 'name', 'size', 'token']);
  assert.equal('filePath' in selected[0], false, 'renderer metadata must not expose paths');
  assert.equal('base64' in selected[0], false, 'renderer metadata must not expose file bytes');
  assert.equal((await registry.resolve(selected[0].token, 'owner-1')).filePath, path.resolve('a.txt'));
  await assert.rejects(registry.resolve('../a.txt', 'owner-1'), { code: 'BROADCAST_FILE_TOKEN_INVALID' });
  await assert.rejects(registry.resolve(selected[0].token, 'owner-2'), { code: 'BROADCAST_FILE_TOKEN_INVALID' });
  await assert.rejects(
    registry.registerSelection(['a.txt', 'b.pdf', 'a.txt'], 'owner-1'),
    { code: 'BROADCAST_FILE_COUNT_LIMIT' },
  );
  await assert.rejects(registry.registerSelection(['large.zip'], 'owner-1'), { code: 'BROADCAST_FILE_SIZE_LIMIT' });

  const totalRegistry = createBroadcastFileRegistry({
    fs: fakeFs,
    randomBytes: () => Buffer.alloc(24, 9),
    limits: { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 8, tokenTtlMs: 100, maxRegistryEntries: 10 },
  });
  await assert.rejects(
    totalRegistry.registerSelection(['a.txt', 'b.pdf'], 'owner-1'),
    { code: 'BROADCAST_FILE_TOTAL_LIMIT' },
  );

  fakeFs.records.get(path.resolve('a.txt')).mtimeMs = 11;
  await assert.rejects(registry.resolve(selected[0].token, 'owner-1'), { code: 'BROADCAST_FILE_CHANGED' });
  currentTime = 1200;
  await assert.rejects(registry.resolve(selected[1].token, 'owner-1'), { code: 'BROADCAST_FILE_TOKEN_EXPIRED' });

  await assert.rejects(registry.readImportFile('contacts.xlsx'), { code: 'BROADCAST_IMPORT_TYPE_INVALID' });
  fakeFs.reads = 0;
  await assert.rejects(registry.readImportFile('oversize.csv'), { code: 'BROADCAST_IMPORT_SIZE_LIMIT' });
  assert.equal(fakeFs.reads, 0, 'oversized imports must be rejected before reading');
  assert.equal((await registry.readImportFile('contacts.csv')).content, 'name\nAlice\n');

  console.log('BROADCAST_SAFETY_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
