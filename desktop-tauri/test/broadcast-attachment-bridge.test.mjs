import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fixture, ids, uuid, wid, receipt, deferred } = require('./platform-bridge-fixture.cjs');
// Execute the original active delivery owner as the order/caption oracle.
const { sendDirectBundle } = require('../../ui/broadcast-delivery.js');
const CHUNK = 512 * 1024;
const file = (index, fields = {}) => ({ id: uuid(1000 + index), name: `synthetic-${index}.png`,
  size: 4, mime: 'image/png', kind: 'image', ...fields });

async function result(f, call) {
  assert.equal(call.accepted, true);
  await f.flush();
  const entry = f.read(call.id);
  assert.ok(entry, 'the live mailbox must retain its result');
  assert.equal(entry.pending, false);
  return entry;
}

async function prepare(f, request) {
  const entry = await result(f, f.start('prepare', request));
  assert.equal(entry.error, undefined);
  assert.deepEqual(entry.value, { prepared: true });
}

const transfer = (f, request, operation, index = 0, fields = {}) => f.bridge.attachment(
  f.generation, request.attemptId, { operation, index, ...fields });

function stage(f, request, index, bytes = Buffer.alloc(request.attachments[index].size, index + 1)) {
  assert.equal(transfer(f, request, 'start', index), true);
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    assert.equal(transfer(f, request, 'chunk', index, {
      offset, data: bytes.subarray(offset, offset + CHUNK).toString('base64'),
    }), true);
  }
  assert.equal(transfer(f, request, 'seal', index), true);
}

async function dispatchFile(f, request, index) {
  return (await result(f, f.start('dispatchAttachment', {
    attemptId: request.attemptId, index,
  }, { timeoutMs: 300000 }))).value;
}

async function finish(f, request) {
  return (await result(f, f.start('dispatch', { attemptId: request.attemptId }))).value;
}

test('actual old delivery order matches mixed attachments with only the last caption and cards afterward', async () => {
  const selected = [
    file(0),
    file(1, { name: 'synthetic.mp4', mime: 'video/mp4', kind: 'video' }),
    file(2, { name: 'synthetic.mp3', mime: 'audio/mpeg', kind: 'audio' }),
    file(3, { name: 'synthetic.pdf', mime: 'application/pdf', kind: 'document' }),
  ];
  const f = fixture({ attachments: true });
  const request = f.draft({ message: 'Rendered synthetic recipient caption', attachments: selected,
    vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  const expected = [];
  const old = await sendDirectBundle({ files: selected, message: request.message, vcards: request.vcards,
    sendFile: ({ file: metadata, caption }) => { expected.push({ kind: 'file', name: metadata.name, caption }); return { ok: true }; },
    sendText: () => { expected.push({ kind: 'text' }); return { ok: true }; },
    sendVcards: () => { expected.push({ kind: 'cards' }); return { ok: true }; },
  });
  assert.equal(old.ok, true);
  await prepare(f, request);
  for (let index = 0; index < selected.length; index++) {
    stage(f, request, index);
    assert.equal((await dispatchFile(f, request, index)).status, 'confirmed');
    assert.equal(f.sends.length, index + 1);
  }
  assert.equal((await finish(f, request)).status, 'confirmed');
  assert.deepEqual(f.sends.map((call) => call.kind === 'file'
    ? { kind: call.kind, name: call.value.name, caption: call.options.caption }
    : { kind: call.kind }), expected);
  assert.deepEqual(f.sends.slice(0, 4).map(({ options }) => options.type), ['image', 'video', 'audio', 'document']);
  assert.ok(f.sends.every(({ target }) => target === request.targetId));
  assert.notEqual(String(f.WPP.chat.getActiveChat().id), request.targetId);
  assert.equal(f.sends.some(({ kind }) => kind === 'text'), false);
  for (const { options } of f.sends.filter(({ kind }) => kind === 'file')) {
    assert.equal(options.waitForAck, true);
    assert.equal(options.detectMentioned, false);
    assert.equal(options.linkPreview, false);
    assert.equal(options.markIsRead, false);
  }
});

test('multiple bounded chunks reconstruct the exact selected File without a path or an extra text send', async () => {
  const bytes = Buffer.alloc(CHUNK * 2 + 7);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const f = fixture({ attachments: true });
  const metadata = file(0, { size: bytes.length, name: 'selected.bin', mime: 'application/octet-stream', kind: 'document' });
  const request = f.draft({ message: '', attachments: [metadata] });
  await prepare(f, request);
  stage(f, request, 0, bytes);
  assert.equal((await dispatchFile(f, request, 0)).status, 'confirmed');
  assert.equal((await finish(f, request)).status, 'confirmed');
  assert.equal(f.sends.length, 1);
  const sent = f.sends[0];
  assert.equal(sent.value.name, metadata.name);
  assert.equal(sent.value.type, metadata.mime);
  assert.equal(sent.value.size, bytes.length);
  assert.deepEqual(Buffer.from(await sent.value.arrayBuffer()), bytes);
  assert.deepEqual(sent.options, { type: 'document', filename: metadata.name, mimetype: metadata.mime,
    caption: '', waitForAck: true, detectMentioned: false, linkPreview: false, markIsRead: false });
});

test('an empty selected document seals without inventing bytes and still requires its real receipt', async () => {
  const f = fixture({ attachments: true });
  const request = f.draft({ message: '', attachments: [file(0, {
    name: 'empty.txt', size: 0, mime: 'text/plain', kind: 'document',
  })] });
  await prepare(f, request); stage(f, request, 0);
  assert.equal((await dispatchFile(f, request, 0)).status, 'confirmed');
  assert.equal((await finish(f, request)).status, 'confirmed');
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].value.size, 0);
  assert.deepEqual(Buffer.from(await f.sends[0].value.arrayBuffer()), Buffer.alloc(0));
});

test('transfers reject wrong owners, order, duplicate chunks, malformed base64 and premature sealing', async () => {
  const f = fixture({ attachments: true });
  const request = f.draft({ attachments: [file(0), file(1)] });
  await prepare(f, request);
  assert.equal(f.bridge.attachment(uuid(999), request.attemptId, { operation: 'start', index: 0 }), false);
  assert.equal(f.bridge.attachment(f.generation, uuid(998), { operation: 'start', index: 0 }), false);
  assert.equal(transfer(f, request, 'start', 1), false);
  assert.equal(transfer(f, request, 'start'), true);
  assert.equal(transfer(f, request, 'start'), false);
  assert.equal(transfer(f, request, 'seal'), false);
  for (const data of ['?', 'AA', 'AB==', 'AAAA====', Buffer.alloc(CHUNK + 1).toString('base64')]) {
    assert.equal(transfer(f, request, 'chunk', 0, { offset: 0, data }), false);
  }
  assert.equal(transfer(f, request, 'chunk', 0, { offset: 1, data: 'AQI=' }), false);
  assert.equal(transfer(f, request, 'chunk', 0, { offset: 0, data: 'AQI=' }), true);
  assert.equal(transfer(f, request, 'chunk', 0, { offset: 0, data: 'AQI=' }), false);
  assert.equal(transfer(f, request, 'seal'), false);
  assert.equal(transfer(f, request, 'chunk', 0, { offset: 2, data: 'AwQ=' }), true);
  assert.equal(transfer(f, request, 'chunk', 0, { offset: 4, data: 'BQ==' }), false);
  assert.equal(transfer(f, request, 'seal'), true);
  assert.equal(transfer(f, request, 'seal'), false);
  assert.deepEqual(f.sends, []);
  assert.equal((await dispatchFile(f, request, 0)).status, 'confirmed');
  assert.equal(transfer(f, request, 'start', 0), false);
  assert.equal(transfer(f, request, 'start', 1), true);
});

test('attachment capability, aggregate bounds and @all incompatibility fail before sending', async () => {
  const unsupported = fixture();
  assert.equal((await result(unsupported, unsupported.start('prepare', unsupported.draft({ attachments: [file(0)] })))).error,
    'CAPABILITY_UNAVAILABLE');
  const samples = [
    [file(0, { size: -1 })], [file(0, { size: 512 * 1024 * 1024 + 1 })],
    [file(0), file(0)], Array.from({ length: 11 }, (_, index) => file(index)),
    [file(0, { size: 512 * 1024 * 1024 }), file(1, { size: 512 * 1024 * 1024 }), file(2)],
    [file(0, { name: '../selected.png' })], [file(0, { mime: 'image/png;invalid' })],
  ];
  for (const attachments of samples) {
    const f = fixture({ attachments: true });
    assert.equal((await result(f, f.start('prepare', f.draft({ attachments })))).error,
      'CAPABILITY_UNAVAILABLE', JSON.stringify(attachments));
    assert.deepEqual(f.sends, []);
  }
  const f = fixture({ attachments: true });
  const request = f.draft({ targetId: ids.group, tagAll: true, attachments: [file(0)] });
  assert.equal((await result(f, f.start('prepare', request))).error, 'CAPABILITY_UNAVAILABLE');
  assert.deepEqual(f.sends, []);
});

test('missing ACK or a partial file failure stops later files and cards without replaying consumed attempts', async () => {
  for (const bad of [null, true, 'SENT', {}, receipt('submitted'), receipt('id', 0), receipt('id', '1')]) {
    const f = fixture({ attachments: true });
    f.behavior.file = () => bad;
    const request = f.draft({ attachments: [file(0), file(1)], vcards: [{ id: ids.contact, name: 'Synthetic' }] });
    await prepare(f, request); stage(f, request, 0);
    assert.deepEqual(await dispatchFile(f, request, 0), { status: 'uncertain', code: 'RECEIPT_MISSING' });
    assert.equal(transfer(f, request, 'start', 1), false);
    assert.equal((await finish(f, request)).status, 'notSubmitted');
    assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
    assert.equal(f.sends.length, 1);
  }
  const f = fixture({ attachments: true });
  const request = f.draft({ attachments: [file(0), file(1), file(2)], vcards: [{ id: ids.contact, name: 'Synthetic' }] });
  await prepare(f, request); stage(f, request, 0);
  assert.equal((await dispatchFile(f, request, 0)).status, 'confirmed');
  f.behavior.file = () => { throw Object.assign(new Error('synthetic upload failure'), { code: 'RUNTIME_FAILED' }); };
  stage(f, request, 1);
  assert.deepEqual(await dispatchFile(f, request, 1), { status: 'uncertain', code: 'RUNTIME_FAILED' });
  assert.equal(transfer(f, request, 'start', 2), false);
  assert.equal((await finish(f, request)).status, 'notSubmitted');
  assert.deepEqual(f.sends.map(({ kind }) => kind), ['file', 'file']);
});

test('cancelling an unsubmitted attempt releases its buffer and cannot revive the old attempt', async () => {
  const f = fixture({ attachments: true });
  const request = f.draft({ attachments: [file(0)] });
  await prepare(f, request); stage(f, request, 0);
  f.bridge.cancelAttempt(f.generation, request.attemptId);
  assert.equal(transfer(f, request, 'start'), false);
  assert.equal((await result(f, f.start('dispatchAttachment', { attemptId: request.attemptId, index: 0 }))).error,
    'NOT_SUBMITTED');
  assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
  const next = f.draft({ attachments: [file(1)] });
  await prepare(f, next); stage(f, next, 0);
  assert.deepEqual(f.sends, []);
});

test('cancellation after WPP starts retains the single file slot until the actual Promise exits', async () => {
  const f = fixture({ attachments: true });
  const pending = deferred();
  f.behavior.file = () => pending.promise;
  const request = f.draft({ attachments: [file(0), file(1)] });
  await prepare(f, request); stage(f, request, 0);
  const call = f.start('dispatchAttachment', { attemptId: request.attemptId, index: 0 }, { timeoutMs: 300000 });
  await f.flush();
  assert.equal(f.sends.length, 1);
  assert.equal(f.read(call.id).pending, true);
  f.bridge.cancelAttempt(f.generation, request.attemptId);
  const next = f.draft({ attachments: [file(2)] });
  await prepare(f, next);
  assert.equal(transfer(f, next, 'start'), false);
  pending.resolve(receipt());
  assert.deepEqual((await result(f, call)).value, { status: 'uncertain', code: 'CANCELLED' });
  assert.equal(transfer(f, request, 'start', 1), false);
  assert.equal(transfer(f, next, 'start'), true);
  assert.equal(f.sends.length, 1);
});

test('an upload timeout drops the late result but keeps its buffer occupied until the upload exits', async () => {
  const f = fixture({ attachments: true });
  const pending = deferred();
  f.behavior.file = () => pending.promise;
  const request = f.draft({ attachments: [file(0)] });
  await prepare(f, request); stage(f, request, 0);
  const call = f.start('dispatchAttachment', { attemptId: request.attemptId, index: 0 }, { timeoutMs: 300000 });
  await f.flush();
  await f.advance(300001);
  assert.equal(f.read(call.id), null);
  const next = f.draft({ attachments: [file(1)] });
  await prepare(f, next);
  assert.equal(transfer(f, next, 'start'), false);
  pending.resolve(receipt()); await f.flush();
  assert.equal(f.read(call.id), null);
  assert.equal(transfer(f, request, 'start'), false);
  assert.equal(transfer(f, next, 'start'), true);
  assert.equal(f.sends.length, 1);
});

test('a changed target cannot redirect a staged file and expiring preparations release unsubmitted memory', async () => {
  const f = fixture({ attachments: true });
  const request = f.draft({ attachments: [file(0)] });
  await prepare(f, request); stage(f, request, 0);
  f.models.get(request.targetId).id = wid(ids.lid);
  assert.deepEqual(await dispatchFile(f, request, 0), { status: 'notSubmitted', code: 'TARGET_CHANGED' });
  assert.deepEqual(f.sends, []);
  const expires = fixture({ attachments: true });
  const first = expires.draft({ attachments: [file(0)] });
  await prepare(expires, first); stage(expires, first, 0);
  await expires.advance(20 * 60 * 1000 + 1);
  assert.equal(transfer(expires, first, 'seal'), false);
  const next = expires.draft({ attachments: [file(1)] });
  await prepare(expires, next);
  assert.equal(transfer(expires, next, 'start'), true);
  assert.deepEqual(expires.sends, []);
});
