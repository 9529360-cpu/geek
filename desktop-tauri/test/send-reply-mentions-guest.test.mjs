import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, generation, tick } from './helpers/send-guest.mjs';
import { mentionsFixture, mentionId, lidId, marker } from './helpers/whatsapp-mentions.mjs';
import { Media, Preview, previewUrl } from './helpers/whatsapp-reply.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const output = (request) => `Tradotto: ${request.text}`;
const failed = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };

async function fixture({ type = 'chat', byKey = false, ...options } = {}) {
  const f = mentionsFixture(options);
  const reply = f.ui.reply({ byKey, body: 'This quoted source stays inside the page.' });
  let image = null;
  if (type !== 'chat') {
    Object.assign(f.W.whatsapp, { MediaDataModel: Media, OpaqueData: Preview });
    const model = reply.message, mimetype = type === 'video' ? 'video/mp4' : 'image/jpeg';
    model.type = type; model.field('isMedia', true); model.field('isViewOnce', false);
    model.field('caption', 'The quoted blue product.'); model.field('mimetype', mimetype);
    model.field('filehash', 'synthetic-known-media-hash'); model.field('mediaData', new Media({ type, mimetype }));
    reply.body.textContent = model.caption;
    image = f.ui.document.createElement('img'); image.setAttribute('src', previewUrl); image.setAttribute('alt', '');
    reply.banner.append(image);
  }
  await tick();
  return { ...f, reply, image };
}

test('one composed send keeps both the exact quote and selected entities, with the whole draft retained after ACK', async () => {
  for (const type of ['chat', 'image', 'video']) for (const byKey of [false, true]) {
    const f = await fixture({ type, byKey, parts: ['😀 Hello ', { id: mentionId, name: 'Alice' }, ' and ',
      { id: lidId, name: 'Alice' }, ', again ', { id: mentionId, name: 'Alice' }, '.'] });
    const { ui, reply } = f, source = f.chat.getComposeContents().text, request = start(ui);
    assert.deepEqual(request.context, { kind: 'replyMentions', messageId: reply.message.id.toString(), chatId: request.chatId,
      mentions: [{ id: mentionId, offset: request.text.indexOf('@155'), length: 12 },
        { id: lidId, offset: request.text.indexOf('@987'), length: 13 },
        { id: mentionId, offset: request.text.lastIndexOf('@155'), length: 12 }] });
    for (const secret of [reply.message.body, reply.message.caption, previewUrl, 'Alice'].filter(Boolean)) {
      assert.equal(JSON.stringify(request).includes(secret), false);
    }
    assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true); await tick();
    const [target, text, options] = ui.state.sent[0];
    assert.equal(target, request.chatId); assert.equal(text, output(request)); assert.strictEqual(options.quotedMsg, reply.message);
    assert.deepEqual(copy(options.mentionedList), [mentionId, lidId]);
    assert.deepEqual(Object.keys(options).sort(), ['detectMentioned', 'linkPreview', 'mentionedList', 'quotedMsg', 'waitForAck']);
    assert.equal(options.waitForAck, true); assert.equal(options.detectMentioned, false); assert.equal(options.linkPreview, false);
    const result = ui.read(request, flight.permit).value;
    assert.deepEqual(result, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
    assert.equal(ui.state.cleared.length, 0); assert.equal(f.chat.getComposeContents().text, source);
    assert.ok(f.elements.every((node) => node.isConnected)); assert.equal(reply.banner.isConnected, true);
    ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
    assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  }
});

test('the combined wire context is detached and rejects missing, extra or changed quote and entity fields', async () => {
  const f = await fixture(), { ui } = f, request = start(ui);
  const exposed = ui.api.poll(generation).request;
  exposed.context.messageId = 'forged'; exposed.context.mentions[0].id = lidId;
  assert.deepEqual(ui.poll().request, request);
  const { mentions, ...onlyReply } = request.context;
  for (const context of [undefined, null, { ...onlyReply, kind: 'reply' }, { kind: 'mentions', mentions },
    { ...request.context, messageId: 'false_120363001@g.us_DIFFERENT' },
    { ...request.context, chatId: '120363002@g.us' }, { ...request.context, extra: true },
    { ...request.context, mentions: [] }, { ...request.context, mentions: null },
    { ...request.context, mentions: [{ ...mentions[0], offset: 0 }] },
    { ...request.context, mentions: [{ ...mentions[0], extra: 'ignored' }] },
  ]) {
    // A rejected prepare retires that attempt. Give every negative its own live
    // candidate so earlier rejection cannot make later context assertions pass.
    const candidate = await fixture(), attempt = start(candidate.ui);
    assert.deepEqual(candidate.ui.prepare(attempt, output(attempt)), { ok: true });
    const result = candidate.ui.api.prepare(generation, candidate.ui.configuration.sessionGeneration, attempt.id, attempt.attempt,
      output(attempt), true, context);
    assert.equal(result.ok, false);
    assert.equal(candidate.ui.commit(attempt).accepted, false);
    assert.equal(candidate.ui.state.sent.length, 0); assert.equal(candidate.ui.state.cleared.length, 0);
  }
  assert.equal(ui.state.sent.length, 0); assert.equal(ui.state.cleared.length, 0);
});

test('quote and entity A-to-B-to-A changes independently fence the attempt and an explicit retry retains its identity', async () => {
  const mutations = [
    ['quote model', (f) => { const old = f.chat.composeQuotedMsg; f.chat.composeQuotedMsg = null; f.chat.composeQuotedMsg = old; }],
    ['quote body', (f) => { const old = f.reply.message.body; f.reply.message.body = 'Temporary'; f.reply.message.body = old; }],
    ['quote nodes', (f) => { const old = f.reply.body.textContent; f.reply.body.textContent = 'Temporary'; f.reply.body.textContent = old; }],
    ['contact name', (f) => { const old = f.contacts.get(mentionId).name; f.contacts.get(mentionId).name = 'Temp'; f.contacts.get(mentionId).name = old; }],
    ['member', (f) => { const old = f.participants.remove(mentionId); f.participants.add(old); }],
    ['draft', (f) => { const old = f.chat.draftMessage; f.chat.draftMessage = { text: 'Temp', timestamp: 1 }; f.chat.draftMessage = old; }],
    ['both', (f) => {
      const old = f.chat.composeQuotedMsg; f.chat.composeQuotedMsg = null;
      const member = f.participants.remove(mentionId); f.participants.add(member); f.chat.composeQuotedMsg = old;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const f = await fixture({ byKey: true }), { ui } = f, first = start(ui);
    assert.deepEqual(ui.prepare(first, output(first)), { ok: true }); mutate(f); await tick();
    assert.equal(ui.commit(first).accepted, false, label); assert.equal(ui.poll().request, null, label);
    assert.equal(ui.prepare(first, output(first)).ok, false, label); assert.equal(ui.deliver(first, failed), false, label);
    const retry = start(ui); assert.equal(retry.id, first.id, label); assert.equal(retry.attempt, first.attempt + 1, label);
    assert.ok(retry.composerRevision > first.composerRevision, label);
    assert.deepEqual(ui.prepare(retry, output(retry)), { ok: true });
    ui.api.revoke(generation);
    assert.equal(f.reply.message.handlers.get('change:body')?.size, 0, label);
    assert.equal(f.contacts.get(mentionId).handlers.get('change:name')?.size, 0, label);
    assert.equal(f.participants.handlers.get('remove')?.size, 0, label);
    assert.equal(ui.state.sent.length, 0, label);
  }
});

test('the final synchronous comparison proves quote, thumbnail and entities without relying on an observer turn', async () => {
  const mutations = [
    ['quote DOM', (f) => {
      const replacement = f.ui.document.createElement('div'); replacement.textContent = f.reply.body.textContent;
      f.reply.body.replaceWith(replacement);
    }],
    ['quote model', (f) => {
      const Model = f.W.whatsapp.MsgModel, old = f.reply.message;
      f.ui.state.messages.set(old.id.toString(), new Model(old.id, old.body, old.notifyName));
    }],
    ['entity DOM', (f) => {
      const replacement = f.ui.document.createElement('span');
      for (const attr of f.elements[0].attributes) replacement.setAttribute(attr.name, attr.value);
      replacement.textContent = f.elements[0].textContent; f.elements[0].replaceWith(replacement);
    }],
    ['member model', (f) => f.participants.models.set(mentionId, new f.W.whatsapp.ParticipantModel(new f.W.whatsapp.Wid(mentionId)))],
    ['contact model', (f) => f.contacts.models.set(mentionId, new f.W.whatsapp.ContactModel('Alice', new f.W.whatsapp.Wid(mentionId)))],
    ['released thumbnail', (f) => { f.reply.message.mediaData.preview.released = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = await fixture({ type: label === 'released thumbnail' ? 'image' : 'chat', byKey: true });
    const request = start(f.ui); f.ui.prepare(request, output(request)); mutate(f);
    assert.equal(f.ui.commit(request).accepted, false, label); assert.equal(f.ui.state.sent.length, 0, label);
  }
});

test('valid mention proof cannot authorize unknown quote content or an attachment and valid quote proof cannot authorize an unknown entity', async () => {
  const mutations = [
    ['missing quote model', (f) => f.ui.state.messages.delete(f.reply.message.id.toString())],
    ['wrong quote chat', (f) => { f.chat.composeQuotedMsgRemoteJid = '999@g.us'; }],
    ['unverified quote author', (f) => { f.reply.author.textContent = 'Unknown'; }],
    ['unverified quote text', (f) => { f.reply.body.textContent = 'Unrelated'; }],
    ['quoted mention span', (f) => {
      const entity = f.ui.document.createElement('span'); entity.setAttribute('data-app-text-template', marker(mentionId));
      entity.setAttribute('data-lexical-text', 'true'); entity.textContent = f.reply.message.body;
      f.reply.body.replaceWith(entity);
    }],
    ['unverified entity', (f) => f.contacts.remove(mentionId)],
    ['unknown entity attribute', (f) => f.elements[0].setAttribute('data-unknown', 'context')],
    ['new attachment', (f) => { f.chat.attachMediaContents = [{}]; }],
    ['missing quoted thumbnail', (f) => f.image.remove()],
    ['view once', (f) => { f.reply.message.isViewOnce = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = await fixture({ type: ['missing quoted thumbnail', 'view once'].includes(label) ? 'image' : 'chat' });
    mutate(f); await tick(); const draft = f.chat.getComposeContents().text;
    f.ui.enter(); assert.equal(f.ui.poll().request, null, label); assert.equal(f.ui.state.generatedIds.length, 0, label);
    assert.equal(f.ui.state.sent.length, 0, label); assert.equal(f.ui.state.cleared.length, 0, label);
    assert.equal(f.chat.getComposeContents().text, draft, label);
  }
});

test('changing either frozen semantic component after a precommit failure creates a different intent', async () => {
  const f = await fixture(), { ui } = f, first = start(ui); ui.deliver(first, failed);
  const retry = start(ui); assert.equal(retry.id, first.id); ui.deliver(retry, failed);
  f.reply.banner.remove(); ui.reply({ id: 'NEXTQUOTE', body: 'Another quote.' }); await tick();
  const changedQuote = start(ui); assert.notEqual(changedQuote.id, first.id); ui.deliver(changedQuote, failed);
  f.setParts(['Hello ', { id: lidId, name: 'Alice' }, ', please confirm.'], { trusted: true }); await tick();
  const changedEntity = start(ui); assert.notEqual(changedEntity.id, changedQuote.id);
  assert.equal(ui.prepare(first, output(first)).ok, false); assert.equal(ui.prepare(changedQuote, output(changedQuote)).ok, false);
  assert.equal(ui.state.sent.length, 0);
});

test('identity translation exclusion keeps combined semantics without subscription or a paid transform', async () => {
  const f = await fixture({ parts: ['你好 ', { id: mentionId, name: 'Alice' }], policy: { includeZh: false }, session: null });
  const request = start(f.ui);
  assert.deepEqual(f.ui.prepare(request, request.text, false, null), { ok: true });
  const flight = f.ui.commit(request); await tick();
  assert.equal(f.ui.state.sent[0][1], request.text); assert.strictEqual(f.ui.state.sent[0][2].quotedMsg, f.reply.message);
  assert.deepEqual(copy(f.ui.state.sent[0][2].mentionedList), [mentionId]);
  assert.equal(f.ui.read(request, flight.permit).value.status, 'confirmed'); assert.equal(f.ui.state.cleared.length, 0);
});

test('missing ACK, transport rejection and timeout remain uncertain and never resend a combined draft', async () => {
  for (const state of ['no receipt', 'unacked', 'rejected', 'timeout']) {
    const f = await fixture(), { ui } = f, pending = deferred(); ui.state.transport = () => pending.promise;
    const request = start(ui); ui.prepare(request, output(request)); const flight = ui.commit(request);
    if (state === 'rejected') pending.reject(new Error('Synthetic rejection'));
    else if (state === 'no receipt') pending.resolve({ ack: 1 });
    else if (state === 'unacked') pending.resolve({ id: 'unconfirmed', ack: 0 });
    else { ui.state.now = 50001; ui.poll(); pending.resolve({ id: 'late', ack: 1 }); }
    await tick(); const result = ui.read(request, flight.permit).value;
    assert.equal(result.status, 'uncertain', state); assert.equal(ui.state.cleared.length, 0, state);
    ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
    assert.equal(ui.poll().request, null, state); assert.equal(ui.state.sent.length, 1, state);
    assert.equal(f.reply.banner.isConnected, true, state); assert.ok(f.elements.every((node) => node.isConnected), state);
  }
});

test('a late ACK preserves a newer quote and entities; context-only changes and disabling translation do not unlock replay', async () => {
  const f = await fixture(), { ui } = f, pending = deferred(); ui.state.transport = () => pending.promise;
  const request = start(ui); ui.prepare(request, output(request)); const flight = ui.commit(request);
  f.reply.banner.remove(); const next = ui.reply({ id: 'NEWQUOTE', body: 'The newer quote.' });
  // Same numeric user in another explicit namespace preserves canonical source
  // text but is a materially different entity, never a reason to resend.
  f.setParts(['Hello ', { id: '15550001111@lid', name: 'Another Alice' }, ', please confirm.']); await tick();
  const newDraft = f.chat.getComposeContents().text;
  pending.resolve({ id: 'ack', ack: 1 }); await tick(); const result = ui.read(request, flight.permit).value;
  assert.equal(result.status, 'confirmed'); assert.equal(result.draftCleared, false);
  assert.equal(next.banner.isConnected, true); assert.equal(f.chat.getComposeContents().text, newDraft);
  assert.equal(ui.state.cleared.length, 0); ui.deliver(request, { ...result, retryable: false });
  ui.enter(); assert.equal(ui.poll().request, null);
  ui.configuration.settings.revision += 1; ui.configuration.settings.global.enabled = false;
  ui.configuration.settings.global.autoSend = false; ui.configure();
  assert.equal(ui.enter().defaultPrevented, true); assert.equal(ui.click().defaultPrevented, true);
  assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
});
