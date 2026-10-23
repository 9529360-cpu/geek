import assert from 'node:assert/strict';
import test from 'node:test';
import { guest, generation, deferred, tick } from './helpers/send-guest.mjs';

const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const failure = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };
const withReply = async (options) => { const ui = guest(); const reply = ui.reply(options); await tick(); return { ui, reply }; };

test('context is mandatory, exact and returned as a detached wire value for plain and reply', async () => {
  const plain = guest(); const plainRequest = start(plain);
  assert.deepEqual(plainRequest.context, { kind: 'plain' });
  const replyFixture = await withReply();
  for (const ui of [plain, replyFixture.ui]) {
    const request = ui === plain ? plainRequest : start(ui);
    const original = structuredClone(request.context);
    const exposed = ui.api.poll(generation).request;
    exposed.context.kind = 'forged'; exposed.context.messageId = 'changed';
    assert.deepEqual(ui.poll().request.context, original);
    assert.deepEqual(ui.prepare(request), { ok: true });
  }
  for (const invalid of [undefined, null, { kind: 'plain', messageId: 'extra' },
    { kind: 'reply', messageId: 'false_100@c.us_OTHER', chatId: '100@c.us' }]) {
    const { ui } = await withReply(); const request = start(ui);
    const outcome = ui.api.prepare(generation, ui.configuration.sessionGeneration, request.id,
      request.attempt, 'Invia 100 unità domani.', true, invalid);
    assert.equal(outcome.ok, false); assert.equal(ui.commit(request).accepted, false);
    assert.equal(ui.state.sent.length, 0); assert.equal(ui.editor.innerText, request.text);
  }
});

test('loaded model/key replies with a visible exact banner send the frozen model and retain the whole draft after ACK', async () => {
  for (const options of [{}, { byKey: true }, { byKey: true, chatStore: true }]) {
    const { ui, reply } = await withReply(options); const request = start(ui);
    assert.deepEqual(request.context, { kind: 'reply', messageId: reply.message.id.toString(), chatId: request.chatId });
    assert.equal(JSON.stringify(request).includes(reply.message.body), false);
    assert.deepEqual(ui.prepare(request), { ok: true });
    const flight = ui.commit(request); assert.equal(flight.accepted, true);
    assert.equal(ui.state.sent[0][0], request.chatId);
    assert.equal(ui.state.sent[0][1], 'Invia 100 unità domani.');
    assert.strictEqual(ui.state.sent[0][2].quotedMsg, reply.message);
    assert.deepEqual(Object.keys(ui.state.sent[0][2]).sort(), ['detectMentioned', 'linkPreview', 'quotedMsg', 'waitForAck']);
    assert.equal(ui.state.sent[0][2].detectMentioned, false); assert.equal(ui.state.sent[0][2].linkPreview, false);
    assert.equal(ui.state.sent[0][2].waitForAck, true);
    await tick();
    const outcome = ui.read(request, flight.permit).value;
    assert.deepEqual(outcome, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
    assert.equal(ui.state.cleared.length, 0); assert.equal(ui.editor.innerText, request.text);
    assert.equal(reply.body.innerText, reply.message.body); assert.equal(reply.banner.isConnected, true);
    ui.deliver(request, { ...outcome, retryable: false });
    assert.match(ui.feedback(), /已发送；输入框未清空/);
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  }
});

test('reply retries retain the paid identity, but changing the quoted message makes a different intent', async () => {
  const { ui, reply } = await withReply(); const first = start(ui); ui.deliver(first, failure);
  const retry = start(ui); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  ui.deliver(retry, failure); reply.banner.remove();
  const secondReply = ui.reply({ id: 'QUOTE2', body: 'A different original message.' }); await tick();
  const next = start(ui); assert.notEqual(next.id, first.id);
  assert.equal(next.context.messageId, secondReply.message.id.toString());
  assert.equal(ui.prepare(retry).ok, false); assert.equal(ui.commit(retry).accepted, false);
  assert.deepEqual(ui.poll().request, next); assert.equal(ui.state.sent.length, 0);
});

test('quote model A-to-B-to-A, loaded MsgKey body changes and banner-only changes fence old attempts', async () => {
  const mutations = [
    async (ui, reply) => {
      const key = ui.window.WPP.whatsapp.MsgKey.fromString('false_100@c.us_OTHER');
      ui.model(ui.state.chatId).composeQuotedMsg = key;
      ui.model(ui.state.chatId).composeQuotedMsg = reply.message.id;
    },
    async (_ui, reply) => { const body = reply.message.body; reply.message.body = 'Temporary'; reply.message.body = body; },
    async (_ui, reply) => { reply.message.type = 'image'; reply.message.type = 'chat'; },
    async (_ui, reply) => { const body = reply.body.textContent; reply.body.textContent = 'Temporary'; reply.body.textContent = body; await tick(); },
  ];
  for (const mutate of mutations) {
    const { ui, reply } = await withReply({ byKey: true }); const first = start(ui);
    assert.deepEqual(ui.prepare(first), { ok: true }); await mutate(ui, reply);
    assert.equal(ui.commit(first).accepted, false); assert.equal(ui.poll().request, null);
    assert.equal(ui.prepare(first).ok, false); assert.equal(ui.deliver(first, failure), false);
    const retry = start(ui); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    assert.ok(retry.composerRevision > first.composerRevision);
    assert.deepEqual(ui.prepare(retry), { ok: true }); assert.equal(ui.state.sent.length, 0);
    ui.api.revoke(generation);
    assert.equal(reply.message.handlers.get('change:body').size, 0);
    assert.equal(ui.model(ui.state.chatId).handlers.get('change:composeQuotedMsg').size, 0);
  }
});

test('unloaded, unverifiable or rich quote contexts fail before admission without changing the draft', async () => {
  const cases = [
    ['missing loaded model', (ui, reply) => ui.state.messages.delete(reply.message.id.toString())],
    ['unreplyable', (_ui, reply) => { reply.message.replyable = false; }],
    ['media model', (_ui, reply) => { reply.message.type = 'image'; }],
    ['missing body', (_ui, reply) => { reply.message.body = undefined; }],
    ['oversized body', (_ui, reply) => { reply.message.body = 'x'.repeat(10001); }],
    ['no banner', (_ui, reply) => reply.banner.remove()],
    ['truncated banner', (_ui, reply) => { reply.body.textContent = 'Original order…'; }],
    ['unverified author', (_ui, reply) => { reply.author.textContent = 'Unknown author'; }],
    ['unknown model author', (_ui, reply) => { reply.message.notifyName = undefined; reply.message.senderObj = null; }],
    ['fake quote model', (ui) => { ui.model(ui.state.chatId).composeQuotedMsg = { id: 'fake' }; }],
    ['quote-looking card with no model', (ui) => { ui.model(ui.state.chatId).composeQuotedMsg = null; }],
    ['wrong remote', (ui) => { ui.model(ui.state.chatId).composeQuotedMsgRemoteJid = '200@c.us'; }],
    ['admin context', (ui) => { ui.model(ui.state.chatId).quotedMsgAdminGroupJid = '1@g.us'; }],
    ['attachment', (ui) => { ui.model(ui.state.chatId).attachMediaContents = [{}]; }],
    ['extra edit text', (ui) => { const edit = ui.document.createElement('div'); edit.textContent = 'Editing message'; ui.footer.append(edit); }],
    ['preview', (ui, reply) => { reply.banner.setAttribute('data-testid', 'link-preview'); }],
    ['forward', (ui, reply) => { reply.banner.setAttribute('data-testid', 'forward-message'); }],
    ['media DOM', (ui, reply) => reply.banner.append(ui.document.createElement('img'))],
    ['unknown ancestor attribute', (_ui, reply) => reply.banner.setAttribute('data-unknown-context', 'true')],
    ['interactive ancestor', (_ui, reply) => reply.banner.setAttribute('role', 'button')],
    ['link ancestor', (ui, reply) => { const link = ui.document.createElement('a'); link.setAttribute('href', '#'); ui.footer.append(link); link.append(reply.banner); }],
    ['empty input in range', (ui, reply) => reply.banner.append(ui.document.createElement('input'))],
    ['empty select in range', (ui, reply) => reply.banner.append(ui.document.createElement('select'))],
  ];
  for (const [label, mutate] of cases) {
    const { ui, reply } = await withReply(); mutate(ui, reply); await tick();
    ui.enter(); assert.equal(ui.poll().request, null, label);
    assert.equal(ui.state.sent.length, 0, label); assert.equal(ui.state.cleared.length, 0, label);
    assert.equal(ui.editor.innerText, ui.state.text, label);
    assert.match(ui.feedback(), /当前草稿暂不支持发送翻译/, label);
  }
  const cross = await withReply({ chatId: '200@c.us' }); cross.ui.enter(); assert.equal(cross.ui.poll().request, null);
});

test('new DOM identity or newly unsupported context after translation cannot commit', async () => {
  for (const mutate of [
    (ui, reply) => { const body = ui.document.createElement('div'); body.textContent = reply.message.body; reply.body.replaceWith(body); },
    (ui, reply) => { const edit = ui.document.createElement('div'); edit.setAttribute('data-testid', 'edit-message'); reply.banner.append(edit); },
  ]) {
    const { ui, reply } = await withReply(); const request = start(ui); ui.prepare(request); mutate(ui, reply);
    // No observer turn is needed: the final synchronous CAS also rejects it.
    assert.equal(ui.commit(request).accepted, false); assert.equal(ui.state.sent.length, 0);
  }
});

test('ACK never clears reply context and quote-only changes cannot unlock a confirmed or uncertain draft', async () => {
  for (const confirmed of [true, false]) {
    const { ui, reply } = await withReply(); const pending = deferred(); ui.state.transport = () => pending.promise;
    const request = start(ui); ui.prepare(request); const flight = ui.commit(request);
    reply.banner.remove(); const replacement = ui.reply({ id: 'QUOTE2', body: 'Next selected quote.' }); await tick();
    pending.resolve(confirmed ? { id: 'ack', ack: 1 } : { id: 'unconfirmed', ack: 0 }); await tick();
    const result = ui.read(request, flight.permit).value;
    assert.equal(result.status, confirmed ? 'confirmed' : 'uncertain');
    assert.equal(ui.state.cleared.length, 0); assert.equal(replacement.banner.isConnected, true);
    assert.equal(ui.editor.innerText, request.text);
    ui.deliver(request, { ...result, retryable: false }); ui.enter(); ui.click();
    assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
    await ui.input('A deliberately new message.'); const next = start(ui); assert.notEqual(next.id, request.id);
  }
});
