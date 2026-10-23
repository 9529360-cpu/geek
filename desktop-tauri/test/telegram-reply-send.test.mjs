import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramFixture, installTelegramReply, deferred, flush } from './helpers/telegram-send.mjs';
import { telegramOwnerFixture } from './helpers/telegram-send-owner.mjs';
import { attachmentFixture, attachment, finalMedia } from './helpers/telegram-attachments.mjs';

const frozen = (f) => { const value = f.composer.read(); return { ...value, composerState: value }; };
const start = (f) => { assert.equal(f.enter().defaultPrevented, true); const r = f.poll().request; assert.ok(r); return r; };
const header = (mid = 51) => ({ _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: mid });
function finalEvent(f, pending, { temp = {}, final = {}, mirror = {} } = {}) {
  const mid = pending.peer_id._ === 'peerChannel' ? 0x100000000 + 700 : 700;
  const message = { ...structuredClone(pending), id: 700, mid, pFlags: { out: true },
    ...(pending.media ? { media: finalMedia(pending) } : {}), ...final };
  delete message.pending; delete message.random_id;
  f.state.mirrors.set(`${pending.peerId}_history:${mid}`, { ...structuredClone(message), ...mirror });
  f.root.emit('message_sent', { storageKey: `${pending.peerId}_history`, tempId: pending.mid,
    tempMessage: { ...structuredClone(pending), ...temp }, mid, message });
}

test('composed reply owner sends literal translation once with server reply ID and keeps the complete source draft', async () => {
  for (const peer of [101, -202, -303]) {
    const f = telegramOwnerFixture();
    if (peer === -303) f.state.peers.set(peer, { _: 'chat', id: 303, pFlags: {} });
    f.chat.peerId = peer; f.location.hash = `#${peer}`;
    const quote = installTelegramReply(f);
    const request = start(f);
    assert.deepEqual(request.context, { kind: 'reply', chatId: `tg:${peer}`, messageId: `tg:${peer}:51` });
    assert.deepEqual(f.prepare(request), { ok: true });
    const flight = f.commit(request); assert.equal(flight.accepted, true);
    assert.equal(f.commit(request, flight.permit).accepted, false);
    const result = await f.settle(request, flight);
    assert.deepEqual(result, { status: 'confirmed', receipt: `tg:${peer}:700`, draftCleared: false });
    assert.equal(f.state.sends.length, 1); assert.equal(f.state.sends[0].method, 'messages.sendMessage');
    assert.equal(f.state.sends[0].params.message, 'Invia domani.');
    assert.equal(f.state.sends[0].params.clear_draft, false);
    assert.deepEqual(f.state.sends[0].params.reply_to, { _: 'inputReplyToMessage', reply_to_msg_id: 51 });
    assert.deepEqual(f.state.generateOptions, [{ replyTo: { _: 'inputReplyToMessage', reply_to_msg_id: 51 } }]);
    assert.deepEqual(f.state.stages[0].message.reply_to, header(quote.model.mid));
    assert.equal(f.state.replyLookups.length, 2);
    assert.equal(f.state.replyLookups.every((lookup) => lookup.account === 1
      && lookup.options.peerId === peer && lookup.options.replyToMsgId === quote.model.mid), true);
    assert.equal(f.editor.innerText, request.text); assert.equal(f.chat.input.replyToMsgId, quote.model.mid);
    assert.equal(f.chat.input.replyElements.container, quote.wrapper); assert.equal(f.state.clears.length, 0);
    assert.equal(f.deliver(request, { ...result, retryable: false }), true);
    f.enter(); f.click(); assert.equal(f.poll().request, null); assert.equal(f.state.sends.length, 1);
  }
});

test('reply identity exclusion and already-forwarded/replied plain sources retain the same finite send route', async () => {
  const f = telegramOwnerFixture({ policy: { includeZh: false }, text: '明天发送。', session: null });
  installTelegramReply(f, { from: 90, model: { pFlags: { out: true }, edit_date: 4,
    reply_to: header(20), fwd_from: { _: 'messageFwdHeader', pFlags: {}, date: 1 } } });
  const request = start(f);
  assert.deepEqual(f.prepare(request, request.text, false), { ok: true });
  const result = await f.settle(request, f.commit(request));
  assert.equal(result.status, 'confirmed'); assert.equal(result.draftCleared, false);
  assert.deepEqual(f.state.sends[0].params.reply_to, { _: 'inputReplyToMessage', reply_to_msg_id: 51 });
  assert.equal(f.state.sends[0].params.message, request.text); assert.equal(f.state.clears.length, 0);
});

test('known reply preflight failure can reuse the UUID/output on a human retry, while another quote gets another intent', async () => {
  const f = telegramOwnerFixture(); installTelegramReply(f); const request = start(f);
  assert.deepEqual(f.prepare(request), { ok: true }); f.state.allowed = false;
  const flight = f.commit(request); const result = await f.settle(request, flight);
  assert.equal(result.status, 'notSubmitted'); assert.equal(f.read(request, flight.permit).precommit.kind, 'telegramK');
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.clears.length, 0);
  f.deliver(request, { ...result, retryable: true });
  const retry = start(f); assert.equal(retry.id, request.id); assert.equal(retry.attempt, 2);
  assert.deepEqual(retry.context, request.context);
  f.state.allowed = true; assert.deepEqual(f.prepare(retry), { ok: true });
  assert.equal((await f.settle(retry, f.commit(retry))).status, 'confirmed');
  assert.equal(f.state.sends.length, 1);

  const g = telegramOwnerFixture(); const quote = installTelegramReply(g); const old = start(g);
  installTelegramReply(g, { id: 52, body: quote.model.message }); g.mutate([{ target: g.chat.input.chatInput }]);
  const next = start(g); assert.notEqual(next.id, old.id);
  assert.equal(next.context.messageId, 'tg:101:52'); assert.equal(g.state.sends.length, 0);
});

test('source or helper changes before commit revoke the old permit without a send or draft write', () => {
  for (const change of [
    (f, q) => { q.model.message += ' Changed'; },
    (f, q) => { f.state.mirrors.delete(`101_history:${q.model.mid}`); },
    (f, q) => { installTelegramReply(f, { body: q.model.message }); },
    (f, q) => {
      q.model.message += ' Changed'; f.root.emit('message_edit', { peerId: 101, mid: q.model.mid });
      q.model.message = q.model.message.slice(0, -8);
    },
    (f) => { f.switchAccount(2, 91); f.switchAccount(1, 90); },
  ]) {
    const f = telegramOwnerFixture(); const quote = installTelegramReply(f); const request = start(f);
    assert.deepEqual(f.prepare(request), { ok: true }); change(f, quote);
    assert.equal(f.commit(request).accepted, false);
    assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0); assert.equal(f.state.clears.length, 0);
  }
});

test('an account switch after reply staging cleans the original account and certifies no API call', async () => {
  const f = telegramOwnerFixture(); installTelegramReply(f); const request = start(f);
  assert.deepEqual(f.prepare(request), { ok: true });
  f.state.stageHook = () => { f.switchAccount(2, 91); f.switchAccount(1, 90); };
  const flight = f.commit(request); const result = await f.settle(request, flight);
  assert.equal(result.status, 'notSubmitted'); assert.equal(f.read(request, flight.permit).precommit.kind, 'telegramK');
  assert.deepEqual(f.state.cancelled, [{ account: 1, randomId: f.state.stages[0].message.random_id }]);
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.clears.length, 0);
});

test('wrong, omitted or special reply headers in temp/final/mirror never confirm an otherwise exact ACK', async () => {
  const f = telegramFixture(); installTelegramReply(f); const record = frozen(f); f.state.mode = 'never';
  let done = false;
  const work = f.composer.submit(record, 'Invia domani.', () => true).then((result) => { done = true; return result; });
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  const invalid = [undefined, header(52), { ...header(), reply_to_peer_id: { _: 'peerUser', user_id: 102 } },
    { ...header(), quote_text: 'Partial' }, { ...header(), reply_to_top_id: 1 },
    { ...header(), pFlags: { quote: true } }, { ...header(), reply_to_msg_deleted: true },
    { ...header(), reply_media: { _: 'messageMediaPhoto' } }, { ...header(), future_option: undefined }];
  for (const phase of ['temp', 'final', 'mirror']) {
    for (const reply_to of invalid) {
      finalEvent(f, pending, { [phase]: { reply_to } });
      await f.advance(); assert.equal(done, false, `${phase}: ${JSON.stringify(reply_to)}`);
    }
  }
  finalEvent(f, pending);
  assert.equal((await f.finish(work)).ack, 1); assert.equal(f.state.sends.length, 1); assert.equal(f.state.clears.length, 0);
});

test('worker-generated reply and pending append are independently checked before the only send call', async () => {
  const invalid = telegramFixture(); installTelegramReply(invalid); const record = frozen(invalid);
  invalid.state.generateHook = (message) => { message.reply_to = header(52); };
  await assert.rejects(invalid.finish(invalid.composer.submit(record, 'Invia domani.', () => true)),
    (error) => invalid.composer.notSubmitted(error));
  assert.equal(invalid.state.stages.length, 0); assert.equal(invalid.state.sends.length, 0);

  const f = telegramFixture(); installTelegramReply(f); const bound = frozen(f); f.state.noAppend = true;
  const work = f.composer.submit(bound, 'Invia domani.', () => true);
  const rejected = assert.rejects(work, (error) => f.composer.notSubmitted(error) && error.code === 'TIMED_OUT');
  await f.until(() => f.state.stages.length === 1);
  const pending = f.state.stages[0].message;
  for (const reply_to of [undefined, header(52), { ...header(), quote_text: 'Partial' }]) {
    f.root.emit('history_append', { storageKey: '101_history', message: { ...pending, reply_to } });
    await f.advance(); assert.equal(f.state.sends.length, 0);
  }
  await f.advance(30000); await rejected;
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.cancelled.length, 1); assert.equal(f.state.clears.length, 0);
});

test('plain text and broadcast media reject any unexpected reply at pending, temp, final and mirror stages', async () => {
  for (const media of [false, true]) {
    const f = media ? attachmentFixture() : telegramFixture();
    const selected = media ? attachment() : null;
    f.state.noAppend = true; f.state.mode = 'never'; f.state.mediaMode = 'never';
    const prepared = await f.adapter.prepare(media ? f.draft([selected]) : f.request());
    let done = false;
    const work = (media ? f.adapter.dispatchAttachment(prepared, selected.file, 0, () => true)
      : f.adapter.dispatch(prepared, () => true)).then((result) => { done = true; return result; });
    await f.until(() => f.state.stages.length === 1);
    const pending = f.state.stages[0].message;
    f.root.emit('history_append', { storageKey: '101_history', message: { ...pending, reply_to: header() } });
    await f.advance(); assert.equal(f.state.sends.length, 0); assert.equal(done, false);
    f.root.emit('history_append', { storageKey: '101_history', message: pending });
    await f.until(() => f.state.sends.length === 1);
    for (const phase of ['temp', 'final', 'mirror']) {
      finalEvent(f, pending, { [phase]: { reply_to: header() } });
      await f.advance(); assert.equal(done, false, `${media ? 'media' : 'plain'} ${phase}`);
    }
    finalEvent(f, pending);
    assert.equal((await f.finish(work)).status, 'confirmed');
    assert.equal('reply_to' in f.state.sends[0].params, false);
    assert.equal(f.state.sends.length, 1); assert.equal(f.state.clears.length, 0);
  }
});

test('wrong reply ACK timeout is uncertain; late correction and repeated gestures never replay it', async () => {
  const f = telegramOwnerFixture(); installTelegramReply(f); const request = start(f); f.state.mode = 'never';
  assert.deepEqual(f.prepare(request), { ok: true }); const flight = f.commit(request);
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  finalEvent(f, pending, { final: { reply_to: header(52) } }); await f.advance(30000);
  const result = await f.settle(request, flight);
  assert.equal(result.status, 'uncertain'); assert.equal(f.read(request, flight.permit).precommit, undefined);
  assert.equal(f.deliver(request, { ...result, retryable: false }), true);
  finalEvent(f, pending); await f.advance(); f.enter(); f.click();
  assert.equal(f.poll().request, null); assert.equal(f.state.sends.length, 1);
  assert.equal(f.editor.innerText, request.text); assert.equal(f.chat.input.replyToMsgId, 51); assert.equal(f.state.clears.length, 0);
});

test('source changes after invocation keep the newer draft and cannot publish a late reply success', async () => {
  const f = telegramOwnerFixture(); const quote = installTelegramReply(f); const request = start(f);
  f.state.apiGate = deferred(); assert.deepEqual(f.prepare(request), { ok: true }); const flight = f.commit(request);
  await f.until(() => f.state.sends.length === 1);
  quote.model.message += ' Changed'; f.root.emit('message_edit', { peerId: 101, mid: 51 });
  await f.advance(); const result = await f.settle(request, flight);
  assert.equal(result.status, 'uncertain'); assert.equal(f.read(request, flight.permit).precommit, undefined);
  f.state.apiGate.resolve({ _: 'updateShortSentMessage', id: 700, date: 5, pFlags: { out: true }, pts: 1, pts_count: 1 });
  await flush();
  assert.equal(f.read(request, flight.permit).value.status, 'uncertain');
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.clears.length, 0);
  assert.equal(f.editor.innerText, request.text); assert.equal(f.chat.input.replyToMsgId, 51);
});
