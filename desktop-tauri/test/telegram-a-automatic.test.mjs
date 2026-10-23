import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramGuest } from './helpers/telegram-translation-guest.mjs';
import { telegramARuntime } from './helpers/telegram-a-runtime.mjs';

function fixture(options = {}) {
  const f = telegramGuest('a', { ...options, policy: { translationMode: 'auto', ...options.policy } });
  const runtime = telegramARuntime(f);
  if (options.peer?.startsWith('-')) runtime.peer(options.peer);
  f.poll(); runtime.nextSecond();
  return { ...f, runtime };
}
const click = (f, row) => { row.box().fire('click'); return f.poll().requests.find((item) => item.messageId === row.root.dataset.messageId); };
const incoming = (f, row, fields = {}) => f.runtime.receive(row, fields);

test('A missing document-start observer preserves the original manual action and same-ID retry', () => {
  const f = telegramGuest('a', { policy: { translationMode: 'auto' } });
  const row = f.add(); assert.equal(f.poll().requests.length, 0);
  const first = click(f, row); assert.equal(first.manual, true);
  f.deliver(first, { error: 'NETWORK_UNAVAILABLE' }); f.poll();
  const retry = click(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.equal(f.deliver(retry, { text: '请明天发送100件。' }), true);
});

test('A real composed owner uses the production new-message envelope and strict false outgoing flag', () => {
  const f = fixture(); const row = f.add({ id: '42', quote: true }); incoming(f, row);
  const request = f.poll().requests[0];
  assert.equal(request.manual, false); assert.equal(request.chatId, 'tg:123');
  assert.equal(request.messageId, '42'); assert.equal(request.sentAt, f.state.unix);
  assert.equal(request.text, 'Please send 100 units tomorrow.');
  assert.equal(f.deliver(request, { text: '请明天发送100件。' }), true);
  assert.equal(row.box().textContent, '请明天发送100件。');
  incoming(f, row); assert.equal(f.poll().requests.length, 0);
  assert.equal(f.runtime.worker.sent.length, 0);
});

test('A observer preserves the native constructor, prototype and arguments without a send or secret API', () => {
  const f = fixture(); const runtime = f.runtime;
  assert.equal(runtime.worker instanceof runtime.Worker, true);
  assert.equal(runtime.worker instanceof f.window.Worker, true);
  assert.equal(f.window.Worker.prototype, runtime.Worker.prototype);
  assert.deepEqual(runtime.worker.options, { type: 'module', name: '' });
  assert.deepEqual(Object.keys(runtime.source), ['state', 'peer', 'subscribe']);
  runtime.updates({ '@type': 'updateSession', sessionData: { sentinel: 'never-observed' } });
  runtime.worker.emit({ payloads: [{ type: 'methodResponse', response: { sentinel: 'never-observed' } }] });
  assert.doesNotMatch(JSON.stringify(runtime.source.state()), /sentinel|never-observed/);
  assert.equal(runtime.worker.sent.length, 0);
});

test('A late installation, foreign workers, alternate account slots and synthetic messages fail closed', () => {
  const late = telegramGuest('a', { policy: { translationMode: 'auto' } });
  const failed = telegramARuntime(late, { readyState: 'complete' });
  assert.equal(failed.installed, false); assert.equal(late.window.Worker, failed.Worker);
  for (const [url, options] of [
    ['https://example.invalid/a/worker-abc12345.js', { type: 'module', name: '' }],
    ['https://web.telegram.org/k/worker-abc12345.js', { type: 'module', name: '' }],
    ['https://web.telegram.org/a/worker-abc12345.js?other=1', { type: 'module', name: '' }],
    ['https://web.telegram.org/a/other-abc12345.js', { type: 'module', name: '' }],
    ['https://web.telegram.org/a/worker-abc12345.js', { type: 'classic', name: '' }],
    ['https://web.telegram.org/a/worker-abc12345.js', { type: 'module', name: 'account=2' }],
  ]) {
    const f = telegramGuest('a', { policy: { translationMode: 'auto' } });
    const runtime = telegramARuntime(f, { initialize: false }); runtime.create(url, options); runtime.ready();
    assert.equal(runtime.source.state().ready, false, url); assert.equal(runtime.worker.listeners.size, 0);
  }
  const f = fixture(); const row = f.add();
  f.runtime.worker.emit({ payloads: [{ type: 'updates', updates: [{ '@type': 'updateMessage',
    id: Number(row.root.dataset.messageId), chatId: '123', message: f.runtime.message(row), isFromNew: true, isFull: true }] }] },
  { trusted: false });
  assert.equal(f.poll().requests.length, 0); assert.equal(click(f, row).manual, true);
});

test('A DOM insertion, history method responses, local newMessage and edited payloads do not imply new incoming', () => {
  for (const kind of ['dom', 'history', 'local', 'edit', 'partial']) {
    const f = fixture(); const row = f.add(); const value = f.runtime.message(row);
    if (kind === 'history') f.runtime.worker.emit({ payloads: [{ type: 'methodResponse', response: { messages: [value] } }] });
    if (kind === 'local') f.runtime.updates({ '@type': 'newMessage', id: value.id, chatId: '123', message: value });
    if (kind === 'edit') f.runtime.receive(row, {}, { isFromNew: undefined });
    if (kind === 'partial') f.runtime.receive(row, {}, { isFull: false });
    assert.equal(f.poll().requests.length, 0, kind); assert.equal(click(f, row).manual, true, kind);
  }
  const initial = telegramGuest('a', { policy: { translationMode: 'auto' } });
  const runtime = telegramARuntime(initial); const row = initial.add(); runtime.receive(row);
  initial.poll(); runtime.nextSecond(); runtime.receive(row); assert.equal(initial.poll().requests.length, 0);
});

test('A frozen source metadata rejects own, unknown direction, media, edits, scheduled and malformed bodies', () => {
  for (const fields of [
    { isOutgoing: true }, { isOutgoing: undefined }, { isOutgoing: 'false' }, { senderId: '900' }, { senderId: '456' },
    { date: 1000 }, { date: 1002.5 }, { date: 1063 }, { date: 0 }, { id: 0 },
    { editDate: 1002 }, { isEdited: true }, { isScheduled: true }, { isFromScheduled: true }, { groupedId: '1' },
    { sendingState: 'messageSendingStatePending' }, { isEphemeral: true }, { guestChatViaId: '123' },
    { content: { text: { text: 'caption' }, photo: {} } }, { content: { text: { text: 'bad\u0000text' } } },
  ]) {
    const f = fixture(); const row = f.add(); incoming(f, row, fields);
    assert.equal(f.poll().requests.length, 0, JSON.stringify(fields));
  }
  const f = fixture(); const own = f.add(); own.root.classList.add('own'); incoming(f, own);
  assert.equal(f.poll().requests.length, 0);
  const mismatch = f.add(); incoming(f, mismatch, { content: { text: { text: 'Another body' } } });
  assert.equal(f.poll().requests.length, 0);
  const envelope = f.add(); f.runtime.receive(envelope, {}, { id: 88 }); assert.equal(f.poll().requests.length, 0);
});

test('A verified basic/supergroups use groupAuto; partial metadata, channels and forums remain manual', () => {
  for (const type of ['chatTypeBasicGroup', 'chatTypeSuperGroup']) {
    const f = fixture({ peer: '-123', policy: { groupAuto: true } }); f.runtime.peer('-123', { type });
    f.poll(); f.runtime.nextSecond(); const row = f.add(); incoming(f, row, { senderId: '321' });
    assert.equal(f.poll().requests[0]?.manual, false, type);
  }
  for (const fields of [{ type: 'chatTypeChannel' }, { isForum: true }, { isMonoforum: true },
    { isBotForum: true }, { isForbidden: true }, { isRestricted: true }, { isNotJoined: true }, { isForum: 'true' }]) {
    const f = fixture({ peer: '-123', policy: { groupAuto: true } }); f.runtime.peer('-123', fields);
    const row = f.add(); incoming(f, row, { senderId: '321' }); assert.equal(f.poll().requests.length, 0, JSON.stringify(fields));
  }
  const group = fixture({ peer: '-123' }); const row = group.add(); incoming(group, row, { senderId: '321' });
  assert.equal(group.poll().requests.length, 0);
  const unknown = fixture({ policy: { groupAuto: true } }); unknown.navigate('-456'); unknown.replaceList(); unknown.poll();
  unknown.runtime.updates({ '@type': 'updateChat', id: '-456', chat: { type: 'chatTypeBasicGroup' } });
  unknown.runtime.nextSecond(); const item = unknown.add(); incoming(unknown, item, { senderId: '321' });
  assert.equal(unknown.poll().requests.length, 0);
});

test('A edit and deletion events reject late results without automatic replacement billing', () => {
  for (const kind of ['edit', 'delete']) {
    const f = fixture(); const row = f.add({ id: '42' }); const original = incoming(f, row); const request = f.poll().requests[0];
    if (kind === 'edit') f.runtime.updates({ '@type': 'updateMessage', id: 42, chatId: '123',
      message: { ...original, isOutgoing: undefined, editDate: f.state.unix }, isFull: true });
    else f.runtime.updates({ '@type': 'deleteMessages', ids: [42] });
    assert.equal(f.deliver(request, { text: '请明天发送100件。' }), false, kind);
    f.runtime.nextSecond(); incoming(f, row); assert.equal(f.poll().requests.length, 0, kind);
    const retry = click(f, row); assert.equal(retry.id, request.id); assert.equal(retry.attempt, 2);
  }
  const changed = fixture(); const row = changed.add(); incoming(changed, row); const request = changed.poll().requests[0];
  incoming(changed, row, { content: { text: { text: 'A changed source event before its DOM update' } } });
  assert.equal(changed.deliver(request, { text: '请明天发送100件。' }), false);
  for (const type of ['edit', 'delete']) {
    const f = fixture(); const old = f.add({ id: '42' });
    if (type === 'edit') f.runtime.receive(old, {}, { isFromNew: undefined });
    else f.runtime.updates({ '@type': 'deleteMessages', ids: [42], chatId: '123' });
    f.poll(); f.runtime.nextSecond(); incoming(f, old);
    assert.equal(f.poll().requests.length, 0, type);
  }
});

test('A reconnect drops in-flight work and filters difference replay by the new server-date fence', () => {
  const f = fixture(); const first = f.add(); incoming(f, first); const request = f.poll().requests[0];
  f.runtime.updates({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });
  assert.equal(f.deliver(request, { text: '请明天发送100件。' }), false);
  f.runtime.nextSecond(); f.runtime.nextSecond(); f.runtime.ready(); f.poll();
  const catchup = f.add(); incoming(f, catchup, { date: request.sentAt }); assert.equal(f.poll().requests.length, 0);
  const sameSecond = f.add(); incoming(f, sameSecond); assert.equal(f.poll().requests.length, 0);
  f.runtime.nextSecond(); const fresh = f.add(); incoming(f, fresh);
  assert.equal(f.poll().requests[0]?.messageId, fresh.root.dataset.messageId);
});

test('A worker replacement and Telegram authorization changes revoke old observations immediately', () => {
  for (const kind of ['worker', 'logout', 'self']) {
    const f = fixture(); const row = f.add(); incoming(f, row); const request = f.poll().requests[0];
    if (kind === 'worker') {
      const old = f.runtime.worker; f.runtime.create(); f.runtime.ready();
      assert.equal(old.listeners.get('message').size, 0);
      old.emit({ payloads: [{ type: 'updates', updates: [] }] });
    } else if (kind === 'logout') f.runtime.updates({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateClosed' });
    else f.runtime.updates({ '@type': 'updateCurrentUser', currentUser: { id: '901' }, currentUserFullInfo: {} });
    assert.equal(f.deliver(request, { text: '请明天发送100件。' }), false, kind);
    assert.equal(f.runtime.worker.sent.length, 0);
  }
});

test('A chat roundtrip, hidden view, subscription and policy changes cannot reuse an automatic observation', () => {
  for (const kind of ['chat', 'hidden', 'subscription', 'policy', 'active']) {
    const f = fixture(); const row = f.add(); incoming(f, row); const request = f.poll().requests[0];
    if (kind === 'chat') { f.navigate('456'); f.navigate('123'); }
    if (kind === 'hidden') { f.document.visibilityState = 'hidden'; f.document.fire('visibilitychange'); }
    if (kind === 'subscription') { f.configuration.sessionGeneration = null; f.configure(); }
    if (kind === 'policy') { f.configuration.settings.revision += 1; f.configure(); }
    if (kind === 'active') { f.configuration.active = false; f.configure(); }
    assert.equal(f.deliver(request, { text: '请明天发送100件。' }), false, kind);
    assert.equal(f.poll().requests.length, 0, kind);
  }
});

test('A uncertain translation retries the same UUID manually; receipt expiry does not erase paid display', () => {
  const f = fixture(); const row = f.add(); incoming(f, row); const request = f.poll().requests[0];
  f.deliver(request, { error: 'NETWORK_UNAVAILABLE' }); incoming(f, row); assert.equal(f.poll().requests.length, 0);
  const retry = click(f, row); assert.equal(retry.id, request.id); assert.equal(retry.attempt, 2);
  f.deliver(retry, { text: '请明天发送100件。' }); const box = row.box();
  f.state.now += 45001; f.poll(); assert.equal(row.box(), box); assert.equal(box.textContent, '请明天发送100件。');
  f.api.revoke(f.configuration.generation);
  const later = f.add(); incoming(f, later); assert.equal(f.poll(), null);
});

test('A bounded observations never evict identities to admit replays and malformed batches cancel pending proof', () => {
  const f = fixture();
  for (let id = 1; id <= 1000; id += 1) {
    f.runtime.updates({ '@type': 'updateMessage', id, chatId: '123', isFromNew: true, isFull: true,
      message: { id, chatId: '123', isOutgoing: false, date: f.state.unix, content: { text: { text: 'Observed before DOM' } } } });
  }
  const row = f.add({ id: '1001' }); incoming(f, row); assert.equal(f.poll().requests.length, 0);
  assert.equal(click(f, row).manual, true);
  const other = fixture(); const item = other.add(); incoming(other, item); const request = other.poll().requests[0];
  other.runtime.worker.emit({ payloads: [{ type: 'updates', updates: Array(2001).fill(null) }] });
  assert.equal(other.deliver(request, { text: '请明天发送100件。' }), false);
});
