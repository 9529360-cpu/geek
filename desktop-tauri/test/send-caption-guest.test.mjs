import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { captionFixture, iconButton, sendPath, settle } from './helpers/whatsapp-caption.mjs';
import { generation, deferred, tick } from './helpers/send-guest.mjs';

const output = 'Invia 100 unità domani.';
const failed = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };
const start = (fixture) => {
  const event = fixture.click(); assert.equal(event.defaultPrevented, true);
  const request = fixture.ui.poll().request; assert.ok(request, fixture.ui.feedback()); return request;
};

test('actual composed owner sends one READY image, video or visible PDF and retains the complete preview after ACK', async () => {
  for (const type of ['image', 'video', 'document']) {
    const c = await captionFixture({ type }); const request = start(c);
    assert.deepEqual(Object.keys(request.context).sort(), ['attachmentId', 'kind']);
    assert.equal(request.context.kind, 'attachment'); assert.match(request.context.attachmentId, /^[\da-f-]{36}$/);
    assert.equal(JSON.stringify(request).includes(c.data.filehash), false);
    assert.equal(JSON.stringify(request).includes(c.media.filename), false);
    assert.equal(JSON.stringify(request).includes(c.previewUrl), false);
    const context = c.ui.api.poll(generation).request.context; context.attachmentId = randomUUID();
    assert.deepEqual(c.ui.poll().request, request);
    assert.deepEqual(c.ui.prepare(request, output), { ok: true });
    const flight = c.ui.commit(request); assert.equal(flight.accepted, true);
    assert.deepEqual(c.ui.poll().request, request);
    await settle();
    const result = c.ui.read(request, flight.permit).value;
    assert.deepEqual(result, { status: 'confirmed', receipt: `true_${request.chatId}_CAPTION1`, draftCleared: false });
    assert.equal(c.state.calls.length, 1); const call = c.state.calls[0];
    assert.notStrictEqual(call.prep, c.prep); assert.notStrictEqual(call.prep.mediaData, c.data);
    assert.strictEqual(call.chat, c.chat); assert.equal(call.options.caption, output);
    assert.equal(call.options.type, type); assert.equal(call.options.isViewOnce, false);
    assert.equal(call.options.addEvenWhilePreparing, false);
    assert.deepEqual(Object.keys(call.options).sort(), ['addEvenWhilePreparing', 'caption', 'isViewOnce', 'onMsgKeyCreated', 'type']);
    assert.equal(c.editor.innerText, request.text); assert.equal(c.media.caption, request.text);
    assert.strictEqual(c.media.file, c.holder); assert.strictEqual(c.media.mediaPrep, c.prep);
    assert.equal(c.drawer.isConnected, true); assert.equal(c.preview.src, c.previewUrl);
    assert.equal(c.ui.state.cleared.length, 0); assert.equal(c.ui.state.sent.length, 0);
    c.ui.deliver(request, { ...result, retryable: false }); c.click(); c.enter();
    assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 1);
  }
});

test('private MediaPrep freezes the immutable payload and deep metadata before its internal awaits', async () => {
  const c = await captionFixture();
  c.data.field('sidecar', new Uint8Array([1, 2, 3])); c.data.field('duration', 12);
  c.data.field('fullPreviewSize', { width: 640, height: 480 });
  const request = start(c); c.ui.prepare(request, output);
  const originalHash = c.data.filehash;
  c.state.mutateAfterAwait = () => {
    c.data.filehash = 'B'.repeat(43) + '=';
    c.data.mediaBlob = new c.W.whatsapp.OpaqueData(new Blob(['changed'], { type: 'image/png' }));
    c.data.sidecar[0] = 99; c.data.fullPreviewSize.width = 1; c.data.duration = 99;
    c.media.caption = 'Changed while uploading';
  };
  const flight = c.ui.commit(request); await settle();
  const sent = c.state.calls[0].prep.mediaData;
  assert.strictEqual(sent.mediaBlob, c.blob); assert.equal(await sent.mediaBlob.text(), 'Synthetic immutable attachment payload');
  assert.equal(sent.filehash, originalHash); assert.deepEqual([...sent.sidecar], [1, 2, 3]);
  assert.equal(sent.fullPreviewSize.width, 640); assert.equal(sent.duration, 12);
  assert.equal(c.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.equal(c.media.caption, 'Changed while uploading'); assert.equal(c.ui.state.cleared.length, 0);
});

test('shared-memory metadata is rejected before admission instead of cloning a still-shared payload', async () => {
  const c = await captionFixture(); c.data.field('sidecar', new Uint8Array(new SharedArrayBuffer(16)));
  assert.equal(c.click().defaultPrevented, true); assert.equal(c.ui.poll().request, null);
  assert.equal(c.state.calls.length, 0); assert.equal(c.media.caption, c.editor.innerText);
});

test('legitimate same-file cache replacement inside the private sender does not discard a real ACK', async () => {
  const c = await captionFixture(); const request = start(c); c.ui.prepare(request, output);
  c.state.mutateAfterAwait = (call) => { call.prep.mediaData.mediaBlob = new c.W.whatsapp.OpaqueData(c.blob); };
  const flight = c.ui.commit(request); await settle();
  assert.equal(c.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.strictEqual(c.media.file, c.holder); assert.equal(c.editor.innerText, request.text);
});

test('failure before submission retains logical identity and explicit retries get new attempts', async () => {
  const c = await captionFixture(); const first = start(c); assert.equal(c.ui.prepare(first, output).ok, true);
  assert.equal(c.ui.deliver(first, failed), true);
  const retry = start(c); assert.equal(retry.id, first.id); assert.equal(retry.attempt, first.attempt + 1);
  assert.deepEqual(retry.context, first.context); assert.equal(c.ui.prepare(first, output).ok, false);
  assert.equal(c.ui.commit(first).accepted, false); assert.equal(c.ui.prepare(retry, output).ok, true);
  const flight = c.ui.commit(retry); await settle();
  assert.equal(c.ui.read(retry, flight.permit).value.status, 'confirmed'); assert.equal(c.state.calls.length, 1);
});

test('caption, model and preview A-to-B-to-A changes cancel old attempts without rebilling a same-file retry', async () => {
  const changes = [
    async (c) => { const text = c.media.caption; c.media.caption = 'Temporary'; c.media.caption = text; },
    async (c) => { c.media.quality = 'HD'; c.media.quality = 'Standard'; },
    async (c) => { const value = c.data.filehash; c.data.filehash = 'B'.repeat(43) + '='; c.data.filehash = value; },
    async (c) => { c.preview.setAttribute('src', 'blob:https://web.whatsapp.com/changed'); c.preview.setAttribute('src', c.previewUrl); await tick(); },
    async (c) => { c.toggle.setAttribute('aria-pressed', 'true'); c.toggle.setAttribute('aria-pressed', 'false'); await tick(); },
  ];
  for (const change of changes) {
    const c = await captionFixture(); const first = start(c); c.ui.prepare(first, output); await change(c);
    assert.equal(c.ui.commit(first).accepted, false); assert.equal(c.ui.poll().request, null);
    const retry = start(c); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    assert.ok(retry.composerRevision > first.composerRevision); assert.equal(c.state.calls.length, 0);
  }
});

test('metadata mutation and stale visible preview reject old preparation before invocation', async () => {
  for (const mutate of [
    (c) => { c.data.fullPreviewSize.width = 1; },
    (c) => { c.media.fullPreview = `blob:https://web.whatsapp.com/${randomUUID()}`; },
    (c) => { c.preview.src = `blob:https://web.whatsapp.com/${randomUUID()}`; },
    (c) => { const image = c.ui.document.createElement('img'); image.src = c.previewUrl;
      image.setAttribute('src', c.previewUrl); image.complete = true; c.preview.replaceWith(image); },
  ]) {
    const c = await captionFixture(); c.data.field('fullPreviewSize', { width: 640, height: 480 });
    const request = start(c); c.ui.prepare(request, output); mutate(c);
    assert.equal(c.ui.commit(request).accepted, false); assert.equal(c.state.calls.length, 0);
  }
});

test('unsupported models, media modes and unproved preview DOM never create an intent', async () => {
  const cases = [
    ['multiple files', (c) => c.collection.models.push(c.media)],
    ['not ready', (c) => { c.media.state = 'processing'; }],
    ['wrong selection', (c) => { c.collection.active = null; }],
    ['unknown prep', (c) => { c.media.mediaPrep = { mediaData: c.data }; }],
    ['HD', (c) => { c.media.quality = 'HD'; }],
    ['edited image', (c) => { c.media.mediaEditorData = { hasEdits: () => true, getSending: () => false }; }],
    ['sending editor', (c) => { c.media.mediaEditorData = { hasEdits: () => false, getSending: () => true }; }],
    ['GIF', (c) => { c.media.isGif = true; }],
    ['view once model', (c) => { c.data.isViewOnce = true; }],
    ['view once control', (c) => c.toggle.setAttribute('aria-pressed', 'true')],
    ['missing control', (c) => c.toggle.remove()],
    ['fake toggle testid', (c) => { c.toggle.querySelector('title').textContent = 'different'; c.toggle.setAttribute('data-testid', 'view-once-toggle'); }],
    ['quote', (c) => { c.chat.composeQuotedMsg = {}; }],
    ['mention DOM', (c) => c.content.setAttribute('data-app-text-template', '\u200b123@c.us\u200b')],
    ['rich caption', (c) => { const strong = c.ui.document.createElement('strong'); strong.textContent = c.media.caption;
      c.content.replaceWith(strong); }],
    ['different model caption', (c) => { c.media.caption = 'Different source'; }],
    ['released bytes', (c) => { c.holder.released = true; }],
    ['invalid file hash', (c) => { c.data.filehash = 'not a hash'; }],
    ['unknown metadata', (c) => c.data.field('newPlatformFeature', true)],
    ['metadata bound', (c) => c.data.field('preview', 'x'.repeat(524289))],
    ['missing preview', (c) => c.previewRegion.remove()],
    ['wrong preview source', (c) => c.preview.setAttribute('src', 'blob:https://web.whatsapp.com/other')],
    ['disabled send', (c) => c.button.setAttribute('aria-disabled', 'true')],
  ];
  for (const [label, mutate] of cases) {
    const c = await captionFixture(); mutate(c); await tick();
    assert.equal(c.click().defaultPrevented, true, label); assert.equal(c.ui.poll().request, null, label);
    assert.equal(c.state.calls.length, 0, label); assert.equal(c.ui.state.sent.length, 0, label);
    assert.equal(c.ui.state.cleared.length, 0, label); assert.equal(c.drawer.isConnected, true, label);
  }
});

test('generic documents, new unproved PDF viewers and video sources other than the frozen preview are rejected', async () => {
  for (const [type, mutate] of [
    ['document', (c) => { c.media.mimetype = 'text/plain'; c.data.mimetype = 'text/plain'; }],
    ['document', (c) => { c.media.documentPageCount = 0; }],
    ['document', (c) => c.previewRegion.removeAttribute('data-js-attach-preview')],
    ['document', (c) => { c.media.isPasswordProtected = true; }],
    ['video', (c) => { c.preview.srcObject = {}; }],
    ['video', (c) => { c.preview.currentSrc = 'blob:https://web.whatsapp.com/another'; }],
    ['video', (c) => c.preview.append(c.ui.document.createElement('source'))],
  ]) {
    const c = await captionFixture({ type }); mutate(c); await tick(); c.click();
    assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 0);
  }
});

test('trusted button padding and keyboard activation work once; caption Enter is fenced without taking over Shift+Enter', async () => {
  const c = await captionFixture();
  assert.equal(c.click({ isTrusted: false }).defaultPrevented, false); assert.equal(c.ui.poll().request, null);
  assert.equal(c.enter().defaultPrevented, true); assert.equal(c.ui.poll().request, null);
  assert.equal(c.enter({ shiftKey: true }).defaultPrevented, false);
  const other = iconButton(c.ui.document, 'ic-send-filled', [sendPath]); c.ui.document.body.append(other);
  assert.equal(c.click({ target: other }).defaultPrevented, false); assert.equal(c.ui.poll().request, null);
  for (const key of ['Enter', ' ']) {
    const d = await captionFixture();
    const event = d.ui.document.fire('keydown', { key, target: d.button }); assert.equal(event.defaultPrevented, true);
    const request = d.ui.poll().request; assert.ok(request);
    d.click({ isTrusted: false }); d.ui.document.fire('keydown', { key, target: d.button, repeat: true });
    assert.deepEqual(d.ui.poll().request, request); assert.equal(d.state.calls.length, 0);
  }
  const request = start(c); assert.equal(request.attempt, 1);
});

test('a known Send icon whose production path changes is intercepted and rejected before admission', async () => {
  const c = await captionFixture(); c.button.querySelector('path').setAttribute('d', 'M0 0 L1 1'); await tick();
  assert.equal(c.click().defaultPrevented, true); assert.equal(c.ui.poll().request, null);
  assert.equal(c.enter({ target: c.button }).defaultPrevented, true); assert.equal(c.ui.poll().request, null);
  assert.equal(c.state.calls.length, 0); assert.equal(c.editor.innerText, c.media.caption);
});

test('wrong or missing transport receipt stays uncertain and cannot resend the unchanged attachment', async () => {
  const corruptions = [
    (r) => { r.messageSendResult = 'ERROR_UNKNOWN'; },
    (r) => { r.msg.ack = 0; },
    (r) => { r.msg.caption = 'Wrong caption'; },
    (r) => { r.msg.filehash = 'B'.repeat(43) + '='; },
    (r) => { r.msg.size += 1; },
    (r) => { r.msg.type = 'video'; },
    (r, _call, c) => { r.msg.id = new c.W.whatsapp.MsgKey('true_200@c.us_OTHER'); },
    (r, _call, c) => { r.msg.id = new c.W.whatsapp.MsgKey('true_100@c.us_DIFFERENT'); },
  ];
  for (const corrupt of corruptions) {
    const c = await captionFixture(); const request = start(c); c.ui.prepare(request, output);
    c.state.receipt = (result, call) => corrupt(result, call, c);
    const flight = c.ui.commit(request); await settle(); const value = c.ui.read(request, flight.permit).value;
    assert.equal(value.status, 'uncertain'); c.ui.deliver(request, { ...value, retryable: false });
    c.click(); assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 1);
    assert.equal(c.editor.innerText, request.text); assert.equal(c.drawer.isConnected, true);
  }
});

test('ACK wait remains the current heartbeat and changing another draft cannot clear or duplicate the old file', async () => {
  const c = await captionFixture(); const pending = deferred(); let call;
  c.state.transport = (value) => { call = value; return pending.promise; };
  const request = start(c); c.ui.prepare(request, output); const flight = c.ui.commit(request);
  await c.input('A deliberately different caption.'); c.click();
  assert.deepEqual(c.ui.poll().request, request); assert.equal(c.state.calls.length, 1);
  const key = new c.W.whatsapp.MsgKey('true_100@c.us_ACKWAIT'); call.options.onMsgKeyCreated(key);
  const msg = new c.W.whatsapp.MsgModel(key, '', '');
  Object.assign(msg, { caption: output, type: 'image', filehash: c.data.filehash, size: c.blob.size, ack: 1 });
  pending.resolve({ messageSendResult: 'OK', msg }); await settle();
  assert.equal(c.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.equal(c.editor.innerText, 'A deliberately different caption.'); assert.equal(c.ui.state.cleared.length, 0);
  c.click(); assert.deepEqual(c.ui.poll().request, request);
  c.ui.deliver(request, { ...c.ui.read(request, flight.permit).value, retryable: false });
  const next = start(c); assert.notEqual(next.id, request.id);
});

test('closing a preview releases model listeners and permits the original plain composer despite retained hidden nodes', async () => {
  const c = await captionFixture(); const request = start(c); c.ui.prepare(request, output);
  c.chat.attachMediaContents = null; c.editor.hidden = true; c.drawer.hidden = true;
  assert.equal(c.ui.poll().request, null); assert.equal(c.ui.commit(request).accepted, false);
  assert.equal(c.media.handlers.get('change:caption')?.size, 0); assert.equal(c.data.handlers.get('change:filehash')?.size, 0);
  c.ui.enter(); const plain = c.ui.poll().request; assert.ok(plain); assert.deepEqual(plain.context, { kind: 'plain' });
  assert.equal(c.state.calls.length, 0);
});

test('same caption on a changed preview never reuses an old attachment identity or stale prepare', async () => {
  const c = await captionFixture(); const first = start(c); c.ui.prepare(first, output);
  const nextBlob = new Blob(['Second file'], { type: 'image/png' }); const holder = new c.W.whatsapp.OpaqueData(nextBlob);
  const props = { ...c.data.toJSON(), mediaBlob: holder, size: nextBlob.size, filehash: 'C'.repeat(43) + '=' };
  const prep = new c.W.whatsapp.MediaPrep('image', Promise.resolve(props)); await prep.waitForPrep();
  c.media.mediaPrep = prep; c.media.file = holder; c.media.editedFile = holder;
  c.media.fullPreview = `blob:https://web.whatsapp.com/${randomUUID()}`;
  c.click(); assert.equal(c.ui.poll().request, null); assert.equal(c.ui.commit(first).accepted, false);
  c.background.src = c.media.fullPreview; c.preview.src = c.media.fullPreview; c.preview.setAttribute('src', c.media.fullPreview);
  const next = start(c); assert.notEqual(next.id, first.id); assert.notEqual(next.context.attachmentId, first.context.attachmentId);
  assert.equal(c.ui.prepare(first, output).ok, false); assert.equal(c.state.calls.length, 0);
});

test('the caption boundary counts Unicode code points and rejects an oversized result without transport', async () => {
  const accepted = await captionFixture({ caption: '中' + '🙂'.repeat(1023), policy: { includeZh: false } });
  const first = start(accepted); assert.equal([...first.text].length, 1024);
  assert.equal(accepted.ui.prepare(first, first.text, false).ok, true);
  const flight = accepted.ui.commit(first); await settle();
  assert.equal(accepted.ui.read(first, flight.permit).value.status, 'confirmed');
  const tooLong = await captionFixture({ caption: '🙂'.repeat(1025) }); tooLong.click(); assert.equal(tooLong.ui.poll().request, null);
  const c = await captionFixture(); const request = start(c);
  assert.deepEqual(c.ui.prepare(request, `${output} ${'test '.repeat(220)}`), { ok: false, code: 'TRANSLATION_OUTPUT_INVALID' });
  assert.equal(c.ui.commit(request).accepted, false); c.click(); assert.equal(c.ui.poll().request, null);
  assert.equal(c.state.calls.length, 0);
});

test('disabled translation passes through the platform attachment UI without creating a synthetic intent', async () => {
  const c = await captionFixture({ policy: { enabled: false, autoSend: false } });
  assert.equal(c.click().defaultPrevented, false); assert.equal(c.enter().defaultPrevented, false);
  assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 0);
});
