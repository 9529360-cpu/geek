import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, chatPolicyFrom, chatPolicyOf, effectivePolicy, translationOf } from '../frontend/models/translation.mjs';
import { deferred, fixture, turn } from './helpers/translation.mjs';

const chatDefault = { enabled: false, autoSend: false, target: 'en', messageAction: true,
  displayTranslation: true, translationMode: 'click', messageTarget: 'zh' };
const updates = (ui) => ui.calls.filter(([name]) => name === 'update').map(([, args]) => args);
const resolved = (ui, id = 'a', chatId = 'a-ann') => {
  const settings = ui.backend.accounts.find((account) => account.id === id).translation;
  return effectivePolicy(settings.global, settings.chats[chatId] || null);
};
const expectChatShape = (policy) => assert.deepEqual(Object.keys(policy).sort(), Object.keys(chatDefault).sort());

test('chat snapshots require exactly the seven original override fields', () => {
  assert.deepEqual(chatPolicyFrom(DEFAULT_POLICY), chatDefault);
  assert.deepEqual(chatPolicyOf(chatDefault), chatDefault);
  const { target, ...missing } = chatDefault;
  for (const value of [null, [], missing, DEFAULT_POLICY, { ...chatDefault, route: 'backup' },
    { ...chatDefault, enabled: 'yes' }, { ...chatDefault, target: 'auto' }, { ...chatDefault, translationMode: 'other' }]) {
    assert.throws(() => chatPolicyOf(value), (error) => error === 'TRANSLATION_INVALID');
  }
  const settings = { revision: 2, global: { ...DEFAULT_POLICY }, chats: { ann: { ...chatDefault } } };
  const read = translationOf({ translation: settings });
  assert.deepEqual(read.chats.ann, chatDefault);
  read.chats.ann.target = 'it'; assert.equal(settings.chats.ann.target, 'en');
  assert.throws(() => translationOf({ translation: { ...settings, chats: { ann: DEFAULT_POLICY } } }),
    (error) => error === 'TRANSLATION_INVALID');
});

test('original chat controls save seven fields while advanced settings keep following global changes', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  await ui.input('translation-send', true);
  await ui.input('translation-send-to', 'it');
  await ui.input('translation-message-to', 'es');
  await ui.input('translation-manual', false);
  await ui.input('translation-chat-override', true);
  const expected = { ...chatDefault, enabled: true, autoSend: true, target: 'it', messageTarget: 'es', messageAction: false };
  assert.deepEqual(updates(ui).at(-1).policy, expected);
  await ui.input('translation-include-zh', false);
  await ui.input('translation-server', 'backup');
  await ui.input('translation-font-size', '15');
  await ui.input('translation-send-from', 'zh');
  await ui.input('translation-message-from', 'ja');
  assert.deepEqual(ui.backend.accounts[0].translation.chats['a-ann'], expected);
  const policy = resolved(ui);
  assert.equal(policy.includeZh, false); assert.equal(policy.route, 'backup'); assert.equal(policy.fontSize, 15);
  assert.equal(policy.source, 'zh'); assert.equal(policy.messageFrom, 'ja');
  assert.equal(ui.get('translation-target').value, 'it');
  assert.equal(ui.get('translation-channel-message-to').value, 'es');
  assert.match(ui.get('translation-chat-hint').textContent, /其他选项跟随全局/);
});

test('a failed global draft stays visible but a successful chat save inherits only durable global authority', async () => {
  let failGlobal = true;
  const ui = await fixture({ before: async (name, args) => {
    if (name === 'update' && args.chatId === null && failGlobal) throw 'STORE_IO';
  } });
  await ui.click('btn-translation');
  await ui.input('translation-font-size', '15');
  await ui.input('translation-server', 'backup');
  await ui.input('translation-include-zh', false);
  await ui.input('translation-send', true);
  await ui.input('translation-send-to', 'it');
  await ui.input('translation-chat-override', true);
  const stored = ui.backend.accounts[0].translation;
  assert.deepEqual(stored.global, DEFAULT_POLICY);
  assert.deepEqual(stored.chats['a-ann'], { ...chatDefault, enabled: true, autoSend: true, target: 'it' });
  expectChatShape(updates(ui).at(-1).policy);
  assert.equal(resolved(ui).route, 'default'); assert.equal(resolved(ui).fontSize, 13); assert.equal(resolved(ui).includeZh, true);
  assert.equal(ui.get('translation-server').value, 'backup'); assert.equal(ui.get('translation-font-size').value, '15');
  assert.equal(ui.get('translation-include-zh').checked, false);
  assert.match(ui.get('translation-global-status').textContent, /草稿尚未保存/);
  failGlobal = false; await ui.click('translation-global-retry');
  assert.equal(resolved(ui).route, 'backup'); assert.equal(resolved(ui).fontSize, 15); assert.equal(resolved(ui).includeZh, false);
  assert.equal(updates(ui).filter((args) => args.chatId !== null).length, 1);
});

test('queued chat changes never pin an older global snapshot while later global edits are saving', async () => {
  const pending = deferred(); let first = true;
  const ui = await fixture({ before: async (name, args) => {
    if (name === 'update' && args.chatId === null && first) { first = false; await pending.promise; }
  } });
  await ui.click('btn-translation');
  ui.get('translation-server').value = 'backup'; ui.get('translation-server').fire('change');
  ui.get('translation-chat-override').checked = true; ui.get('translation-chat-override').fire('change');
  ui.get('translation-font-size').value = '15'; ui.get('translation-font-size').fire('change');
  ui.get('translation-include-zh').checked = false; ui.get('translation-include-zh').fire('change');
  pending.resolve(); await ui.idle();
  assert.deepEqual(updates(ui).map((args) => [args.chatId, args.expectedRevision]), [[null, 1], ['a-ann', 2], [null, 3]]);
  assert.deepEqual(updates(ui)[1].policy, chatDefault);
  assert.deepEqual(ui.backend.accounts[0].translation.chats['a-ann'], chatDefault);
  assert.equal(resolved(ui).route, 'backup'); assert.equal(resolved(ui).fontSize, 15); assert.equal(resolved(ui).includeZh, false);
});

test('chat retry after a revision conflict preserves the refreshed global settings', async () => {
  const ui = await fixture(); await ui.click('btn-translation'); await ui.input('translation-chat-override', true);
  Object.assign(ui.backend.accounts[0].translation.global, { route: 'backup', fontSize: 15, includeZh: false });
  ui.backend.accounts[0].translation.revision = 7;
  await ui.input('translation-channel-message-to', 'es');
  assert.equal(updates(ui).length, 2);
  assert.equal(ui.get('translation-channel-message-to').value, 'es');
  assert.equal(ui.get('translation-server').value, 'backup');
  assert.match(ui.get('translation-chat-status').textContent, /草稿已保留/);
  await ui.click('translation-chat-retry');
  const request = updates(ui).at(-1); expectChatShape(request.policy);
  assert.equal(request.expectedRevision, 7); assert.equal(request.policy.messageTarget, 'es');
  assert.equal(resolved(ui).route, 'backup'); assert.equal(resolved(ui).fontSize, 15); assert.equal(resolved(ui).includeZh, false);
});

test('a late chat save snapshot cannot replace another account global policy or draft', async () => {
  const pending = deferred(); let hold = false; let ui;
  ui = await fixture({ before: async (name, args) => {
    if (name === 'update' && args.id === 'a' && args.chatId && hold) {
      const saved = ui.commit(args.id, args.chatId, args.policy, args.expectedRevision);
      await pending.promise; return saved;
    }
  } });
  await ui.click('btn-translation'); await ui.input('translation-chat-override', true); hold = true;
  ui.get('translation-channel-message-to').value = 'es'; ui.get('translation-channel-message-to').fire('change');
  await turn(); ui.switchAccount('b'); await turn();
  ui.get('translation-server').value = 'primary'; ui.get('translation-server').fire('change'); await turn();
  pending.resolve(); await ui.idle();
  assert.equal(ui.shell.activeId, 'b'); assert.equal(ui.get('translation-server').value, 'primary');
  assert.equal(ui.shell.accounts[1].translation.global.route, 'primary');
  assert.deepEqual(ui.shell.accounts[0].translation.chats['a-ann'], { ...chatDefault, messageTarget: 'es' });
  expectChatShape(updates(ui).find((args) => args.id === 'a' && args.policy?.messageTarget === 'es').policy);
});
