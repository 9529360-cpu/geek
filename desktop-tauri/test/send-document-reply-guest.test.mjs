import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, generation, tick } from './helpers/send-guest.mjs';
import { documentReply, DocumentMedia, fullPreviewUrl, thumbnailStyle } from './helpers/whatsapp-document-reply.mjs';
import { Preview, previewUrl } from './helpers/whatsapp-reply.mjs';
import { mentionId } from './helpers/whatsapp-mentions.mjs';

const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const output = (request) => `Tradotto: ${request.text}`;
const fixture = async (options) => { const value = documentReply(options); await tick(); return value; };
const copy = (value) => JSON.parse(JSON.stringify(value));
const failed = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };

test('a loaded captioned PDF uses the actual CSS thumbnail shape and sends only its original quote model', async () => {
  for (const previews of ['preview', 'full', 'both', 'base64']) for (const byKey of [false, true]) {
    const f = await fixture({ previews, byKey }), { ui, model } = f;
    const request = start(ui);
    assert.deepEqual(request.context, { kind: 'reply', messageId: model.id.toString(), chatId: request.chatId });
    for (const privateValue of [model.caption, model.body, model.filename, f.previewUrl, f.fullPreviewUrl]) {
      assert.equal(JSON.stringify(request).includes(privateValue), false);
    }
    assert.equal(f.backgrounds.length, previews === 'both' ? 2 : 1);
    assert.ok(f.backgrounds.every((node) => node.tagName === 'DIV' && !node.childNodes.length));
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true); await tick();
    assert.equal(ui.state.sent.length, 1);
    const [target, text, options] = ui.state.sent[0];
    assert.equal(target, request.chatId); assert.equal(text, output(request)); assert.strictEqual(options.quotedMsg, model);
    assert.deepEqual(Object.keys(options).sort(), ['detectMentioned', 'linkPreview', 'quotedMsg', 'waitForAck']);
    const result = ui.read(request, flight.permit).value;
    assert.deepEqual(result, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
    assert.equal(ui.editor.innerText, request.text); assert.equal(ui.state.cleared.length, 0);
    assert.equal(f.reply.banner.isConnected, true); assert.ok(f.backgrounds.every((node) => node.isConnected));
    ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
    assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  }
});

test('PDF replies with selected contacts retain both independently proved contexts and never disclose the quote to translation', async () => {
  for (const previews of ['preview', 'full', 'both', 'base64']) {
    const f = await fixture({ previews, withMentions: true, byKey: true }), { ui, model } = f;
    const request = start(ui), draft = f.chat.getComposeContents().text;
    assert.deepEqual(request.context, { kind: 'replyMentions', messageId: model.id.toString(), chatId: request.chatId,
      mentions: [{ id: mentionId, offset: request.text.indexOf('@155'), length: 12 }] });
    assert.equal(JSON.stringify(request).includes(model.caption), false);
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true); await tick();
    assert.strictEqual(ui.state.sent[0][2].quotedMsg, model);
    assert.deepEqual(copy(ui.state.sent[0][2].mentionedList), [mentionId]);
    assert.deepEqual(ui.read(request, flight.permit).value, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
    assert.equal(f.chat.getComposeContents().text, draft); assert.equal(ui.state.cleared.length, 0);
    assert.ok(f.elements.every((node) => node.isConnected)); assert.ok(f.backgrounds.every((node) => node.isConnected));
  }
});

test('document metadata and both preview owners fence A-to-B-to-A attempts while explicit retries retain the paid identity', async () => {
  const roundTrip = (object, field, value) => { const old = object[field]; object[field] = value; object[field] = old; };
  const changes = [
    ['caption ownership', (f) => roundTrip(f.model, 'isCaptionByUser', false)],
    ['template', (f) => roundTrip(f.model, 'isFromTemplate', true)],
    ['dynamic buttons', (f) => roundTrip(f.model, 'isDynamicReplyButtonsMsg', true)],
    ['vCard', (f) => roundTrip(f.model, 'isVcardOverMmsDocument', true)],
    ['footer', (f) => roundTrip(f.model, 'footer', 'Temporary')],
    ['filename', (f) => roundTrip(f.model, 'filename', 'other.pdf')],
    ['size', (f) => roundTrip(f.model, 'size', 4096)],
    ['pages', (f) => roundTrip(f.model, 'pageCount', 4)],
    ['media filename', (f) => roundTrip(f.model.mediaData, 'filename', 'other.pdf')],
    ['media size', (f) => roundTrip(f.model.mediaData, 'size', 4096)],
    ['media pages', (f) => roundTrip(f.model.mediaData, 'pageCount', 4)],
    ['media vCard', (f) => roundTrip(f.model.mediaData, 'isVcardOverMmsDocument', true)],
    ['password', (f) => roundTrip(f.model.mediaData, 'isPasswordProtected', true)],
    ['preview', (f) => roundTrip(f.model.mediaData, 'preview', new Preview())],
    ['full preview', (f) => roundTrip(f.model.mediaData, 'fullPreviewData', new Preview({ url: fullPreviewUrl }))],
    ['media owner', (f) => roundTrip(f.model, 'mediaData', new DocumentMedia())],
  ];
  for (const [label, mutate] of changes) {
    const f = await fixture({ byKey: true }), { ui } = f, request = start(ui);
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true }); mutate(f);
    assert.equal(ui.commit(request).accepted, false, label); assert.equal(ui.state.sent.length, 0, label);
    assert.equal(ui.prepare(request, output(request)).ok, false, label); assert.equal(ui.deliver(request, failed), false, label);
    const retry = start(ui);
    assert.equal(retry.id, request.id, label); assert.equal(retry.attempt, request.attempt + 1, label);
    assert.ok(retry.composerRevision > request.composerRevision, label);
    assert.deepEqual(ui.prepare(retry, output(retry)), { ok: true });
    const flight = ui.commit(retry); assert.equal(flight.accepted, true, label); await tick();
    assert.equal(ui.read(retry, flight.permit).value.status, 'confirmed', label);
    assert.equal(ui.state.sent.length, 1, label); assert.equal(ui.state.generatedIds.length, 1, label);
    ui.api.revoke(generation);
    assert.equal(f.model.handlers.get('change:isCaptionByUser').size, 0, label);
    assert.equal(f.model.mediaData.handlers.get('change:fullPreviewData').size, 0, label);
  }
});

test('each real CSS background has an ABA barrier, including a change restored before the next read', async () => {
  for (const index of [0, 1]) {
    const f = await fixture({ withMentions: true }), { ui } = f, request = start(ui), node = f.backgrounds[index];
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
    const old = node.getAttribute('style');
    node.setAttribute('style', thumbnailStyle('blob:https://web.whatsapp.com/00000000-0000-4000-8000-000000000033'));
    node.setAttribute('style', old); await tick();
    assert.equal(ui.commit(request).accepted, false); assert.equal(ui.state.sent.length, 0);
    const retry = start(ui); assert.equal(retry.id, request.id); assert.ok(retry.composerRevision > request.composerRevision);
    assert.deepEqual(ui.prepare(retry, output(retry)), { ok: true });
  }
});

test('final synchronous checks reject changed opaque metadata or identical-looking replacement owners before observer delivery', async () => {
  const changes = [
    ['preview URL', (f) => {
      const url = `${previewUrl.slice(0, -1)}3`; f.model.mediaData.preview.previewUrl = url;
      f.backgrounds[0].setAttribute('style', thumbnailStyle(url));
    }],
    ['full preview URL', (f) => {
      const url = `${fullPreviewUrl.slice(0, -1)}3`; f.model.mediaData.fullPreviewData.previewUrl = url;
      f.backgrounds[1].setAttribute('style', thumbnailStyle(url));
    }],
    ['full preview size', (f) => { f.model.mediaData.fullPreviewData.previewSize += 1; }],
    ['full preview type', (f) => { f.model.mediaData.fullPreviewData.previewType = 'image/png'; }],
    ['full preview released', (f) => { f.model.mediaData.fullPreviewData.released = true; }],
    ['background node', (f) => {
      const node = f.ui.document.createElement('div'); node.setAttribute('style', f.backgrounds[0].getAttribute('style'));
      f.backgrounds[0].replaceWith(node);
    }],
    ['history model', (f) => {
      const { MsgModel, MsgKey } = f.ui.window.WPP.whatsapp;
      const next = new MsgModel(new MsgKey(f.model.id.toString()), f.model.body, f.model.notifyName);
      for (const name of ['type', 'isMedia', 'isViewOnce', 'mimetype', 'filehash', 'caption', 'isCaptionByUser', 'isFromTemplate',
        'isDynamicReplyButtonsMsg', 'isVcardOverMmsDocument', 'footer', 'subtype', 'filename', 'pageCount', 'size', 'mediaData']) {
        next.field(name, f.model[name]);
      }
      f.ui.state.messages.set(f.model.id.toString(), next);
    }],
  ];
  for (const [label, mutate] of changes) {
    const f = await fixture({ byKey: true }), { ui } = f, request = start(ui);
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true }); mutate(f);
    assert.equal(ui.commit(request).accepted, false, label);
    assert.equal(ui.state.sent.length, 0, label); assert.equal(ui.state.cleared.length, 0, label);
  }
});

test('a PDF proof cannot authorize unknown CSS, ambiguous previews, missing captions or special document semantics', async () => {
  const changes = [
    ['caption flag absent', (f) => { f.model.isCaptionByUser = undefined; }],
    ['generated caption', (f) => { f.model.isCaptionByUser = false; }],
    ['empty caption', (f) => { f.model.caption = ''; f.reply.body.textContent = ''; }],
    ['wrong caption', (f) => { f.reply.body.textContent = 'Other source'; }],
    ['wrong author', (f) => { f.reply.author.textContent = 'Not the quoted author'; }],
    ['template document', (f) => { f.model.isFromTemplate = true; }],
    ['buttons document', (f) => { f.model.isDynamicReplyButtonsMsg = true; }],
    ['vCard document', (f) => { f.model.isVcardOverMmsDocument = true; }],
    ['view once', (f) => { f.model.isViewOnce = true; }],
    ['unknown subtype', (f) => { f.model.subtype = 'unknown'; }],
    ['footer content', (f) => { f.model.footer = 'Additional text'; }],
    ['other MIME', (f) => { f.model.mimetype = f.model.mediaData.mimetype = 'application/msword'; }],
    ['other filename', (f) => { f.model.filename = f.model.mediaData.filename = 'order.doc'; }],
    ['different metadata', (f) => { f.model.mediaData.pageCount = 4; }],
    ['unloaded full preview', (f) => { f.model.mediaData.fullPreviewData = { url: () => fullPreviewUrl }; }],
    ['no previews', (f) => { f.model.mediaData.preview = f.model.mediaData.fullPreviewData = null; f.thumbnailRoot.remove(); }],
    ['raw preview only', (f) => { f.model.mediaData.preview = 'c3ludGhldGlj'; f.model.mediaData.fullPreviewData = null; }],
    ['remote URL', (f) => {
      f.model.mediaData.preview.previewUrl = 'https://example.invalid/preview.jpg';
      f.backgrounds[0].setAttribute('style', thumbnailStyle(f.model.mediaData.preview.previewUrl));
    }],
    ['same preview URL twice', (f) => {
      f.model.mediaData.fullPreviewData.previewUrl = previewUrl; f.backgrounds[1].setAttribute('style', thumbnailStyle(previewUrl));
    }],
    ['missing background', (f) => f.backgrounds[1].remove()],
    ['extra background', (f) => {
      const node = f.ui.document.createElement('div'); node.setAttribute('style', thumbnailStyle(previewUrl)); f.thumbnailRoot.append(node);
    }],
    ['reordered backgrounds', (f) => f.thumbnailRoot.append(f.backgrounds[0])],
    ['outside quote', (f) => f.ui.footer.append(f.backgrounds[1])],
    ['CSS image list', (f) => f.backgrounds[0].setAttribute('style', `background-image: url("${previewUrl}"), url("${fullPreviewUrl}");`)],
    ['CSS shorthand', (f) => f.backgrounds[0].setAttribute('style', `background: url("${previewUrl}");`)],
    ['additional CSS', (f) => f.backgrounds[0].setAttribute('style', `${thumbnailStyle(previewUrl)} opacity: 0;`)],
    ['gradient', (f) => f.backgrounds[0].setAttribute('style', `background-image: linear-gradient(red, blue), url("${previewUrl}");`)],
    ...['background-image/**/', 'backgr\\6fund-image', 'content'].map((property) => [`unproved CSS ${property}`, (f) => {
      const node = f.ui.document.createElement('div'); node.setAttribute('style', `${property}: url("${previewUrl}");`);
      f.thumbnailRoot.append(node);
    }]),
    ['interactive thumbnail', (f) => f.thumbnailRoot.setAttribute('role', 'button')],
    ['unexpected thumbnail attribute', (f) => f.backgrounds[0].setAttribute('data-context', 'unknown')],
    ['thumbnail child', (f) => f.backgrounds[0].append(f.ui.document.createElement('span'))],
    ['extra image', (f) => { const node = f.ui.document.createElement('img'); node.setAttribute('src', previewUrl); f.reply.banner.append(node); }],
    ['pending attachment', (f) => { f.ui.model(f.ui.state.chatId).attachMediaContents = [{ file: 'synthetic' }]; }],
  ];
  for (const [label, mutate] of changes) for (const withMentions of [false, true]) {
    const f = await fixture({ withMentions }), { ui } = f; mutate(f); await tick();
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null, `${label}/${withMentions}`);
    assert.equal(ui.state.generatedIds.length, 0, label); assert.equal(ui.state.sent.length, 0, label);
    assert.equal(ui.state.cleared.length, 0, label);
  }
});

test('lost PDF reply receipts stay uncertain and an intact quote cannot unlock replay', async () => {
  for (const outcome of ['missing', 'unacked', 'rejected', 'timeout']) {
    const f = await fixture(), { ui } = f, pending = deferred(); ui.state.transport = () => pending.promise;
    const request = start(ui); assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true);
    if (outcome === 'timeout') {
      ui.state.now = 50001; assert.equal(ui.read(request, flight.permit).value.status, 'uncertain');
      pending.resolve({ id: 'late-confirmed', ack: 1 });
    } else if (outcome === 'rejected') pending.reject(new Error('Synthetic transport rejection'));
    else pending.resolve(outcome === 'missing' ? { ack: 1 } : { id: 'unacked', ack: 0 });
    await tick();
    const result = ui.read(request, flight.permit).value; assert.equal(result.status, 'uncertain', outcome);
    assert.equal(ui.deliver(request, { ...result, retryable: false }), true);
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null); assert.equal(ui.commit(request).accepted, false);
    assert.equal(ui.state.sent.length, 1); assert.equal(ui.state.cleared.length, 0); assert.equal(ui.editor.innerText, request.text);
    assert.equal(f.reply.banner.isConnected, true); assert.ok(f.backgrounds.every((node) => node.isConnected));
  }
});

test('late PDF ACK settles the original intent without clearing a newer quote or releasing its replay barrier', async () => {
  const f = await fixture(), { ui } = f, pending = deferred(); ui.state.transport = () => pending.promise;
  const request = start(ui); assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
  const flight = ui.commit(request); assert.equal(flight.accepted, true);
  f.reply.banner.remove(); const next = ui.reply({ id: 'NEXTQUOTE', body: 'A newer quote.' }); await tick();
  pending.resolve({ id: 'late-confirmed', ack: 1 }); await tick();
  const result = ui.read(request, flight.permit).value;
  assert.deepEqual(result, { status: 'confirmed', receipt: 'late-confirmed', draftCleared: false });
  ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
  assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1); assert.equal(ui.state.cleared.length, 0);
  assert.equal(ui.editor.innerText, request.text); assert.equal(next.banner.isConnected, true);
});
