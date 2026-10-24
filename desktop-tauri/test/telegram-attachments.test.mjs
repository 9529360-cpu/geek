import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { attachmentFixture, attachment, uploadedMedia, finalMedia, generation } from './helpers/telegram-attachments.mjs';
import { deferred, flush } from './helpers/telegram-send.mjs';
import { jpeg } from './helpers/telegram-media-fixtures.mjs';

test('document upload preserves bytes/caption/draft and confirms one exact media submission', async () => {
  const f = attachmentFixture();
  const selected = attachment();
  const text = '**literal** 🎲\nhttps://example.test';
  const draft = f.editor.innerText;
  const request = f.draft([selected], { message: text });
  const prepared = await f.adapter.prepare(request);
  assert.equal(f.state.uploads.length, 0);
  const outcome = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
  assert.equal(outcome.status, 'confirmed'); assert.equal(outcome.receipt, 'tg:101:700');
  assert.equal(f.state.uploads.length, 1); assert.equal(f.state.sends.length, 1);
  assert.deepEqual(Buffer.from(await f.state.uploads[0].args.file.arrayBuffer()), selected.bytes);
  const call = f.state.sends[0];
  assert.equal(call.method, 'messages.sendMedia'); assert.equal(call.params.message, text);
  assert.equal(call.params.clear_draft, false); assert.deepEqual(call.params.entities, []);
  assert.equal(call.params.media._, 'inputMediaUploadedDocument');
  assert.equal(call.params.media.pFlags.force_file, true);
  assert.equal(call.params.media.mime_type, 'application/pdf');
  assert.deepEqual(call.params.media.attributes, [{ _: 'documentAttributeFilename', file_name: 'report.pdf' }]);
  assert.equal(call.params.random_id, f.state.stages[0].message.random_id);
  assert.equal('send' in f.state.stages[0].message, false);
  assert.equal(f.editor.innerText, draft); assert.equal(f.state.clears.length, 0);
  assert.equal(f.root.count('message_sent'), 0);
  assert.equal((await f.adapter.dispatch(prepared, () => true, outcome.receipt)).status, 'confirmed');
  assert.equal(f.state.sends.length, 1, 'final bundle settlement must not send separate text');
  await f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
  assert.equal(f.state.uploads.length, 1); assert.equal(f.state.sends.length, 1);
});

test('real PNG header produces photo metadata and short media updates use the same finalizer', async () => {
  const f = attachmentFixture(); f.state.mediaMode = 'short';
  const selected = attachment('image');
  const prepared = await f.adapter.prepare(f.draft([selected], { message: '' }));
  const result = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
  assert.equal(result.status, 'confirmed');
  assert.equal(f.state.mediaModels[0].args.width, 1); assert.equal(f.state.mediaModels[0].args.height, 1);
  assert.equal(f.state.uploads[0].args.attachType, 'photo');
  assert.equal(f.state.sends[0].params.media._, 'inputMediaUploadedPhoto');
  assert.equal(f.state.sends[0].params.message, '');
  assert.deepEqual(f.state.updates.map(({ update }) => update._), ['updateMessageID', 'updateNewMessage']);
  assert.notEqual(f.state.stages[0].message.media.photo.id, f.state.mirrors.get('101_history:700').media.photo.id);
});

test('a real JPEG keeps its bytes and derives dimensions from the SOF record', async () => {
  const f = attachmentFixture();
  const selected = attachment('image', { bytes: jpeg, name: 'photo.jpg', mime: 'image/jpeg' });
  const prepared = await f.adapter.prepare(f.draft([selected]));
  const result = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
  assert.equal(result.status, 'confirmed');
  assert.equal(f.state.mediaModels[0].args.width, 2); assert.equal(f.state.mediaModels[0].args.height, 3);
  assert.deepEqual(Buffer.from(await f.state.uploads[0].args.file.arrayBuffer()), jpeg);
  assert.equal(f.state.sends[0].params.media.file.name, 'photo.jpeg');
});

test('MP4 uses decoded video dimensions, group namespace, no round/video retry or leaked object URL', async () => {
  const f = attachmentFixture(); const selected = attachment('video');
  const prepared = await f.adapter.prepare(f.draft([selected], { targetId: 'tg:-202' }));
  const result = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
  assert.equal(result.receipt, 'tg:-202:700');
  const params = f.state.sends[0].params;
  assert.equal(params.peer._, 'inputPeerChannel'); assert.equal(params.peer.channel_id, 202);
  assert.deepEqual(params.media.attributes[0], { _: 'documentAttributeVideo', w: 320, h: 240,
    duration: 4, pFlags: { supports_streaming: true } });
  assert.deepEqual(f.state.revokedUrls, f.state.urls); assert.equal(f.state.urls.length, 1);
  assert.equal(f.state.mediaModels[0].args.isRoundMessage, undefined);
});

test('real composed bridge sends files in order with caption only on the final item', async () => {
  const f = attachmentFixture({ bridge: true });
  const first = attachment('image'); const last = attachment('document', {
    metadata: { id: '10000000-0000-4000-8000-000000000002' },
  });
  const request = f.draft([first, last], { message: '最后一件的说明 🎉' });
  assert.equal((await f.result(f.start('catalog', {}))).value.capabilities.attachments, true);
  assert.equal((await f.result(f.start('prepare', request))).value.prepared, true);
  for (const [index, selected] of [first, last].entries()) {
    await f.upload(request, selected, index);
    const result = await f.result(f.start('dispatchAttachment', { attemptId: request.attemptId, index }, 300000));
    assert.equal(result.value.status, 'confirmed');
  }
  const complete = await f.result(f.start('dispatch', { attemptId: request.attemptId }));
  assert.equal(complete.value.status, 'confirmed');
  assert.deepEqual(f.state.sends.map((call) => call.params.message), ['', request.message]);
  assert.equal(f.state.sends.every((call) => call.method === 'messages.sendMedia'), true);
  assert.notEqual(f.state.sends[0].params.random_id, f.state.sends[1].params.random_id);
  const repeated = await f.result(f.start('prepare', request));
  assert.equal(repeated.error, 'NOT_SUBMITTED');
  assert.equal(f.state.uploads.length, 2); assert.equal(f.state.sends.length, 2);
});

test('live caption limit and media-specific rights reject before any upload', async () => {
  for (const kind of ['image', 'video', 'document']) {
    const f = attachmentFixture(); const selected = attachment(kind);
    const action = { image: 'send_photos', video: 'send_videos', document: 'send_docs' }[kind];
    f.state.allowedRights[action] = false;
    await assert.rejects(f.adapter.prepare(f.draft([selected])), (error) => error.code === 'CAPABILITY_UNAVAILABLE');
    assert.equal(f.state.rights.at(-1).action, action);
    assert.equal(f.state.uploads.length, 0); assert.equal(f.state.generated.length, 0);
  }
  const f = attachmentFixture(); f.state.captionLimit = 4;
  await assert.rejects(f.adapter.prepare(f.draft([attachment()], { message: '😀😀a' })));
  assert.equal(f.state.uploads.length, 0);
  const prepared = await f.adapter.prepare(f.draft([attachment()], { message: '😀😀' }));
  f.state.captionLimit = 3;
  assert.equal((await f.finish(f.adapter.dispatchAttachment(prepared, attachment().file, 0, () => true))).status, 'notSubmitted');
  assert.equal(f.state.uploads.length, 0);
});

test('metadata bounds, unsupported media and mismatching immutable File fail before upload', async () => {
  const invalid = [{ size: 0 }, { size: 512 * 1024 * 1024 + 1 }, { name: '../file' },
    { id: 'not-an-id' }, { kind: 'audio' }, { kind: 'image', mime: 'image/webp' },
    { kind: 'video', mime: 'video/webm' }];
  for (const metadata of invalid) {
    const f = attachmentFixture();
    await assert.rejects(f.adapter.prepare(f.draft([attachment('document', { metadata })])));
    assert.equal(f.state.uploads.length, 0);
  }
  const f = attachmentFixture(); const selected = attachment();
  await assert.rejects(f.adapter.prepare(f.draft([selected, selected])));
  const huge = [1, 2, 3].map((index) => attachment('document', { metadata: {
    id: `10000000-0000-4000-8000-00000000000${index}`, size: 512 * 1024 * 1024,
  } }));
  await assert.rejects(f.adapter.prepare(f.draft(huge)));
  const prepared = await f.adapter.prepare(f.draft([selected]));
  const wrong = new File(['other'], selected.file.name, { type: selected.file.type });
  assert.equal((await f.adapter.dispatchAttachment(prepared, wrong, 0, () => true)).status, 'notSubmitted');
  assert.equal(f.state.uploads.length, 0);
});

test('native-classified WebP/GIF/audio remain ordinary documents with unchanged MIME and bytes', async () => {
  for (const mime of ['image/webp', 'image/gif', 'audio/mpeg']) {
    const f = attachmentFixture(); const selected = attachment('document', { mime });
    const prepared = await f.adapter.prepare(f.draft([selected]));
    const result = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
    assert.equal(result.status, 'confirmed', mime);
    assert.equal(f.state.mediaModels[0].args.forceFile, true);
    assert.equal(f.state.sends[0].params.media.mime_type, mime);
    assert.equal(f.state.sends[0].params.media.pFlags.force_file, true);
    assert.equal(f.state.sends[0].params.media.attributes.length, 1);
  }
});

test('prepared metadata and original caption cannot follow later draft mutation', async () => {
  const f = attachmentFixture(); const selected = attachment();
  const request = f.draft([selected], { message: 'original' });
  const prepared = await f.adapter.prepare(request);
  request.message = 'replacement'; request.attachments[0].name = 'replacement.pdf';
  assert.equal((await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true))).status, 'confirmed');
  assert.equal(f.state.sends[0].params.message, 'original');
  assert.equal(f.state.sends[0].params.media.attributes[0].file_name, 'report.pdf');
});

test('wrong media, caption, temp identity or mirrored server ID never confirms a pending send', async () => {
  const f = attachmentFixture(); f.state.mediaMode = 'never'; const selected = attachment();
  const prepared = await f.adapter.prepare(f.draft([selected]));
  let completed = false;
  const promise = f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true)
    .then((value) => { completed = true; return value; });
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  f.emitMedia({ ...pending, id: pending.id + 1, mid: pending.mid + 1, random_id: '1111' });
  await f.advance(); assert.equal(completed, false);
  for (const change of [{ media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: '9' } } },
    { text: 'wrong caption' }, { media: { ...finalMedia(pending), ttl_seconds: 1 } },
    { media: { ...finalMedia(pending), document: { ...finalMedia(pending).document, size: selected.file.size + 1 } } }]) {
    f.emitMedia(pending, change); await f.advance(); assert.equal(completed, false);
  }
  const final = { ...pending, id: 700, mid: 700, media: finalMedia(pending), pFlags: { out: true } };
  delete final.pending; delete final.random_id;
  f.state.mirrors.set('101_history:700', { ...final, media: finalMedia(pending, '910002') });
  f.root.emit('message_sent', { storageKey: '101_history', tempId: pending.mid, tempMessage: pending, mid: 700, message: final });
  await f.advance(); assert.equal(completed, false);
  f.emitMedia(pending);
  assert.equal((await f.finish(promise)).status, 'confirmed');
  assert.equal(f.state.sends.length, 1);
});

test('any upload failure or malformed upload result is uncertain and never auto-replayed', async () => {
  for (const mode of ['reject', 'throw', 'malformed']) {
    const f = attachmentFixture(); const selected = attachment();
    f.state.uploadError = mode === 'reject'; f.state.uploadThrow = mode === 'throw';
    if (mode === 'malformed') f.state.uploadResult = { _: 'inputMediaUploadedDocument' };
    const prepared = await f.adapter.prepare(f.draft([selected]));
    const result = await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true));
    assert.equal(result.status, 'uncertain', mode);
    assert.equal(f.state.sends.length, 0); assert.equal(f.state.uploads.length, 1);
    assert.equal(f.state.uploadCancels[0].name, f.state.uploads[0].args.uploadingFileName);
    await f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
    assert.equal(f.state.uploads.length, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('cancel during local metadata releases a late model without upload or history mutation', async () => {
  const f = attachmentFixture(); const selected = attachment(); const gate = deferred();
  const prepared = await f.adapter.prepare(f.draft([selected])); f.state.modelGate = gate;
  let valid = true;
  const promise = f.adapter.dispatchAttachment(prepared, selected.file, 0, () => valid);
  await f.until(() => f.state.mediaModels.length === 1);
  valid = false; await f.advance(50);
  assert.equal((await f.finish(promise)).status, 'notSubmitted');
  gate.resolve(); await flush();
  assert.equal(f.state.uploads.length, 0); assert.equal(f.state.stages.length, 0);
  assert.equal(f.state.mediaReleases.length, 1);
});

test('cancelled or timed out real bridge upload keeps its one File slot until the actual upload settles', async () => {
  for (const cancel of [true, false]) {
    const f = attachmentFixture({ bridge: true }); const selected = attachment();
    const request = f.draft([selected]);
    await f.result(f.start('prepare', request)); await f.upload(request, selected);
    const gate = deferred(); f.state.uploadGate = gate;
    const sending = f.start('dispatchAttachment', { attemptId: request.attemptId, index: 0 }, 300000);
    await f.until(() => f.state.uploads.length === 1);
    if (cancel) sending.cancel();
    await f.advance(cancel ? 50 : 300001);
    const next = f.draft([selected]); await f.result(f.start('prepare', next));
    assert.equal(f.transfer(next, 'start'), false);
    assert.equal(f.state.uploadCancels.length, 1);
    assert.equal(f.state.uploadCancels[0].account, 1);
    gate.resolve(uploadedMedia(f.state.uploads[0].args)); await flush(); await f.advance();
    assert.equal(f.state.sends.length, 0); assert.equal(sending.read(), null);
    assert.equal(f.transfer(next, 'start'), true);
    assert.equal(f.state.uploads.length, 1);
  }
});

test('account A to B to A during upload permanently retires the original adapter and never sends late', async () => {
  const f = attachmentFixture(); const selected = attachment(); const gate = deferred();
  const prepared = await f.adapter.prepare(f.draft([selected])); f.state.uploadGate = gate;
  const promise = f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
  await f.until(() => f.state.uploads.length === 1);
  f.switchAccount(2, 91); f.switchAccount(1, 90); await f.advance(50);
  gate.resolve(uploadedMedia(f.state.uploads[0].args));
  assert.equal((await f.finish(promise)).status, 'uncertain');
  assert.equal(f.state.uploadCancels[0].account, 1); assert.equal(f.state.sends.length, 0);
  assert.equal(f.adapter.capabilities().attachments, false);
  await assert.rejects(f.adapter.prepare(f.draft([selected])), (error) => error.code === 'ACCOUNT_UNAVAILABLE');
});

test('cancel after staging cleans only the original pending and cannot clear the unrelated draft', async () => {
  const f = attachmentFixture(); const selected = attachment();
  const prepared = await f.adapter.prepare(f.draft([selected]));
  const draft = f.editor.innerText;
  f.state.stageHook = () => f.switchAccount();
  assert.equal((await f.finish(f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true))).status, 'uncertain');
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.cancelled.length, 1);
  assert.equal(f.state.cancelled[0].account, 1);
  assert.equal(f.editor.innerText, draft); assert.equal(f.state.clears.length, 0);
});

test('unknown send results, rejection and ACK timeout never become success or a second call', async () => {
  for (const mode of ['void', 'error', 'never', 'throw']) {
    const f = attachmentFixture(); const selected = attachment();
    f.state.mediaMode = mode; f.state.apiThrow = mode === 'throw';
    const prepared = await f.adapter.prepare(f.draft([selected]));
    const promise = f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
    await f.until(() => f.state.sends.length === 1);
    if (mode === 'never') await f.advance(30000);
    const result = await f.finish(promise);
    assert.equal(result.status, 'uncertain', mode);
    assert.equal(f.root.count('message_sent'), 0);
    f.emitMedia(f.state.stages[0].message); await f.advance();
    await f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
    assert.equal(f.state.uploads.length, 1); assert.equal(f.state.sends.length, 1);
  }
});

test('late send reply stays bound to its original account but cannot deliver into a new account', async () => {
  const f = attachmentFixture(); const selected = attachment(); f.state.apiGate = deferred();
  const prepared = await f.adapter.prepare(f.draft([selected]));
  const promise = f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true);
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  f.switchAccount(); await f.advance();
  assert.equal((await f.finish(promise)).status, 'uncertain');
  f.state.apiGate.resolve({ _: 'updateShortSentMessage', id: 800, date: 5, pFlags: { out: true },
    pts: 1, pts_count: 1, media: finalMedia(pending) });
  await flush();
  assert.deepEqual(f.state.updates.map((value) => value.account), [1, 1]);
  assert.equal(f.state.sends.length, 1); assert.equal(f.root.count('message_sent'), 0);
  assert.equal(f.window.__geekTauriPlatform?.bind(generation), undefined);
});

test('corrupt photo headers and unavailable video metadata reject without an upload or a leaked URL', async () => {
  const f = attachmentFixture();
  const broken = attachment('image', { bytes: Buffer.from('not a PNG') });
  const prepared = await f.adapter.prepare(f.draft([broken]));
  assert.equal((await f.finish(f.adapter.dispatchAttachment(prepared, broken.file, 0, () => true))).status, 'notSubmitted');
  assert.equal(f.state.generated.length, 0); assert.equal(f.state.uploads.length, 0);
  const video = attachment('video'); const g = attachmentFixture(); g.state.videoNever = true;
  const videoPrepared = await g.adapter.prepare(g.draft([video]));
  const promise = g.adapter.dispatchAttachment(videoPrepared, video.file, 0, () => true);
  await g.until(() => g.state.urls.length === 1); await g.advance(12000);
  const result = await g.finish(promise);
  assert.equal(result.status, 'notSubmitted'); assert.equal(result.code, 'TIMED_OUT');
  assert.equal(g.state.uploads.length, 0); assert.deepEqual(g.state.revokedUrls, g.state.urls);
});

test('a partial composed bundle is uncertain and cannot send a later attachment or replay its first one', async () => {
  const f = attachmentFixture({ bridge: true });
  const selected = [1, 2, 3].map((index) => attachment('document', { metadata: {
    id: `10000000-0000-4000-8000-00000000000${index}`,
  } }));
  const request = f.draft(selected);
  await f.result(f.start('prepare', request)); await f.upload(request, selected[0]);
  assert.equal((await f.result(f.start('dispatchAttachment', { attemptId: request.attemptId, index: 0 }, 300000)))
    .value.status, 'confirmed');
  f.state.uploadError = true; await f.upload(request, selected[1], 1);
  assert.equal((await f.result(f.start('dispatchAttachment', { attemptId: request.attemptId, index: 1 }, 300000)))
    .value.status, 'uncertain');
  assert.equal(f.transfer(request, 'start', 2), false);
  assert.equal((await f.result(f.start('prepare', request))).error, 'NOT_SUBMITTED');
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.sends[0].params.message, '');
  assert.equal(f.state.uploads.length, 2);
});
