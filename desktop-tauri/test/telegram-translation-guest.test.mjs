import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramGuest } from './helpers/telegram-translation-guest.mjs';
import { generation } from './helpers/translation-guest.mjs';

const click = (f, row) => { row.box().fire('click'); return f.poll().requests[0]; };

for (const variant of ['a', 'k']) {
  test(`Telegram ${variant}: composed manual action reads only the body and preserves the exact peer/message identity`, () => {
    const f = telegramGuest(variant); const row = f.add({ id: '42', quote: true });
    assert.equal(f.poll().requests.length, 0);
    row.box().fire('click', { isTrusted: false }); assert.equal(f.poll().requests.length, 0);
    const request = click(f, row);
    assert.equal(request.chatId, 'tg:123'); assert.equal(request.messageId, '42');
    assert.equal(request.text, 'Please send 100 units tomorrow.');
    assert.equal(request.manual, true); assert.equal(request.sentAt, 0);
    assert.equal(f.deliver(request, { text: '请明天发送100件。' }), true);
    assert.equal(row.box().textContent, '请明天发送100件。');
    assert.match(row.node.textContent, /12:04/); assert.doesNotMatch(request.text, /Quoted|12:04/);
  });

  test(`Telegram ${variant}: new rows never automatically translate, even with a forged automatic policy`, () => {
    const f = telegramGuest(variant, { policy: { translationMode: 'auto', groupAuto: true, enabled: true, autoSend: true } });
    f.poll(); const row = f.add(); assert.equal(f.poll().requests.length, 0);
    f.state.now = 60000; f.add(); assert.equal(f.poll().requests.length, 0);
    assert.equal(click(f, row).manual, true);
    assert.equal(f.window.__geekTauriPlatform, undefined); assert.equal(f.window.__geekTauriSend, undefined);
  });

  test(`Telegram ${variant}: actual right click retries one billing ID; only explicit retranslation allocates another`, () => {
    const f = telegramGuest(variant); const row = f.add(); f.poll();
    f.rightClick(row).fire('click'); const first = f.poll().requests[0];
    assert.equal(f.deliver(first, { error: 'NETWORK_UNAVAILABLE' }), true);
    const retry = click(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    f.deliver(retry, { text: '请明天发送100件。' }); row.box().fire('click');
    assert.equal(f.poll().requests.length, 0); f.rightClick(row).fire('click');
    const refreshed = f.poll().requests[0]; assert.notEqual(refreshed.id, first.id); assert.equal(refreshed.refresh, true);
  });

  test(`Telegram ${variant}: recycled message node and body A→B→A reject a late result before the next poll`, () => {
    const f = telegramGuest(variant); const row = f.add(); f.poll(); const first = click(f, row);
    row.body.textContent = 'Different 200 units'; row.body.textContent = first.text;
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    assert.equal(f.poll().requests.length, 0);
    const retry = click(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    row.root.setAttribute(variant === 'a' ? 'data-message-id' : 'data-mid', '999');
    row.root.setAttribute(variant === 'a' ? 'data-message-id' : 'data-mid', first.messageId);
    assert.equal(f.deliver(retry, { text: '请明天发送100件。' }), false);
  });

  test(`Telegram ${variant}: virtualization keeps the logical retry but cannot deliver into a replacement node`, () => {
    const f = telegramGuest(variant); const old = f.add({ id: '71' }); f.poll(); const first = click(f, old);
    old.root.remove(); const replacement = f.add({ id: '71' });
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    f.poll(); const retry = click(f, replacement); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    assert.equal(f.deliver(retry, { text: '请明天发送100件。' }), true);
    assert.equal(replacement.box().textContent, '请明天发送100件。');
  });

  test(`Telegram ${variant}: two peers sharing a message number cannot share requests or late output`, () => {
    const f = telegramGuest(variant); const firstRow = f.add({ id: '42' }); f.poll(); const first = click(f, firstRow);
    f.navigate('-100789'); f.replaceList(); const secondRow = f.add({ id: '42' });
    f.poll(); const second = click(f, secondRow);
    assert.equal(second.chatId, 'tg:-100789'); assert.notEqual(second.id, first.id);
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    assert.equal(f.deliver(second, { text: '请明天发送100件。' }), true);
  });

  test(`Telegram ${variant}: a route roundtrip cancels pending work while retaining same-peer retry identity`, () => {
    const f = telegramGuest(variant); const row = f.add(); f.poll(); const first = click(f, row);
    f.navigate('456'); f.navigate('123');
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    f.poll(); const retry = click(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  });

  test(`Telegram ${variant}: unrelated new rows do not cancel a pending translation`, () => {
    const f = telegramGuest(variant); const row = f.add(); f.poll(); const first = click(f, row);
    f.add(); assert.equal(f.poll().requests[0].id, first.id);
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), true);
  });

  test(`Telegram ${variant}: appearance edits retain a paid identity; effective route edits require a new one`, () => {
    const f = telegramGuest(variant); const row = f.add(); f.poll(); const first = click(f, row);
    f.deliver(first, { error: 'NETWORK_UNAVAILABLE' });
    f.configuration.settings.global.fontSize = 15; f.configuration.settings.revision += 1; f.configure(); f.poll();
    const retry = click(f, row); assert.equal(retry.id, first.id);
    f.deliver(retry, { error: 'NETWORK_UNAVAILABLE' });
    f.configuration.settings.global.route = 'backup'; f.configuration.settings.revision += 1; f.configure(); f.poll();
    assert.notEqual(click(f, row).id, first.id);
  });

  test(`Telegram ${variant}: unsupported or ambiguous rows never allocate a request`, () => {
    for (const data of [{ id: '' }, { id: '0' }, { id: '01' }, { id: '1.5' }, { id: 'tmp-1' }, { media: true }, { hidden: true }]) {
      const f = telegramGuest(variant); const row = f.add(data); assert.equal(f.poll().requests.length, 0); assert.equal(row.box(), null);
    }
    const f = telegramGuest(variant); const first = f.add({ id: '7' }); const second = f.add({ id: '7' }); f.poll();
    assert.equal(first.box(), null); assert.equal(second.box(), null);
    const rich = f.add({ id: '8' }); rich.node.append(f.make('img')); f.poll(); assert.equal(rich.box(), null);
  });

  test(`Telegram ${variant}: nonordinary routes, wrong origin, iframe and stale native binding fail closed`, () => {
    assert.equal(telegramGuest(variant, { iframe: true }).api, undefined);
    for (const hash of ['0', '01', '@username', '123_456', '123_pinned', '123?thread=456', '+123']) {
      const f = telegramGuest(variant); f.navigate(hash); const row = f.add(); assert.equal(f.poll().chat, null); assert.equal(row.box(), null);
    }
    const f = telegramGuest(variant); const row = f.add(); f.poll(); const first = click(f, row);
    f.window.location.hostname = 'evil.invalid'; assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    assert.equal(f.poll(), null); assert.equal(f.api.poll('wrong'), null);
    assert.equal(f.api.configure({ ...f.configuration, generation: 'wrong' }), false);
    f.api.revoke(generation); assert.equal(f.poll(), null);
  });
}

test('Telegram A requires a matching header peer and rejects multiple/animating lists or an old peer row', () => {
  const f = telegramGuest('a'); const row = f.add(); f.poll();
  f.navigate('456'); assert.equal(f.poll().chat, null); assert.equal(row.box(), null);
  f.avatar.setAttribute('data-peer-id', '123'); assert.equal(f.poll().chat, null);
  f.navigate('123'); f.list.className += ' is-animating'; assert.equal(f.poll().chat, null);
  f.list.className = 'MessageList'; f.outer.append(f.make('div', 'MessageList')); assert.equal(f.poll().chat, null);
});

test('Telegram K requires the real row peer and ordinary chat container', () => {
  const f = telegramGuest('k'); const mismatch = f.add({ rowPeer: '456' }); f.poll(); assert.equal(mismatch.box(), null);
  f.outer.setAttribute('data-type', 'discussion'); assert.equal(f.poll().chat, null);
});


test('Telegram A never adopts unread/offscreen rows when hash/header change before the keyed list', () => {
  const f = telegramGuest('a');
  const unseen = f.add({ id: '42', hidden: true }); // no poll/read of this row
  f.navigate('456'); unseen.root.hidden = false;
  assert.equal(f.poll().chat, null); assert.equal(unseen.box(), null);
  f.replaceList(); const actual = f.add({ id: '42' }); f.poll();
  const request = click(f, actual); assert.equal(request.chatId, 'tg:456');
  assert.equal(request.messageId, '42'); assert.equal(request.manual, true);
});
