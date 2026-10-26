import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramGuest } from './helpers/telegram-translation-guest.mjs';
import { telegramKRuntime } from './helpers/telegram-k-runtime.mjs';

function fixture(options = {}) {
  const f = telegramGuest('k', { ...options, policy: { translationMode: 'auto', ...options.policy } });
  const runtime = telegramKRuntime(f); f.poll();
  return { ...f, runtime };
}
const click = (f, row) => { row.box().fire('click'); return f.poll().requests[0]; };
const changePolicy = (f, changes) => {
  Object.assign(f.configuration.settings.global, changes); f.configuration.settings.revision += 1;
  f.configuration.autoAfter = ++f.state.unix; f.configure(); f.poll();
};

test('K automatic uses a new incoming event plus the exact history mirror, peer, body and server date', () => {
  const f = fixture(); const row = f.add({ id: '42', quote: true });
  f.runtime.receive(row);
  const request = f.poll().requests[0];
  assert.equal(request.manual, false); assert.equal(request.chatId, 'tg:123');
  assert.equal(request.messageId, '42'); assert.equal(request.sentAt, 1001);
  assert.equal(request.text, 'Please send 100 units tomorrow.');
  assert.equal(f.deliver(request, { text: '请明天发送100件。' }), true);
  assert.equal(row.box().textContent, '请明天发送100件。');
  f.runtime.receive(row); assert.equal(f.poll().requests.length, 0);
  row.root.remove(); const replacement = f.add({ id: '42' });
  f.runtime.receive(replacement); assert.equal(f.poll().requests.length, 0);
  assert.equal(replacement.box().textContent, '请明天发送100件。');
});

test('K inserted history, initial DOM, missing runtime, and mirror-only updates stay manual', () => {
  const f = fixture(); const row = f.add(); f.runtime.put(f.runtime.message(row));
  assert.equal(f.poll().requests.length, 0); assert.equal(click(f, row).manual, true);
  const initial = telegramGuest('k', { policy: { translationMode: 'auto' } });
  const runtime = telegramKRuntime(initial); const old = initial.add(); runtime.put(runtime.message(old));
  initial.poll(); runtime.receive(old); assert.equal(initial.poll().requests.length, 0);
  const missing = telegramGuest('k', { policy: { translationMode: 'auto' } }); missing.poll();
  const manual = missing.add(); missing.poll(); assert.equal(click(missing, manual).manual, true);
});

test('K waits for a late matching mirror but never adopts a different or expired payload', () => {
  const f = fixture(); const row = f.add(); const value = f.runtime.receive(row, {}, { mirror: false });
  assert.equal(f.poll().requests.length, 0);
  f.runtime.put(structuredClone(value)); const request = f.poll().requests[0]; assert.equal(request.manual, false);
  const changed = f.add(); const changedValue = f.runtime.receive(changed, {}, { mirror: false });
  f.runtime.put({ ...changedValue, message: 'Another body' }); assert.equal(f.poll().requests.length, 1);
  f.runtime.put(changedValue); assert.equal(f.poll().requests.length, 1);
  const late = f.add(); const other = f.runtime.receive(late, {}, { mirror: false });
  f.state.now += 5001; f.runtime.put(other); assert.equal(f.poll().requests.length, 1);
  late.box().fire('click');
  assert.equal(f.poll().requests.find((entry) => entry.messageId === late.root.getAttribute('data-mid')).manual, true);
});

test('K rejects own, unknown, service, edited, media, scheduled, stale and future message metadata', () => {
  const rejected = [
    { fromId: 900 }, { pFlags: { out: true } }, { pFlags: { out: 'false' } }, { pFlags: null },
    { fromId: undefined }, { fromId: 456 }, { _: 'messageService' }, { edit_date: 1001 },
    { media: { _: 'messageMediaPhoto' } }, { grouped_id: 'album' }, { pFlags: { from_scheduled: true } },
    { date: 999 }, { date: 1062 }, { date: 1001.5 }, { peerId: 456 }, { mid: 0 },
  ];
  for (const fields of rejected) {
    const f = fixture(); const row = f.add(); f.runtime.receive(row, fields);
    assert.equal(f.poll().requests.length, 0, JSON.stringify(fields));
    assert.equal(click(f, row).manual, true, JSON.stringify(fields));
  }
  for (const data of [{ outgoing: true }, { timestamp: '01001' }, { timestamp: '1002' }, { media: true }]) {
    const f = fixture(); const row = f.add(data); f.runtime.receive(row, { date: 1001 });
    assert.equal(f.poll().requests.length, 0, JSON.stringify(data));
  }
});

test('K normal groups require groupAuto in the original setting; broadcast/forum/self/system chats stay manual', () => {
  for (const groupAuto of [false, true]) {
    const f = fixture({ peer: '-123', policy: { groupAuto } }); const row = f.add(); f.runtime.receive(row);
    assert.equal(f.poll().requests.length, groupAuto ? 1 : 0);
  }
  const mega = fixture({ peer: '-123', policy: { groupAuto: true } });
  mega.runtime.peer(-123, { _: 'channel', pFlags: { megagroup: true } });
  const row = mega.add(); mega.runtime.receive(row); assert.equal(mega.poll().requests.length, 1);
  for (const fields of [{ _: 'channel', pFlags: { broadcast: true } },
    { _: 'channel', pFlags: { megagroup: true, forum: true } }, { _: 'chat', pFlags: { left: true } }]) {
    const f = fixture({ peer: '-123', policy: { groupAuto: true } }); f.runtime.peer(-123, fields);
    const item = f.add(); f.runtime.receive(item); assert.equal(f.poll().requests.length, 0);
  }
  for (const peer of ['900', '777000', '489000', '1271266957', '2666000']) {
    const f = fixture({ peer }); const item = f.add(); f.runtime.receive(item); assert.equal(f.poll().requests.length, 0);
  }
  const searched = fixture(); searched.runtime.im.chat.type = 'search';
  const found = searched.add(); searched.runtime.receive(found); assert.equal(searched.poll().requests.length, 0);
});

test('K edit events and body changes cancel late results and never create automatic replacement billing IDs', () => {
  const f = fixture(); const row = f.add(); const value = f.runtime.receive(row); const first = f.poll().requests[0];
  f.runtime.root.emit('message_edit', { peerId: 123, mid: value.mid });
  row.body.textContent = 'changed'; row.body.textContent = value.message;
  f.runtime.receive(row); assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
  assert.equal(f.poll().requests.length, 0);
  const retry = click(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2); assert.equal(retry.manual, true);
  const later = f.add(); f.runtime.receive(later); later.body.textContent = 'different body';
  assert.equal(f.poll().requests.length, 1); // the explicit retry only
});

test('K peer roundtrips, account changes, hide/show and disable/re-enable cannot replay prior observations', () => {
  for (const change of ['peer', 'auth', 'visibility', 'policy', 'active']) {
    const f = fixture(); const row = f.add({ id: '42' }); const value = f.runtime.receive(row); const first = f.poll().requests[0];
    if (change === 'peer') {
      f.runtime.select(456); f.runtime.select(123); f.add({ id: '42' });
    } else if (change === 'auth') {
      f.runtime.root.myId = 901; f.runtime.root.emit('user_auth', { id: 901 });
    } else if (change === 'visibility') {
      f.document.visibilityState = 'hidden'; f.document.fire('visibilitychange');
      f.document.visibilityState = 'visible'; f.document.fire('visibilitychange');
    } else if (change === 'policy') {
      changePolicy(f, { translationMode: 'click' }); changePolicy(f, { translationMode: 'auto' });
    } else {
      f.configuration.active = false; f.configure(); f.configuration.active = true; f.configure();
    }
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false, change);
    f.poll(); f.runtime.root.emit('history_multiappend', value);
    assert.equal(f.poll().requests.length, 0, change);
  }
});

test('K receipts observed while auto is disabled, after the cutoff, or under another peer cannot be backfilled', () => {
  const f = fixture({ policy: { translationMode: 'click' } }); const old = f.add(); f.runtime.receive(old);
  changePolicy(f, { translationMode: 'auto' }); f.runtime.receive(old); assert.equal(f.poll().requests.length, 0);
  const fresh = f.add({ timestamp: String(f.state.unix) }); f.runtime.receive(fresh);
  assert.equal(f.poll().requests.length, 1);
  const background = f.add({ rowPeer: '456' }); f.runtime.receive(background);
  assert.equal(f.poll().requests.length, 1);
});

test('K ordinary errors retry manually with the same UUID and revoke unsubscribes read-only listeners', () => {
  const f = fixture(); const row = f.add(); f.runtime.receive(row); const request = f.poll().requests[0];
  f.deliver(request, { error: 'NETWORK_UNAVAILABLE' }); f.runtime.receive(row); assert.equal(f.poll().requests.length, 0);
  const retry = click(f, row); assert.equal(retry.id, request.id); assert.equal(retry.attempt, 2);
  assert.equal(f.deliver(retry, { text: '请明天发送100件。' }), true);
  f.api.revoke(f.configuration.generation);
  assert.equal(f.runtime.root.listeners.get('history_multiappend').size, 0);
  assert.equal(f.runtime.im.listeners.get('peer_changing').size, 0);
});

test('K paid display survives receipt expiry without remounting while pending work still requires provenance', () => {
  const f = fixture(); const row = f.add(); f.runtime.receive(row); const request = f.poll().requests[0];
  f.deliver(request, { text: '请明天发送100件。' }); const box = row.box();
  const pending = f.add(); f.runtime.receive(pending); const other = f.poll().requests[0];
  f.state.now += 45001; f.poll(); f.poll();
  assert.equal(row.box(), box); assert.equal(box.textContent, '请明天发送100件。');
  assert.equal(f.deliver(other, { text: '请明天发送100件。' }), false);
  f.runtime.receive(row); f.runtime.receive(pending); assert.equal(f.poll().requests.length, 0);
});

test('K bounded observation identities never evict old events to admit a replay', () => {
  const f = fixture();
  for (let mid = 1; mid <= 1000; mid += 1) {
    f.runtime.root.emit('history_multiappend', { _: 'message', mid, peerId: 123, fromId: 123,
      date: 1001, message: 'Observed before DOM', pFlags: {} });
  }
  const row = f.add({ id: '1001' }); f.runtime.receive(row);
  assert.equal(f.poll().requests.length, 0); assert.equal(click(f, row).manual, true);
});
