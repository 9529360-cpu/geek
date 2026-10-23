import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramFixture, installTelegramReply, deferred, flush } from './helpers/telegram-send.mjs';

const frozen = (f) => { const value = f.composer.read(); return { ...value, composerState: value }; };
const copy = (value) => JSON.parse(JSON.stringify(value));

test('whole-message reply binds the actual input, history source, visible author and canonical server identity', () => {
  for (const peer of [101, -202, -303]) {
    const f = telegramFixture();
    if (peer === -303) f.state.peers.set(peer, { _: 'chat', id: 303, pFlags: {}, title: 'Basic group' });
    f.chat.peerId = peer; f.location.hash = `#${peer}`;
    const quote = installTelegramReply(f);
    const record = frozen(f);
    assert.deepEqual(copy(record.context), { kind: 'reply', chatId: `tg:${peer}`, messageId: `tg:${peer}:51` });
    assert.equal(record.quoteModel, quote.model); assert.equal(record.quoteRegion, quote.region);
    assert.equal(record.quoteBody, quote.model.message);
    assert.equal(record.composerState.telegramReply.mid, quote.model.mid);
    assert.equal(f.input.getCurrentInputAsDraft().reply_to.reply_to_msg_id, quote.model.mid);
    assert.equal(f.composer.matches(record, f.composer.read()), true);
    assert.equal(f.composer.clear(record), false);
    assert.equal(f.state.clears.length, 0); assert.equal(f.state.sends.length, 0);
  }
});

test('official 110/111 UTF-16 preview cutoff retains the complete source, including a hidden tail', () => {
  for (const body of ['a'.repeat(100), 'b'.repeat(110), 'c'.repeat(111), '😀'.repeat(56), 'First line\nSecond line']) {
    const f = telegramFixture(); const quote = installTelegramReply(f, { body });
    const record = frozen(f);
    assert.equal(quote.subtitle.innerText, body.length > 110 ? body.slice(0, 100) + '...' : body);
    assert.equal(record.quoteBody, body);
    assert.equal(f.composer.matches(record, f.composer.read()), true);
  }
  const f = telegramFixture(); const quote = installTelegramReply(f, { body: 'x'.repeat(110) + 'A' });
  const record = frozen(f); const visible = quote.subtitle.innerText;
  quote.model.message = 'x'.repeat(110) + 'B';
  assert.equal(quote.subtitle.innerText, visible);
  assert.equal(f.composer.matches(record, f.composer.read()), false);
  assert.equal(f.composer.clear(record), false); assert.equal(f.state.clears.length, 0);
});

test('model or DOM-only guesses, special draft options and unsupported source messages are rejected', () => {
  const scenarios = [
    (f, q) => { f.state.mirrors.delete(`101_history:${q.model.mid}`); },
    (f, q) => { q.model.peerId = 102; }, (f, q) => { q.model.mid += 1; },
    (f, q) => { q.model.id = 0; }, (f, q) => { q.model.id = 2147483648; },
    (f, q) => { q.model.id = 2.5; }, (f, q) => { q.model._ = 'messageService'; },
    (f, q) => { q.model.media = { _: 'messageMediaPhoto' }; },
    (f, q) => { q.model.rich_message = {}; }, (f, q) => { q.model.pending = true; },
    (f, q) => { q.model.deleted = true; }, (f, q) => { q.model.random_id = '10001'; },
    (f, q) => { q.model.ttl_period = 60; }, (f, q) => { q.model.pFlags.ephemeral = true; },
    (f, q) => { q.model.entities = [{ _: 'messageEntityBold', offset: 0, length: 3 }]; },
    (f, q) => { q.model.totalEntities = [{ _: 'messageEntityCustomEmoji', offset: 0, length: 2 }]; },
    (f, q) => { q.model.message = ''; }, (f, q) => { q.model.message = 'a'.repeat(4097); },
    (f, q) => { q.model.fromId = 0; }, (f, q) => { q.peer.setAttribute('data-peer-id', '102'); },
    (f, q) => { q.peer.setAttribute('data-thread-id', '55'); },
    (f, q) => { q.subtitle.innerText = 'Another message'; },
    (f, q) => { q.subtitle.hidden = true; }, (f, q) => { q.region.remove(); },
    (f, q) => { q.wrapper.remove(); }, (f, q) => { f.input.helperType = 'edit'; },
    (f) => { f.input.helperVisible = false; }, (f) => { f.input.replyToQuote = { text: 'Partial quote' }; },
    (f) => { f.input.replyToPeerId = 102; }, (f) => { f.input.replyToMonoforumPeerId = 101; },
    (f) => { f.input.replyToStoryId = 4; }, (f) => { f.input.replyToPollOption = new Uint8Array([1]); },
    (f) => { f.input.replyIsEphemeral = true; }, (f) => { f.chat.threadId = 5; },
    (f) => { f.state.popup = true; },
    (f) => { f.state.draftOverride = { ...f.input.getCurrentInputAsDraft(),
      reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 52 } }; },
    (f) => { f.state.draftOverride = { ...f.input.getCurrentInputAsDraft(),
      reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 51, top_msg_id: 8 } }; },
    (f) => { f.state.draftOverride = { ...f.input.getCurrentInputAsDraft(),
      reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 51, future_option: undefined } }; },
  ];
  for (const [index, change] of scenarios.entries()) {
    const f = telegramFixture(); const quote = installTelegramReply(f); change(f, quote);
    assert.throws(() => f.composer.read(), `scenario ${index}`);
    assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0); assert.equal(f.state.clears.length, 0);
  }
});

test('an unbound or stale visible reply helper cannot fall back to a plain send', () => {
  const f = telegramFixture(); installTelegramReply(f);
  delete f.input.replyToMsgId;
  assert.throws(() => f.composer.read());
  f.input.helperVisible = false;
  assert.throws(() => f.composer.read());
  const modelOnly = telegramFixture(); modelOnly.input.replyToMsgId = 51;
  assert.throws(() => modelOnly.composer.read());
});

test('same-text reply A to B to A and same-content DOM or model replacement invalidate the old snapshot', () => {
  for (const change of [
    (f, q) => {
      installTelegramReply(f, { id: 52, body: q.model.message }); f.mutate([{ target: f.input.chatInput }]);
      installTelegramReply(f, { id: 51, body: q.model.message }); f.mutate([{ target: f.input.chatInput }]);
    },
    (f, q) => { installTelegramReply(f, { body: q.model.message }); },
    (f, q) => { f.state.mirrors.set(`101_history:${q.model.mid}`, structuredClone(q.model)); },
  ]) {
    const f = telegramFixture(); const q = installTelegramReply(f); const record = frozen(f); change(f, q);
    assert.equal(f.composer.matches(record, f.composer.read()), false);
    assert.equal(f.composer.clear(record), false);
  }
});

test('source edits/deletes/flush, including edit ABA, revoke a reply even when the preview stays the same', () => {
  for (const name of ['message_edit', 'history_delete', 'dialog_flush']) {
    const f = telegramFixture(); const q = installTelegramReply(f); const record = frozen(f);
    const old = q.model.message;
    q.model.message = 'A changed source';
    f.root.emit(name, { peerId: 101, mid: q.model.mid, msgs: new Set([q.model.mid]), storageKey: '101_history' });
    q.model.message = old;
    assert.equal(f.composer.matches(record, f.composer.read()), false, name);
    assert.equal(f.composer.clear(record), false);
  }
  const f = telegramFixture(); const q = installTelegramReply(f); const record = frozen(f);
  f.root.emit('message_edit', { peerId: 101, mid: q.model.mid + 1, storageKey: '101_history' });
  assert.equal(f.composer.matches(record, f.composer.read()), true);
  f.state.mirrors.delete(`101_history:${q.model.mid}`);
  assert.throws(() => f.composer.read());
});

test('a previously edited plain message is allowed but its edit version is part of the frozen proof', () => {
  const f = telegramFixture(); const q = installTelegramReply(f, { model: { edit_date: 5,
    fwd_from: { _: 'messageFwdHeader', pFlags: {}, date: 2 },
    reply_to: { _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: 21 } } });
  const record = frozen(f);
  q.model.edit_date = 6;
  assert.equal(f.composer.matches(record, f.composer.read()), false);
});

test('changing a quote during the read-only server-ID lookup stages and sends nothing, including late resolution', async () => {
  const f = telegramFixture(); installTelegramReply(f); const record = frozen(f);
  f.state.replyGate = deferred();
  const work = f.composer.submit(record, 'Invia domani.', () => true);
  const rejected = assert.rejects(work, (error) => f.composer.notSubmitted(error));
  await f.until(() => f.state.replyLookups.length === 1);
  installTelegramReply(f, { id: 52 }); f.mutate([{ target: f.input.chatInput }]); await f.advance(50);
  await rejected; f.state.replyGate.resolve(); await flush();
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0); assert.equal(f.state.clears.length, 0);
});

test('worker reply projections must match the mirrored server ID with no cross-peer, thread or partial quote', async () => {
  for (const reply of [{ _: 'inputReplyToMessage', reply_to_msg_id: 52 },
    { _: 'inputReplyToMessage', reply_to_msg_id: 51, reply_to_peer_id: { _: 'inputPeerUser', user_id: 102 } },
    { _: 'inputReplyToMessage', reply_to_msg_id: 51, top_msg_id: 7 },
    { _: 'inputReplyToMessage', reply_to_msg_id: 51, quote_text: 'Partial quote' },
    { _: 'inputReplyToEphemeralMessage', id: 'private' }]) {
    const f = telegramFixture(); installTelegramReply(f); const record = frozen(f);
    f.state.inputReplyOverride = reply;
    await assert.rejects(f.finish(f.composer.submit(record, 'Invia domani.', () => true)),
      (error) => f.composer.notSubmitted(error));
    assert.equal(f.state.generated.length, 0); assert.equal(f.state.stages.length, 0); assert.equal(f.state.sends.length, 0);
  }
});

test('disposal removes reply source listeners and account A to B to A cannot revive the proof', () => {
  const f = telegramFixture(); installTelegramReply(f); const record = frozen(f);
  assert.equal(f.root.count('message_edit'), 1); assert.equal(f.root.count('history_delete'), 1);
  f.switchAccount(2, 91); f.switchAccount(1, 90);
  assert.equal(f.composer.matches(record, f.composer.read()), false);
  f.composer.dispose();
  assert.equal(f.root.count('message_edit'), 0); assert.equal(f.root.count('history_delete'), 0);
  assert.equal(f.root.count('dialog_flush'), 0);
});
