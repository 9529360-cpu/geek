import test from 'node:test';
import assert from 'node:assert/strict';
import { guest, generation } from './helpers/translation-guest.mjs';

function clicked(f, row) { row.box().fire('click'); return f.poll().requests[0]; }

test('translation installs only in the top frame and stays bound to its native document', () => {
  assert.equal(guest({ iframe: true }).api, undefined);
  const f = guest(); const row = f.add(); f.poll();
  assert.equal(f.api.configure({ ...f.configuration, generation: 'wrong' }), false);
  assert.equal(f.api.poll('wrong'), null);
  row.box().fire('click', { isTrusted: false }); assert.equal(f.poll().requests.length, 0);
  row.box().fire('keydown', { isTrusted: false, key: 'Enter' }); assert.equal(f.poll().requests.length, 0);
  const request = clicked(f, row); assert.equal(request.manual, true);
  f.state.generation = 'next-document';
  assert.equal(f.deliver(request, { text: '请明天发送100件。' }), false);
  assert.equal(f.poll(), null);
});

test('uncertain retries keep their request ID and reject the old attempt', () => {
  const f = guest(); const row = f.add(); f.poll();
  const first = clicked(f, row);
  assert.equal(f.deliver(first, { error: 'NETWORK_UNAVAILABLE' }), true);
  row.box().fire('keydown', { key: 'Enter' }); const retry = f.poll().requests[0];
  assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
  assert.equal(f.deliver(retry, { text: '请明天发送100件。' }), true);
  assert.equal(row.box().textContent, '请明天发送100件。');
});

test('a completed result is retranslated only by an explicit new logical request', () => {
  const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
  f.deliver(first, { text: '请明天发送100件。' }); row.box().fire('click'); assert.equal(f.poll().requests.length, 0);
  const menu = f.rightClick(row); assert.equal(menu.textContent, '重新翻译'); menu.fire('click');
  const second = f.poll().requests[0]; assert.notEqual(second.id, first.id);
  assert.equal(second.attempt, 1); assert.equal(second.refresh, true);
});

test('protected-literal rejection exposes an explicit paid refresh, never a retry loop', () => {
  const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
  f.deliver(first, { text: '请明天发送101件。' }); assert.match(row.box().textContent, /未通过校验/);
  row.box().fire('click'); assert.equal(f.poll().requests.length, 0);
  const menu = f.rightClick(row); assert.equal(menu.textContent, '重新翻译'); menu.fire('click');
  const refresh = f.poll().requests[0]; assert.notEqual(refresh.id, first.id);
  assert.equal(refresh.refresh, true);
  f.deliver(refresh, { text: '<b>请明天发送100件。</b>' });
  assert.equal(row.box().textContent, '<b>请明天发送100件。</b>'); assert.equal(row.box().children.length, 0);
});

for (const change of ['text', 'node', 'row', 'chat', 'session', 'policy', 'hidden', 'revoke']) {
  test(`late results cannot cross a changed ${change}`, () => {
    const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
    if (change === 'text') row.span.textContent = 'Please send 200 units tomorrow.';
    if (change === 'node') {
      const replacement = f.add({ text: 'Please send 200 units tomorrow.' });
      row.node.replaceWith(replacement.node); replacement.root.remove();
    }
    if (change === 'row') row.root.remove();
    if (change === 'chat') f.state.chatId = '101@c.us';
    if (change === 'session') f.configuration.sessionGeneration = '';
    if (change === 'policy') f.configuration.settings.revision += 1;
    if (change === 'hidden') f.configuration.active = false;
    if (['session', 'policy', 'hidden'].includes(change)) f.configure();
    if (change === 'revoke') f.api.revoke(generation);
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    if (change !== 'revoke') f.poll();
    const boxes = row.root.querySelectorAll('.geek-translation-result');
    assert.ok(boxes.length <= 1); assert.ok(boxes.every((box) => box.textContent !== '请明天发送100件。'));
    if (['text', 'node'].includes(change)) assert.equal(boxes[0].textContent, '点击翻译');
  });
}

test('auto activation and every chat entry baseline existing rows as manual-only', () => {
  const f = guest({ policy: { translationMode: 'auto' } }); const initial = f.add();
  assert.equal(f.poll().requests.length, 0); assert.equal(initial.box().textContent, '点击翻译');
  assert.equal(f.poll().requests.length, 0);
  const fresh = f.add(); let request = f.poll().requests[0]; assert.equal(request.manual, false);
  f.deliver(request, { text: '请明天发送100件。' });
  f.configuration.active = false; f.configure(); f.add(); f.configuration.active = true; f.configure();
  assert.equal(f.poll().requests.length, 0);
  f.state.chatId = '101@c.us'; f.main.children.slice().forEach((row) => row.remove()); f.add();
  assert.equal(f.poll().requests.length, 0); f.add(); assert.equal(f.poll().requests.length, 1);
  assert.equal(fresh.root.isConnected, false);
});

test('turning on auto does not charge existing rows but permits subsequent incoming rows', () => {
  const f = guest(); f.add(); f.poll();
  f.configuration.settings.revision += 1; f.configuration.settings.global.translationMode = 'auto'; f.configure();
  assert.equal(f.poll().requests.length, 0); f.add(); assert.equal(f.poll().requests.length, 1);
});

test('auto rejects old history, own messages, unverified metadata and disabled groups', () => {
  for (const options of [{ sentAt: 999 }, { fromMe: true }, { known: false }, { group: true }]) {
    const f = guest({ policy: { translationMode: 'auto' } });
    if (options.group) f.state.chatId = '100@g.us';
    f.poll(); const row = f.add(options); assert.equal(f.poll().requests.length, 0);
    assert.equal(clicked(f, row).manual, true);
  }
  const groups = guest({ policy: { translationMode: 'auto', groupAuto: true } });
  groups.state.chatId = '100@g.us'; groups.poll(); groups.add(); assert.equal(groups.poll().requests[0].manual, false);
});

test('removing a queued row cancels it immediately and remount preserves logical identity', () => {
  const f = guest(); const row = f.add({ id: 'stable-message-id' }); f.poll(); const first = clicked(f, row);
  row.root.remove(); assert.equal(f.poll().requests.length, 0);
  const replacement = f.add({ id: 'stable-message-id' }); f.poll();
  assert.doesNotMatch(replacement.box().textContent, /翻译中/);
  const retry = clicked(f, replacement); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
});

test('auto to Chinese skips messages already containing Han text without removing manual translation', () => {
  const f = guest({ policy: { translationMode: 'auto' } }); f.poll();
  const row = f.add({ text: '请明天发送100件。' });
  assert.equal(f.poll().requests.length, 0); assert.equal(clicked(f, row).manual, true);
  const english = guest({ policy: { translationMode: 'auto', messageTarget: 'en' } }); english.poll();
  english.add({ text: '请明天发送100件。' }); assert.equal(english.poll().requests[0].manual, false);
});

for (const changed of [{ fontColor: '#123456' }, { fontSize: 15 }, { groupAuto: true }, { displayTranslation: false }]) {
  test(`uncertain request identity survives non-semantic settings ${Object.keys(changed)[0]}`, () => {
    const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
    f.deliver(first, { error: 'NETWORK_UNAVAILABLE' });
    Object.assign(f.configuration.settings.global, changed); f.configuration.settings.revision += 1; f.configure();
    if (changed.displayTranslation === false) {
      assert.equal(f.poll().requests.length, 0);
      f.configuration.settings.global.displayTranslation = true; f.configuration.settings.revision += 1; f.configure();
    }
    f.poll(); const retry = clicked(f, row);
    assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2); assert.equal(retry.refresh, false);
    assert.equal(retry.policyRevision, f.configuration.settings.revision);
    assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
    assert.equal(f.deliver(retry, { text: '请明天发送100件。' }, f.configuration.settings.revision), true);
  });
}

test('appearance edits cancel pending work while retaining its retry identity and completed output', () => {
  const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
  f.configuration.settings.global.fontSize = 15; f.configuration.settings.revision = 1; f.configure();
  assert.equal(f.poll().requests.length, 0); assert.equal(f.deliver(first, { text: '请明天发送100件。' }), false);
  const retry = clicked(f, row); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  f.deliver(retry, { text: '请明天发送100件。' }, 1);
  f.configuration.settings.global.fontColor = '#123456'; f.configuration.settings.revision = 2; f.configure();
  assert.equal(f.poll().requests.length, 0); assert.equal(row.box().textContent, '请明天发送100件。');
  assert.equal(row.box().style.color, '#123456'); assert.equal(row.box().style.fontSize, '15px');
});

test('semantic policy changes create a fresh intent only for affected chats', () => {
  const f = guest(); const row = f.add(); f.poll(); const first = clicked(f, row);
  f.deliver(first, { error: 'NETWORK_UNAVAILABLE' });
  f.configuration.settings.chats['101@c.us'] = { ...f.configuration.settings.global, messageTarget: 'it' };
  f.configuration.settings.revision = 1; f.configure(); f.poll();
  const retry = clicked(f, row); assert.equal(retry.id, first.id);
  f.deliver(retry, { error: 'NETWORK_UNAVAILABLE' }, 1);
  f.configuration.settings.global.route = 'backup'; f.configuration.settings.revision = 2; f.configure(); f.poll();
  const changed = clicked(f, row); assert.notEqual(changed.id, first.id); assert.equal(changed.attempt, 1);
  assert.equal(changed.policyRevision, 2);
});

test('queue bounds and the guest timeout do not allocate automatic retry IDs', () => {
  const f = guest(); const rows = Array.from({ length: 11 }, () => f.add()); f.poll();
  for (const row of rows) row.box().fire('click');
  const requests = f.poll().requests; assert.equal(requests.length, 10); assert.match(rows[10].box().textContent, /队列已满/);
  f.state.now = 38000; assert.equal(f.poll().requests.length, 0);
  assert.match(rows[0].box().textContent, /同一次结果/);
  const retry = clicked(f, rows[0]); assert.equal(retry.id, requests[0].id); assert.equal(retry.attempt, 2);
});
