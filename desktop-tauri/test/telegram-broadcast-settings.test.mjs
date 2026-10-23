import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, catalog, attachment } from './helpers/broadcast.mjs';
import { localSchedule } from '../frontend/models/broadcast.mjs';

const kCatalog = {
  platformId: 'telegram-k', accountName: 'K account',
  capabilities: { text: true, scheduled: true, tagAll: false, vcards: false, attachments: false, groupMembers: false },
  chats: [{ id: 'tg:123', name: 'Alice', realName: 'Alice', kind: 'contact' },
    { id: 'tg:-456', name: 'Team', realName: '', kind: 'group' }],
};
const kState = { activeId: 'k', openedIds: ['k', 'wa'], accounts: [
  { id: 'k', name: 'K account', platformId: 'telegram-k', archived: false },
  { id: 'wa', name: 'WA account', platformId: 'whatsapp', archived: false },
] };
async function save(ui, kind, name) {
  await ui.click(kind === 'message' ? 'bc-save-message' : 'broadcast-save-group');
  await ui.input(`broadcast-${kind}-preset-name`, name);
  await ui.click(`broadcast-${kind}-preset-save`);
}

test('K uses the original four-step workbench, immutable peers, schedule and account-owned presets', async (t) => {
  const ui = await fixture({ state: kState, accountCatalogs: { k: kCatalog }, presets: {} });
  t.after(() => ui.controller.dispose());
  assert.equal(ui.get('btn-broadcast').disabled, false);
  await ui.open();
  assert.equal(ui.panel, 'broadcast-overlay');
  assert.equal(ui.get('broadcast-workbench-nav').children.length, 4);
  for (const id of ['broadcast-import-csv', 'broadcast-add-file', 'broadcast-add-vcard', 'broadcast-tagall']) {
    assert.equal(ui.get(id).disabled, true, id);
  }
  assert.equal(ui.get('broadcast-schedule-toggle').disabled, false);
  assert.equal(ui.get('broadcast-message').maxLength, 4096);
  assert.equal(ui.get('bc-save-message').disabled, false);
  await ui.input('broadcast-message', 'Hello %nc');
  await save(ui, 'message', 'K greeting');
  await ui.select('tg:123'); await ui.select('tg:-456');
  await save(ui, 'audience', 'K audience');
  const saved = ui.presets.read('k');
  assert.equal(saved.messages[0].message, 'Hello %nc');
  assert.deepEqual(saved.audiences[0].recipientIds, ['tg:123', 'tg:-456']);
  assert.equal(ui.presets.read('wa').revision, 0);
  await ui.input('broadcast-schedule-toggle', true, 'change');
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  for (let i = 0; i < 3; i += 1) await ui.click('broadcast-workbench-next');
  assert.match(ui.get('broadcast-review-card').textContent, /K account/);
  assert.match(ui.get('broadcast-review-card').textContent, /Telegram K/);
  assert.doesNotMatch(ui.get('broadcast-review-card').textContent, /WhatsApp/);
  assert.match(ui.get('broadcast-review-card').textContent, /Hello Alice/);
  await ui.click('broadcast-send');
  const calls = ui.calls.filter(([name]) => name === 'create');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].accountId, 'k'); assert.equal(calls[0][1].catalogId, 'k-catalog');
  assert.deepEqual(calls[0][1].recipientIds, ['tg:123', 'tg:-456']);
  assert.equal(calls[0][1].tagAll, false); assert.deepEqual(calls[0][1].attachmentIds, []);
  assert.ok(calls[0][1].scheduledAt > Date.now());
  assert.equal(ui.calls.some(([name]) => ['import', 'resolve', 'audience', 'pick'].includes(name)), false);
});

test('restoring K audience reacquires the current catalog and never retargets a switched account', async (t) => {
  const ui = await fixture({ state: kState, accountCatalogs: { k: kCatalog }, presets: {
    k: { accountId: 'k', revision: 1, messages: [], audiences: [
      { id: 'saved-k', name: 'Saved K', recipientIds: ['tg:123', 'tg:-999', 'tg:-456'] },
    ] },
  }, before: (name, accountId) => name === 'catalog' && accountId === 'wa' ? catalog('wa') : undefined });
  t.after(() => ui.controller.dispose()); await ui.open();
  const chip = ui.get('broadcast-recipient-tag-list').children[0];
  await ui.fire(chip.querySelectorAll('button').find((button) => button.dataset.action === 'apply'), 'click');
  assert.match(ui.get('bc-selected-chips').textContent, /Alice/);
  assert.match(ui.get('bc-selected-chips').textContent, /Team/);
  const restored = ui.calls.find(([name]) => name === 'restorePreset')[1];
  assert.equal(restored.accountId, 'k'); assert.equal(restored.catalogId, 'k-catalog');
  await ui.input('broadcast-message', 'Saved recipients');
  for (let i = 0; i < 3; i += 1) await ui.click('broadcast-workbench-next');
  ui.switchAccount('wa'); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /发送账号已切换/);
});

test('K file selection preserves the caption and schedules opaque attachments under the original account', async (t) => {
  const files = [attachment(1), attachment(2, { name: 'animation.gif', mime: 'image/gif', kind: 'document' })];
  const ui = await fixture({ state: kState, accountCatalogs: { k: {
    ...kCatalog, capabilities: { ...kCatalog.capabilities, attachments: true },
  } }, before: (name, accountId) => name === 'pick' ? { accountId, attachments: files } : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open();
  assert.equal(ui.get('broadcast-add-file').disabled, false);
  await ui.input('broadcast-add-file', true, 'change');
  assert.equal(ui.calls.find(([name]) => name === 'pick')[1], 'k');
  assert.equal(ui.get('broadcast-message').maxLength, 1024);
  assert.match(ui.get('broadcast-files').textContent, /图片 1.png（图片）/);
  assert.match(ui.get('broadcast-files').textContent, /animation.gif（文件）/);
  for (const id of ['broadcast-add-vcard', 'broadcast-tagall']) assert.equal(ui.get(id).disabled, true);
  const caption = '😀'.repeat(512);
  await ui.input('broadcast-message', caption); await ui.select('tg:123');
  await ui.input('broadcast-schedule-toggle', true, 'change');
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
  await ui.click('broadcast-send');
  const request = ui.calls.find(([name]) => name === 'create')[1];
  assert.equal(request.accountId, 'k');
  assert.equal(request.message, caption);
  assert.deepEqual(request.attachmentIds, files.map((file) => file.id));
  assert.deepEqual(request.recipientIds, ['tg:123']);
  assert.ok(request.scheduledAt > Date.now());
  assert.equal(Object.hasOwn(request, 'attachments'), false);
  assert.equal(Object.hasOwn(request, 'paths'), false);
  assert.equal(ui.backend.jobs[0].platformId, 'telegram-k');
  assert.deepEqual(ui.backend.jobs[0].attachments, files);
  ui.switchAccount('wa');
  assert.equal(ui.backend.jobs[0].accountId, 'k');
  assert.equal(ui.backend.jobs[0].platformId, 'telegram-k');
});

test('adding K attachments never truncates a long draft and removing them restores the text limit', async (t) => {
  const files = [attachment()];
  const ui = await fixture({ state: kState, accountCatalogs: { k: {
    ...kCatalog, capabilities: { ...kCatalog.capabilities, attachments: true },
  } }, before: (name, accountId) => name === 'pick' ? { accountId, attachments: files } : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open();
  const message = '😀'.repeat(513);
  await ui.input('broadcast-message', message);
  await ui.input('broadcast-add-file', true, 'change');
  assert.equal(ui.get('broadcast-message').value, message);
  assert.equal(ui.get('broadcast-message').maxLength, 1024);
  await ui.select('tg:123');
  for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
  await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /1024/);
  assert.equal(ui.get('broadcast-message').value, message);
  const remove = ui.get('broadcast-files').querySelector('button');
  await ui.fire(remove, 'click');
  assert.equal(ui.get('broadcast-message').maxLength, 4096);
  assert.equal(ui.get('broadcast-message').value, message);
  assert.deepEqual(ui.calls.find(([name]) => name === 'release')[1], { accountId: 'k', attachmentIds: [files[0].id] });
  await ui.click('broadcast-send');
  const request = ui.calls.find(([name]) => name === 'create')[1];
  assert.equal(request.message, message);
  assert.deepEqual(request.attachmentIds, []);
});

test('correcting a local K caption error restores draft feedback and permits the original submission flow', async (t) => {
  const files = [attachment()];
  const ui = await fixture({ state: kState, accountCatalogs: { k: {
    ...kCatalog, capabilities: { ...kCatalog.capabilities, attachments: true },
  } }, before: (name, accountId) => name === 'pick' ? { accountId, attachments: files } : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'a'.repeat(1025));
  await ui.input('broadcast-add-file', true, 'change'); await ui.select('tg:123');
  for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
  await ui.click('broadcast-send');
  assert.match(ui.get('broadcast-workbench-status').textContent, /1024/);
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);

  await ui.input('broadcast-message', 'Hello %nc');
  assert.doesNotMatch(ui.get('broadcast-workbench-status').textContent, /1024/);
  assert.equal(ui.get('broadcast-workbench-status').dataset.state, 'ready');
  assert.equal(ui.get('broadcast-launch-check').dataset.state, 'ready');
  for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
  assert.match(ui.get('broadcast-review-card').textContent, /Hello Alice/);
  await ui.click('broadcast-send');
  const requests = ui.calls.filter(([name]) => name === 'create');
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1].message, 'Hello %nc');
  assert.deepEqual(requests[0][1].attachmentIds, [files[0].id]);
  assert.equal(ui.backend.jobs.length, 1);
});

test('native create errors survive draft edits and audience updates without changing the retry UUID', async (t) => {
  for (const code of ['BROADCAST_TELEGRAM_CAPTION_LIMIT', 'BROADCAST_PERSISTENCE', 'BROADCAST_UNKNOWN']) {
    const ui = await fixture({ state: kState, accountCatalogs: { k: { ...kCatalog, chats: [kCatalog.chats[0]] } },
      before: (name) => { if (name === 'create') throw code; } });
    try {
      await ui.open(); await ui.input('broadcast-message', 'Hello %nc'); await ui.select('tg:123');
      for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
      await ui.click('broadcast-send');
      const feedback = ui.get('broadcast-workbench-status').textContent;
      assert.equal(ui.get('broadcast-workbench-status').dataset.state, 'error', code);
      await ui.input('broadcast-message', 'Changed %nc');
      assert.equal(ui.get('broadcast-workbench-status').textContent, feedback, code);
      await ui.input('broadcast-message', 'Hello %nc');
      const exclude = [...ui.document.querySelectorAll('input')].find((node) => node.value === 'exclude-contacts');
      exclude.checked = true; await ui.fire(exclude, 'change');
      await ui.click('broadcast-update-exclude-contact');
      assert.equal(ui.get('broadcast-workbench-status').textContent, feedback, code);
      assert.equal(ui.get('broadcast-workbench-status').dataset.state, 'error', code);
      for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next');
      await ui.click('broadcast-send');
      const requests = ui.calls.filter(([name]) => name === 'create');
      assert.equal(requests.length, 2, code);
      assert.equal(requests[0][1].id, requests[1][1].id, code);
      assert.equal(ui.backend.jobs.length, 0, code);
    } finally { ui.controller.dispose(); }
  }
});
