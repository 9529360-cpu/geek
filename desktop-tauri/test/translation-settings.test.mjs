import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, policyOf, sessionOf, sessionStatus, translationError } from '../frontend/models/translation.mjs';
import { deferred, fixture, signedIn, turn } from './helpers/translation.mjs';

test('translation model rejects invalid policy values and never echoes unknown native errors', () => {
  assert.deepEqual(policyOf(), DEFAULT_POLICY);
  for (const patch of [{ route: 'https://private.invalid' }, { fontColor: 'red' }, { fontSize: 13.5 },
    { messageTarget: 'auto' }, { provider: 'custom' }, { extra: 'key' }, { groupAuto: 'yes' }]) {
    assert.throws(() => policyOf({ ...DEFAULT_POLICY, ...patch }), (error) => error === 'TRANSLATION_INVALID');
  }
  assert.throws(() => sessionOf(signedIn({ remainingChars: -1 })), (error) => error === 'NETWORK_RESPONSE_INVALID');
  assert.equal(sessionStatus(signedIn({ remainingChars: 0, quotaFresh: false })).quota, '字符余额未知');
  assert.doesNotMatch(translationError('password=private'), /password|private/);
});

test('received-message settings save a complete policy without enabling outgoing translation', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  assert.equal(ui.panel, 'translation-popover');
  assert.equal(ui.get('translation-chat-hint').textContent.includes('Ann'), true);
  assert.equal(ui.get('translation-send').disabled, false);
  assert.equal(ui.get('translation-enabled').disabled, true);
  await ui.input('translation-receive-auto', true);
  await ui.input('translation-group', true);
  await ui.input('translation-message-to', 'it');
  const authority = ui.backend.accounts[0].translation;
  assert.equal(authority.global.translationMode, 'auto');
  assert.equal(authority.global.groupAuto, true);
  assert.equal(authority.global.messageTarget, 'it');
  assert.equal(authority.global.enabled, false);
  assert.equal(authority.global.autoSend, false);
  assert.equal(authority.global.translateHistory, false);
  assert.match(ui.get('translation-global-status').textContent, /已保存/);
  assert.equal(ui.calls.filter(([name]) => name === 'update')[0][1].expectedRevision, 1);
});

test('original sending controls persist the synchronized enable flags and independent source/target', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  await ui.input('translation-send', true);
  await ui.input('translation-send-from', 'zh');
  await ui.input('translation-send-to', 'it');
  await ui.input('translation-include-zh', false);
  const policy = ui.backend.accounts[0].translation.global;
  assert.equal(policy.enabled, true); assert.equal(policy.autoSend, true);
  assert.equal(policy.source, 'zh'); assert.equal(policy.target, 'it'); assert.equal(policy.includeZh, false);
  assert.equal(policy.messageTarget, 'zh'); assert.equal(policy.translationMode, 'click');
  await ui.input('translation-send', false);
  assert.equal(ui.backend.accounts[0].translation.global.enabled, false);
  assert.equal(ui.backend.accounts[0].translation.global.autoSend, false);
});

test('per-chat sending keeps the captured native chat and saving failure preserves only its draft', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  await ui.input('translation-chat-override', true);
  ui.chats.set('a', { id: 'a-other', name: 'Another chat' });
  ui.failures.set('update', 'STORE_IO'); await ui.input('translation-enabled', true);
  assert.equal(ui.get('translation-enabled').checked, true);
  assert.equal(ui.backend.accounts[0].translation.chats['a-ann'].enabled, false);
  assert.equal(ui.backend.accounts[0].translation.chats['a-other'], undefined);
  assert.match(ui.get('translation-chat-status').textContent, /草稿/);
  ui.failures.delete('update'); await ui.click('translation-chat-retry');
  await ui.input('translation-target', 'fr');
  const policy = ui.backend.accounts[0].translation.chats['a-ann'];
  assert.equal(policy.enabled, true); assert.equal(policy.autoSend, true); assert.equal(policy.target, 'fr');
  assert.equal(ui.backend.accounts[0].translation.global.enabled, false);
  ui.switchAccount('b');
  assert.equal(ui.get('translation-send').checked, false);
  assert.equal(ui.get('translation-send-to').value, 'en');
});

test('failed save retains draft without publishing it and retries only after explicit action', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  ui.failures.set('update', 'STORE_IO');
  await ui.input('translation-message-to', 'it');
  assert.equal(ui.get('translation-message-to').value, 'it');
  assert.equal(ui.shell.accounts[0].translation.global.messageTarget, 'zh');
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'zh');
  assert.match(ui.get('translation-global-status').textContent, /草稿尚未保存/);
  assert.doesNotMatch(ui.get('translation-global-status').textContent, /已保存/);
  assert.equal(ui.calls.filter(([name]) => name === 'update').length, 1);
  ui.failures.delete('update'); await ui.click('translation-global-retry');
  assert.equal(ui.calls.filter(([name]) => name === 'update').length, 2);
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'it');
  assert.match(ui.get('translation-global-status').textContent, /已保存/);
});

test('changes during a save queue with the new revision and never replace the newer draft', async () => {
  const pending = deferred(); let first = true;
  const ui = await fixture({ before: async (name) => {
    if (name === 'update' && first) { first = false; await pending.promise; }
  } });
  await ui.click('btn-translation');
  ui.get('translation-message-to').value = 'it'; ui.get('translation-message-to').fire('change');
  ui.get('translation-message-to').value = 'fr'; ui.get('translation-message-to').fire('change');
  assert.equal(ui.get('translation-message-to').value, 'fr');
  pending.resolve(); await ui.idle();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'update').map(([, args]) => [args.policy.messageTarget, args.expectedRevision]),
    [['it', 1], ['fr', 2]]);
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'fr');
  assert.equal(ui.get('translation-message-to').value, 'fr');
});

test('late A context and A save cannot rebind B or replace B draft', async () => {
  const contextA = deferred(); const saveA = deferred(); let heldContext = true;
  const ui = await fixture({ before: async (name, args) => {
    if (name === 'context' && args === 'a' && heldContext) return contextA.promise;
    if (name === 'update' && args.id === 'a') await saveA.promise;
  } });
  ui.get('btn-translation').fire('click'); await turn();
  ui.get('translation-message-to').value = 'it'; ui.get('translation-message-to').fire('change');
  ui.switchAccount('b'); await turn();
  ui.get('translation-message-to').value = 'fr'; ui.get('translation-message-to').fire('change');
  contextA.resolve({ accountId: 'a', generation: 1, available: true, chat: { id: 'a-old', name: 'Old Ann' } });
  saveA.resolve(); await ui.idle();
  assert.equal(ui.shell.activeId, 'b');
  assert.equal(ui.get('translation-message-to').value, 'fr');
  assert.match(ui.get('translation-chat-hint').textContent, /Ben/);
  assert.doesNotMatch(ui.get('translation-chat-hint').textContent, /Old Ann/);
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'it');
  assert.equal(ui.backend.accounts[1].translation.global.messageTarget, 'fr');
  heldContext = false;
});

test('chat override uses the captured native chat and failed reset remains explicitly retryable', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  ui.chats.set('a', { id: 'a-new', name: 'New chat' });
  await ui.input('translation-chat-override', true);
  await ui.input('translation-channel-message-to', 'es');
  assert.equal(ui.backend.accounts[0].translation.chats['a-ann'].messageTarget, 'es');
  assert.equal(ui.backend.accounts[0].translation.chats['a-new'], undefined);
  ui.failures.set('update', 'STORE_IO'); await ui.click('translation-chat-reset');
  assert.equal(ui.get('translation-chat-override').checked, false);
  assert.equal(ui.get('translation-chat-retry').disabled, false);
  assert.equal(ui.backend.accounts[0].translation.chats['a-ann'].messageTarget, 'es');
  ui.failures.delete('update'); await ui.click('translation-chat-retry');
  assert.equal(ui.backend.accounts[0].translation.chats['a-ann'], undefined);
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'zh');
});

test('revision conflict refreshes authority and preserves the draft without automatic replay', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  ui.backend.accounts[0].translation.revision = 7;
  ui.backend.accounts[0].translation.global.route = 'backup';
  await ui.input('translation-message-to', 'it');
  assert.equal(ui.calls.filter(([name]) => name === 'update').length, 1);
  assert.equal(ui.get('translation-message-to').value, 'it');
  assert.match(ui.get('translation-global-status').textContent, /草稿已保留/);
  await ui.click('translation-global-retry');
  assert.equal(ui.calls.filter(([name]) => name === 'update').at(-1)[1].expectedRevision, 7);
  assert.equal(ui.backend.accounts[0].translation.global.messageTarget, 'it');
});

test('failed drafts survive closing and switching accounts, and global reset retains chat overrides', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  await ui.input('translation-chat-override', true);
  await ui.input('translation-channel-message-to', 'es');
  ui.failures.set('update', 'STORE_IO'); await ui.input('translation-message-to', 'it');
  await ui.click('translation-close'); ui.switchAccount('b'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-message-to').value, 'zh');
  await ui.click('translation-close'); ui.switchAccount('a'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-message-to').value, 'it');
  ui.failures.delete('update');
  await ui.click('translation-global-reset');
  assert.match(ui.get('translation-global-reset').textContent, /确认/);
  await ui.click('translation-global-reset');
  assert.deepEqual(ui.backend.accounts[0].translation.global, DEFAULT_POLICY);
  assert.equal(ui.backend.accounts[0].translation.chats['a-ann'].messageTarget, 'es');
});

test('unsupported platforms keep the original settings visible but cannot write or enumerate chats', async () => {
  const ui = await fixture(); ui.switchAccount('tg'); await ui.click('btn-translation');
  assert.equal(ui.get('translation-receive-auto').disabled, true);
  assert.equal(ui.get('translation-chat-override').disabled, true);
  assert.match(ui.get('translation-service-detail').textContent, /尚未迁移/);
  assert.equal(ui.calls.filter(([name]) => name === 'context' || name === 'update').length, 0);
});

test('translation tabs support arrow keys and save feedback remains outside the scrolling panel', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  ui.get('translation-tab-button-global').fire('keydown', { key: 'ArrowRight' });
  assert.equal(ui.document.activeElement.id, 'translation-tab-button-channel');
  assert.equal(ui.get('translation-tab-channel').classList.contains('hidden'), false);
  ui.get('translation-tab-button-channel').fire('keydown', { key: 'End' });
  assert.equal(ui.document.activeElement.id, 'translation-tab-button-advanced');
  await ui.input('translation-font-size', '15');
  assert.equal(ui.get('translation-global-feedback').hidden, false);
  assert.equal(ui.get('translation-feedback').parentElement.id, 'translation-popover');
  assert.match(ui.get('translation-global-status').textContent, /已保存/);
});
