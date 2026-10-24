import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, turn } from './helpers/translation.mjs';
import { translationCapabilities, validatePlatformPolicy, DEFAULT_POLICY } from '../frontend/models/translation.mjs';

for (const id of ['tg', 'tgk']) {
  test(`${id}: original receive settings and seven-field chat override respect platform capabilities`, async () => {
    const ui = await fixture(); ui.chats.set(id, { id: 'tg:123', name: '123' });
    ui.switchAccount(id); await ui.click('btn-translation');
    assert.equal(ui.get('translation-message-to').disabled, false);
    assert.equal(ui.get('translation-chat-override').disabled, false);
    for (const control of ['translation-send', 'translation-include-zh']) {
      assert.equal(ui.get(control).disabled, id === 'tg', control);
    }
    for (const control of ['translation-send-from', 'translation-send-to', 'translation-enabled', 'translation-target']) {
      assert.equal(ui.get(control).disabled, true, control);
      if (id === 'tg') assert.match(ui.get(control).title, /发送翻译暂不可用/);
    }
    assert.equal(ui.get('translation-receive-auto').disabled, false);
    assert.equal(ui.get('translation-group').disabled, true);
    await ui.input('translation-message-to', 'it');
    await ui.input('translation-chat-override', true);
    assert.equal(ui.get('translation-channel-receive-auto').disabled, false);
    await ui.input('translation-channel-message-to', 'es');
    const policy = ui.backend.accounts.find((account) => account.id === id).translation;
    assert.equal(policy.global.messageTarget, 'it'); assert.equal(policy.global.enabled, false);
    assert.equal(policy.global.autoSend, false); assert.equal(policy.global.translationMode, 'click');
    assert.equal(policy.chats['tg:123'].messageTarget, 'es'); assert.equal(Object.keys(policy.chats['tg:123']).length, 7);
    const updates = ui.calls.filter(([name]) => name === 'update').map(([, args]) => args);
    assert.ok(updates.every((args) => args.id === id));
    assert.equal(ui.backend.accounts[0].translation.revision, 1);
    await ui.input('translation-chat-override', false);
    assert.equal(ui.backend.accounts.find((account) => account.id === id).translation.chats['tg:123'], undefined);
  });

  test(`${id}: failed receive-policy saves keep the draft and retry the same account revision`, async () => {
    const ui = await fixture(); ui.switchAccount(id); await ui.click('btn-translation');
    ui.failures.set('update', 'STORE_IO'); await ui.input('translation-message-to', 'it');
    assert.equal(ui.get('translation-message-to').value, 'it');
    assert.equal(ui.backend.accounts.find((account) => account.id === id).translation.global.messageTarget, 'zh');
    await ui.click('translation-close'); ui.switchAccount('a'); await ui.click('btn-translation');
    assert.equal(ui.get('translation-message-to').value, 'zh');
    await ui.click('translation-close'); ui.switchAccount(id); await ui.click('btn-translation');
    ui.failures.delete('update'); await ui.click('translation-global-retry');
    const calls = ui.calls.filter(([name]) => name === 'update').map(([, args]) => args);
    assert.equal(calls.length, 2); assert.ok(calls.every((args) => args.id === id && args.expectedRevision === 1));
    assert.equal(ui.backend.accounts.find((account) => account.id === id).translation.global.messageTarget, 'it');
  });
}

test('A forged disabled sending switch cannot enqueue unsupported policy IPC', async () => {
  const ui = await fixture(); ui.switchAccount('tg'); await ui.click('btn-translation');
  const before = structuredClone(ui.backend);
  const node = ui.get('translation-send'); node.disabled = false; node.checked = true; node.fire('change'); await ui.idle();
  assert.equal(ui.calls.filter(([name]) => name === 'update').length, 0);
  assert.equal(node.disabled, true); assert.deepEqual(ui.backend, before);
});

test('K sending policy and language survive account switches without changing A or WhatsApp', async () => {
  const ui = await fixture(); const before = structuredClone(ui.backend.accounts);
  ui.switchAccount('tgk'); await ui.click('btn-translation');
  await ui.input('translation-send', true);
  assert.equal(ui.get('translation-send-from').disabled, false);
  assert.equal(ui.get('translation-send-to').disabled, false);
  await ui.input('translation-send-to', 'it');
  const saved = ui.backend.accounts.find((account) => account.id === 'tgk').translation;
  assert.equal(saved.global.enabled, true); assert.equal(saved.global.autoSend, true);
  assert.equal(saved.global.target, 'it');
  for (const account of before.filter((account) => account.id !== 'tgk')) {
    assert.deepEqual(ui.backend.accounts.find((current) => current.id === account.id), account);
  }
  await ui.click('translation-close'); ui.switchAccount('tg'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-send').checked, false); assert.equal(ui.get('translation-send').disabled, true);
  await ui.click('translation-close'); ui.switchAccount('tgk'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-send').checked, true); assert.equal(ui.get('translation-send-to').value, 'it');
});

test('late Telegram A context cannot replace the selected Telegram K settings context', async () => {
  const held = deferred();
  const ui = await fixture({ before: (method, args) => method === 'context' && args === 'tg' ? held.promise : undefined });
  ui.chats.set('tgk', { id: 'tg:456', name: 'K chat' });
  ui.switchAccount('tg'); ui.get('btn-translation').fire('click'); await turn();
  ui.switchAccount('tgk'); await turn();
  held.resolve({ accountId: 'tg', generation: 'old', available: true, chat: { id: 'tg:123', name: 'Late A' } });
  await ui.idle(); assert.match(ui.get('translation-chat-hint').textContent, /K chat/);
  await ui.input('translation-chat-override', true);
  const update = ui.calls.find(([name]) => name === 'update')[1];
  assert.equal(update.id, 'tgk'); assert.equal(update.chatId, 'tg:456');
});

for (const id of ['tg', 'tgk']) test(`${id} saves automatic/group policy and chat override through the original account owner`, async () => {
  const ui = await fixture(); ui.chats.set(id, { id: 'tg:-123', name: 'Synthetic group' });
  ui.switchAccount(id); await ui.click('btn-translation');
  await ui.input('translation-receive-auto', true);
  assert.equal(ui.get('translation-group').disabled, false);
  await ui.input('translation-group', true); await ui.input('translation-chat-override', true);
  await ui.input('translation-channel-receive-auto', false);
  const settings = ui.backend.accounts.find((account) => account.id === id).translation;
  assert.equal(settings.global.translationMode, 'auto'); assert.equal(settings.global.groupAuto, true);
  assert.equal(settings.chats['tg:-123'].translationMode, 'click');
  assert.equal(Object.keys(settings.chats['tg:-123']).length, 7);
  assert.equal(settings.global.enabled, false); assert.equal(settings.global.autoSend, false);
  assert.ok(ui.calls.filter(([name]) => name === 'update').every(([, args]) => args.id === id));
  await ui.click('translation-close'); ui.switchAccount(id === 'tg' ? 'tgk' : 'tg'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-receive-auto').disabled, false); assert.equal(ui.get('translation-receive-auto').checked, false);
});

test('capabilities remain explicit for archived, unknown and unavailable Telegram aliases', () => {
  for (const account of [{ platformId: 'telegram' }, { platformId: 'telegram-pure' },
    { platformId: 'line' }, { platformId: 'telegram-z', archived: true }]) {
    assert.equal(translationCapabilities(account).receive, false);
    assert.throws(() => validatePlatformPolicy(account, DEFAULT_POLICY));
  }
  for (const platformId of ['whatsapp', 'whatsapp-pure', 'telegram-k']) {
    assert.deepEqual(translationCapabilities({ platformId }), { receive: true, automatic: true, outgoing: true });
  }
  assert.deepEqual(translationCapabilities({ platformId: 'telegram-z' }), { receive: true, automatic: true, outgoing: false });
});
