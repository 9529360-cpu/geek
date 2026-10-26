import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, generation, tick } from './helpers/send-guest.mjs';
import { mediaReply, Media, Preview, previewUrl } from './helpers/whatsapp-reply.mjs';

const translated = 'Invia 100 unità domani.';
const withMedia = async (options) => { const fixture = mediaReply(options); await tick(); return fixture; };
const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const notSubmitted = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };

test('composed image/video reply sends the loaded model, never its caption or thumbnail, and ACK preserves the full draft', async () => {
  for (const type of ['image', 'video']) for (const byKey of [false, true]) {
    const { ui, model, reply, image } = await withMedia({ type, byKey });
    const request = start(ui);
    assert.deepEqual(request.context, { kind: 'reply', messageId: model.id.toString(), chatId: request.chatId });
    assert.equal(JSON.stringify(request).includes(model.caption), false);
    assert.equal(JSON.stringify(request).includes(previewUrl), false);
    assert.equal(JSON.stringify(request).includes(model.body), false);
    assert.deepEqual(ui.prepare(request, translated), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true);
    assert.equal(ui.state.sent.length, 1);
    const [target, output, options] = ui.state.sent[0];
    assert.equal(target, request.chatId); assert.equal(output, translated);
    assert.strictEqual(options.quotedMsg, model);
    assert.deepEqual(Object.keys(options).sort(), ['detectMentioned', 'linkPreview', 'quotedMsg', 'waitForAck']);
    assert.equal(options.waitForAck, true); assert.equal(options.detectMentioned, false); assert.equal(options.linkPreview, false);
    await tick();
    const result = ui.read(request, flight.permit).value;
    assert.deepEqual(result, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
    assert.equal(ui.editor.innerText, request.text); assert.equal(ui.state.cleared.length, 0);
    assert.equal(reply.body.innerText, model.caption); assert.equal(image.isConnected, true);
    assert.strictEqual(ui.model(request.chatId).composeQuotedMsg, byKey ? model.id : model);
    assert.equal(ui.deliver(request, { ...result, retryable: false }), true);
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  }
});

test('captioned audio, voice and ordinary file replies quote the loaded message without a thumbnail', async () => {
  const cases = [
    ['audio', 'audio/ogg; codecs=opus'],
    ['ptt', 'audio/ogg'],
    ['document', 'application/zip'],
  ];
  for (const [type, mime] of cases) {
    const fixture = await withMedia({ type });
    fixture.image.remove();
    fixture.model.mimetype = mime;
    fixture.model.mediaData.mimetype = mime;
    fixture.model.mediaData.type = type;
    const duration = fixture.ui.document.createElement('span');
    duration.textContent = '0:03';
    fixture.reply.banner.append(duration);
    const { ui, model } = fixture;
    const request = start(ui);
    assert.equal(request.context.kind, 'reply', type);
    assert.equal(JSON.stringify(request).includes(model.caption), false, type);
    assert.deepEqual(ui.prepare(request, translated), { ok: true });
    ui.commit(request); await tick();
    const [target, output, options] = ui.state.sent[0];
    assert.equal(target, request.chatId, type);
    assert.equal(output, translated, type);
    assert.strictEqual(options.quotedMsg, model, type);
    assert.equal(options.linkPreview, false, type);
    assert.equal(options.detectMentioned, false, type);
    assert.equal(ui.editor.innerText, request.text, type);
    assert.equal(ui.state.cleared.length, 0, type);
  }
});

test('model and nested media A-to-B-to-A changes fence prepared attempts and retain the same paid intent on a new gesture', async () => {
  const changes = [
    ['caption', (f) => { const value = f.model.caption; f.model.caption = 'Temporary caption'; f.model.caption = value; }],
    ['view once', (f) => { f.model.isViewOnce = true; f.model.isViewOnce = false; }],
    ['media preview', (f) => { const value = f.model.mediaData.preview; f.model.mediaData.preview = new Preview(); f.model.mediaData.preview = value; }],
    ['media hash', (f) => { const value = f.model.mediaData.filehash; f.model.mediaData.filehash = 'temporary'; f.model.mediaData.filehash = value; }],
    ['media model', (f) => { const value = f.model.mediaData; f.model.mediaData = new Media(); f.model.mediaData = value; }],
  ];
  for (const [label, mutate] of changes) {
    const fixture = await withMedia({ byKey: true }); const { ui, model } = fixture;
    const first = start(ui); assert.deepEqual(ui.prepare(first, translated), { ok: true });
    mutate(fixture);
    assert.equal(ui.commit(first).accepted, false, label); assert.equal(ui.poll().request, null, label);
    assert.equal(ui.prepare(first, translated).ok, false, label); assert.equal(ui.deliver(first, notSubmitted), false, label);
    const retry = start(ui); assert.equal(retry.id, first.id, label); assert.equal(retry.attempt, first.attempt + 1, label);
    assert.ok(retry.composerRevision > first.composerRevision, label);
    assert.deepEqual(ui.prepare(retry, translated), { ok: true });
    const flight = ui.commit(retry); assert.equal(flight.accepted, true, label); await tick();
    assert.equal(ui.read(retry, flight.permit).value.status, 'confirmed', label);
    assert.equal(ui.state.generatedIds.length, 1, label); assert.equal(ui.state.sent.length, 1, label);
    ui.api.revoke(generation);
    assert.equal(model.handlers.get('change:caption').size, 0, label);
    assert.equal(model.mediaData.handlers.get('change:preview').size, 0, label);
  }
});

test('thumbnail attributes changed and restored before the next poll still cancel the old attempt', async () => {
  for (const [name, value] of [['src', `${previewUrl.slice(0, -1)}2`], ['srcset', `${previewUrl} 2x`], ['alt', 'Different image'], ['aria-hidden', 'true']]) {
    const { ui, image } = await withMedia(); const first = start(ui); ui.prepare(first, translated);
    const original = image.getAttribute(name); image.setAttribute(name, value);
    if (original === null) image.removeAttribute(name); else image.setAttribute(name, original);
    await tick();
    assert.equal(ui.commit(first).accepted, false, name); assert.equal(ui.state.sent.length, 0, name);
    const retry = start(ui); assert.equal(retry.id, first.id, name); assert.ok(retry.composerRevision > first.composerRevision, name);
  }
});

test('final synchronous CAS rejects a replaced thumbnail or changed opaque preview even before observer delivery', async () => {
  const changes = [
    ['thumbnail node', (f) => {
      const next = f.ui.document.createElement('img'); next.setAttribute('src', previewUrl); next.setAttribute('alt', '');
      f.image.replaceWith(next);
    }],
    ['opaque URL', (f) => {
      const next = `${previewUrl.slice(0, -1)}2`; f.model.mediaData.preview.previewUrl = next; f.image.setAttribute('src', next);
    }],
    ['opaque size', (f) => { f.model.mediaData.preview.previewSize += 1; }],
    ['released preview', (f) => { f.model.mediaData.preview.released = true; }],
  ];
  for (const [label, mutate] of changes) {
    const fixture = await withMedia(); const request = start(fixture.ui); fixture.ui.prepare(request, translated);
    mutate(fixture);
    assert.equal(fixture.ui.commit(request).accepted, false, label);
    assert.equal(fixture.ui.state.sent.length, 0, label); assert.equal(fixture.ui.state.cleared.length, 0, label);
  }
});

test('media proof does not authorize unknown banner structure, mentions, attachments or unsupported media contexts', async () => {
  const changes = [
    ['no caption', (f) => { f.model.caption = ''; f.reply.body.textContent = ''; }],
    ['caption mismatch', (f) => { f.reply.body.textContent = 'A different caption'; }],
    ['unverified author', (f) => { f.reply.author.textContent = 'Unknown author'; }],
    ['no thumbnail', (f) => f.image.remove()],
    ['unrelated thumbnail', (f) => f.ui.footer.append(f.image)],
    ['interactive banner', (f) => f.reply.banner.setAttribute('role', 'button')],
    ['unknown ancestor', (f) => f.reply.banner.setAttribute('data-unknown-context', 'true')],
    ['attachment preview', (f) => { f.ui.model(f.ui.state.chatId).attachMediaContents = [{ file: 'synthetic' }]; }],
    ['document', (f) => { f.model.type = 'document'; }],
    ['view once', (f) => { f.model.isViewOnce = true; }],
    ['mention', (f) => {
      const entity = f.ui.document.createElement('span'); entity.setAttribute('data-mention-jid', '200@c.us'); entity.textContent = 'Alice';
      f.ui.editor.textContent = ''; f.ui.editor.append(entity); f.ui.state.text = 'Alice';
    }],
  ];
  for (const [label, mutate] of changes) {
    const fixture = await withMedia(); mutate(fixture); await tick(); const { ui } = fixture;
    ui.enter(); assert.equal(ui.poll().request, null, label);
    assert.equal(ui.state.generatedIds.length, 0, label); assert.equal(ui.state.sent.length, 0, label);
    assert.equal(ui.state.cleared.length, 0, label); assert.equal(ui.editor.innerText, ui.state.text, label);
  }
});

test('missing receipt, rejected ACK and timeout stay uncertain and never resend or clear a media reply', async () => {
  for (const outcome of ['missing', 'unacked', 'rejected', 'timeout']) {
    const { ui, image, reply } = await withMedia({ type: 'video' }); const pending = deferred();
    ui.state.transport = () => pending.promise;
    const request = start(ui); ui.prepare(request, translated); const flight = ui.commit(request);
    assert.equal(flight.accepted, true); assert.equal(ui.state.sent.length, 1);
    if (outcome === 'timeout') {
      ui.state.now = 50001; assert.equal(ui.read(request, flight.permit).value.status, 'uncertain');
      pending.resolve({ id: 'late-ack', ack: 1 });
    } else if (outcome === 'rejected') pending.reject(new Error('Synthetic transport rejection'));
    else pending.resolve(outcome === 'missing' ? { ack: 1 } : { id: 'unacked', ack: 0 });
    await tick();
    const result = ui.read(request, flight.permit).value;
    assert.equal(result.status, 'uncertain', outcome);
    assert.equal(ui.deliver(request, { ...result, retryable: false }), true);
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null, outcome);
    assert.equal(ui.commit(request).accepted, false, outcome); assert.equal(ui.state.sent.length, 1, outcome);
    assert.equal(ui.state.cleared.length, 0, outcome); assert.equal(ui.editor.innerText, request.text, outcome);
    assert.equal(reply.banner.isConnected, true, outcome); assert.equal(image.isConnected, true, outcome);
  }
});

test('a late media ACK cannot clear a newer quote, and quote-only changes cannot unlock the confirmed intent', async () => {
  const { ui, reply } = await withMedia(); const pending = deferred(); ui.state.transport = () => pending.promise;
  const request = start(ui); ui.prepare(request, translated); const flight = ui.commit(request);
  reply.banner.remove(); const newer = ui.reply({ id: 'NEXTQUOTE', body: 'The next selected text quote.' }); await tick();
  pending.resolve({ id: 'late-confirmed', ack: 1 }); await tick();
  const result = ui.read(request, flight.permit).value;
  assert.deepEqual(result, { status: 'confirmed', receipt: 'late-confirmed', draftCleared: false });
  assert.equal(ui.state.cleared.length, 0); assert.equal(newer.banner.isConnected, true); assert.equal(ui.editor.innerText, request.text);
  ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
  assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  await ui.input('A deliberately new reply.'); const next = start(ui);
  assert.notEqual(next.id, request.id); assert.equal(next.context.messageId, newer.message.id.toString());
});
