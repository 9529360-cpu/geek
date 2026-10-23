import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { fixture, deferred, catalog, attachment } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const state = (accountId = 'a', overrides = {}) => ({ accountId, revision: 0, messages: [], audiences: [], ...overrides });
const radio = (ui, value) => ui.get('broadcast-overlay').querySelectorAll('input')
  .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
async function mode(ui, value) { const node = radio(ui, value); node.checked = true; await ui.fire(node, 'change'); }
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }
function item(ui, kind, id, action = 'apply') {
  const list = ui.get(kind === 'message' ? 'bc-saved-message-list' : 'broadcast-recipient-tag-list');
  const chip = [...list.children].find((node) => node.dataset.presetId === id);
  assert.ok(chip, `Missing preset ${id}`);
  return chip.querySelectorAll('button').find((node) => node.dataset.action === action);
}
async function save(ui, kind, name) {
  await ui.click(kind === 'message' ? 'bc-save-message' : 'broadcast-save-group');
  await ui.input(`broadcast-${kind}-preset-name`, name);
  await ui.click(`broadcast-${kind}-preset-save`);
}
async function startOpen(ui) {
  ui.get('btn-broadcast').fire('click'); await flush(); ui.get('bc-menu-send').fire('click'); await flush();
}

test('preset operations have five named gateway methods and fixed typed arguments', async () => {
  const calls = [];
  const api = connectDesktop(async (command, args) => { calls.push([command, args]); return {}; });
  await api.broadcastPresets('a'); await api.broadcastSaveMessage('a', 2, 'Name', 'Body\n');
  await api.broadcastSaveAudience('a', 'catalog', 3, 'Targets', ['one']);
  await api.broadcastDeletePreset('a', 4, 'message', 'm1'); await api.broadcastRestoreAudience('a', 'catalog', 5, 'p1');
  assert.deepEqual(calls, [
    ['broadcast_presets', { accountId: 'a' }],
    ['broadcast_save_message', { accountId: 'a', expectedRevision: 2, name: 'Name', message: 'Body\n' }],
    ['broadcast_save_audience', { accountId: 'a', catalogId: 'catalog', expectedRevision: 3, name: 'Targets', recipientIds: ['one'] }],
    ['broadcast_delete_preset', { accountId: 'a', expectedRevision: 4, kind: 'message', id: 'm1' }],
    ['broadcast_restore_audience', { accountId: 'a', catalogId: 'catalog', expectedRevision: 5, presetId: 'p1' }],
  ]);
});

test('unavailable APIs retain explicit disabled controls and hide duplicate legacy tag surfaces', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose()); await ui.open();
  assert.equal(ui.get('bc-save-message').disabled, true);
  assert.equal(ui.get('broadcast-save-group').disabled, true);
  assert.match(ui.get('bc-save-message').title, /尚不可用/);
  assert.equal(ui.get('broadcast-show-all-groups').classList.contains('hidden'), true);
  assert.equal(ui.get('bc-saved-lists').parentElement.classList.contains('hidden'), true);
  assert.equal(ui.calls.some(([name]) => name === 'presets'), false);
});

test('messages persist raw text, overwrite by name with stable identity and accept an exact no-op', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose()); await ui.open();
  const body = '  Hello %nc\r\n{One|Two}\t😀  ';
  await ui.input('broadcast-message', body); await save(ui, 'message', '  问候  ');
  const first = ui.presets.read('a').messages[0];
  assert.equal(first.name, '问候'); assert.equal(first.message, body);
  assert.equal(ui.get('bc-saved-message-list').children[0].classList.contains('bc-original-message-chip'), true);
  assert.deepEqual(ui.calls.find(([name]) => name === 'saveMessage')[1], {
    accountId: 'a', expectedRevision: 0, name: '问候', message: body,
  });
  await ui.input('broadcast-message', 'Other'); await save(ui, 'message', 'Second');
  await ui.input('broadcast-message', 'Updated'); await save(ui, 'message', '问候');
  assert.deepEqual(ui.presets.read('a').messages.map((row) => row.id), [first.id, ui.presets.read('a').messages[1].id]);
  const revision = ui.presets.read('a').revision;
  await save(ui, 'message', '问候');
  assert.equal(ui.presets.read('a').revision, revision);
  assert.match(ui.get('broadcast-message-preset-status').textContent, /已保存/);
  assert.doesNotMatch(ui.get('broadcast-message-preset-status').querySelector('span').textContent, /刷新|冲突/);
  assert.equal(ui.get('broadcast-message-preset-refresh').classList.contains('hidden'), true);
  assert.equal(ui.get('bc-save-message').disabled, false);
  await ui.click('broadcast-cancel'); await ui.open();
  assert.equal(ui.get('bc-saved-message-list').children.length, 2);
  assert.equal(ui.calls.filter(([name]) => name === 'presets').length, 2);
});

test('using a saved message replaces only the body and also works while the chat directory is offline', async (t) => {
  let offline = false;
  const ui = await fixture({ presets: { a: state('a', { messages: [{ id: 'm1', name: 'Welcome', message: 'Saved\n%nc' }] }) },
    accountCatalogs: { a: { capabilities: { ...catalog().capabilities, attachments: true } } }, before: (name) => {
      if (name === 'pick') return { accountId: 'a', attachments: [attachment()] };
      if (name === 'catalog' && offline) return catalog('a', { ready: false, chats: [] });
    } });
  t.after(() => ui.controller.dispose()); await ui.open(); await ui.select('a-ann');
  await ui.click('broadcast-dropzone'); await ui.input('bc-range-min', '18'); await ui.input('bc-range-max', '24');
  await ui.input('broadcast-schedule-toggle', true, 'change'); await ui.input('broadcast-message', 'Draft');
  await ui.fire(item(ui, 'message', 'm1'), 'click');
  assert.equal(ui.get('broadcast-message').value, 'Saved\n%nc');
  assert.equal(ui.get('broadcast-files').children.length, 1);
  assert.equal(ui.get('bc-range-min').value, '18'); assert.equal(ui.get('bc-range-max').value, '24');
  assert.equal(ui.get('broadcast-schedule-toggle').checked, true);
  assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
  await ui.click('broadcast-cancel'); offline = true; await ui.open();
  assert.equal(ui.get('bc-save-message').disabled, false);
  assert.equal(ui.get('broadcast-save-group').disabled, true);
  await ui.input('broadcast-message', 'Offline draft'); await save(ui, 'message', 'Offline');
  assert.equal(ui.presets.read('a').messages.length, 2);
  await ui.fire(item(ui, 'message', 'm1'), 'click'); assert.equal(ui.get('broadcast-message').value, 'Saved\n%nc');
});

test('save failure preserves the original list, exact body and inline name for a single retry', async (t) => {
  let fail = true;
  const ui = await fixture({ presets: {}, before: (name) => { if (name === 'saveMessage' && fail) throw 'BROADCAST_PRESET_PERSISTENCE'; } });
  t.after(() => ui.controller.dispose()); await ui.open();
  await ui.input('broadcast-message', 'Keep\n draft'); await save(ui, 'message', 'Keep name');
  assert.equal(ui.presets.read('a').messages.length, 0);
  assert.match(ui.get('bc-saved-message-list').textContent, /暂无/);
  assert.equal(ui.get('broadcast-message-preset-name').value, 'Keep name');
  assert.equal(ui.get('broadcast-message').value, 'Keep\n draft');
  assert.match(ui.get('broadcast-message-preset-status').textContent, /未能保存.*仍保留/);
  assert.equal(ui.get('broadcast-message-preset-form').classList.contains('hidden'), false);
  fail = false; await ui.click('broadcast-message-preset-save'); assert.equal(ui.presets.read('a').messages.length, 1);
});

test('preset conflict requires an explicit refresh and retains the unsaved message and name', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose()); await ui.open();
  ui.presets.publish(state('a', { revision: 2, messages: [{ id: 'remote', name: 'Elsewhere', message: 'Other' }] }));
  await ui.input('broadcast-message', 'My change'); await save(ui, 'message', 'Mine');
  assert.equal(ui.calls.filter(([name]) => name === 'saveMessage').length, 1);
  assert.match(ui.get('broadcast-message-preset-status').textContent, /请刷新后重试/);
  assert.equal(ui.get('broadcast-message-preset-save').disabled, true);
  assert.equal(ui.get('broadcast-message-preset-refresh').classList.contains('hidden'), false);
  await ui.click('broadcast-message-preset-refresh');
  assert.equal(ui.get('broadcast-message').value, 'My change'); assert.equal(ui.get('broadcast-message-preset-name').value, 'Mine');
  assert.match(ui.get('bc-saved-message-list').textContent, /Elsewhere/);
  await ui.click('broadcast-message-preset-save');
  assert.equal(ui.calls.filter(([name]) => name === 'saveMessage').at(-1)[1].expectedRevision, 2);
  assert.equal(ui.presets.read('a').messages.length, 2);
});

test('a same-revision response with changed metadata is refused instead of being treated as a no-op', async (t) => {
  const original = state('a', { messages: [{ id: 'm1', name: 'Same', message: 'Text' }] });
  const ui = await fixture({ presets: { a: original }, before: (name) => name === 'saveMessage'
    ? state('a', { messages: [{ id: 'm1', name: 'Same', message: 'Wrong' }] }) : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); await ui.input('broadcast-message', 'Text'); await save(ui, 'message', 'Same');
  assert.match(ui.get('broadcast-message-preset-status').textContent, /请刷新/);
  assert.equal(item(ui, 'message', 'm1').title, 'Text');
});

test('saving tags freezes the final excluded audience and same-name tags retain distinct IDs', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose()); await ui.open();
  await mode(ui, 'exclude-contacts');
  for (const option of ui.get('bc-exclude-contacts-select').options) option.selected = option.value === 'a-ann';
  await ui.fire(ui.get('bc-exclude-contacts-select'), 'change');
  await save(ui, 'audience', 'Customers'); await save(ui, 'audience', 'Customers');
  const saved = ui.presets.read('a').audiences;
  assert.equal(saved.length, 2); assert.notEqual(saved[0].id, saved[1].id);
  assert.deepEqual(saved[0].recipientIds, ['a-ben', 'a-team']);
  assert.deepEqual(ui.calls.find(([name]) => name === 'saveAudience')[1], {
    accountId: 'a', catalogId: 'a-catalog', expectedRevision: 0, name: 'Customers', recipientIds: ['a-ben', 'a-team'],
  });
  assert.equal(ui.get('broadcast-recipient-tag-list').parentElement.classList.contains('bc-recipient-tag-canonical-row'), true);
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
});

test('tag restore replaces manual choices, preserves exclusions, and a valid zero-result restore clears the old audience', async (t) => {
  const ui = await fixture({ presets: { a: state('a', { audiences: [
    { id: 'partial', name: 'Some', recipientIds: ['a-ann', 'a-team', 'missing'] },
    { id: 'empty', name: 'Gone', recipientIds: ['missing'] },
  ] }) } });
  t.after(() => ui.controller.dispose()); await ui.open(); await ui.select('a-ben');
  await mode(ui, 'exclude-contacts');
  for (const option of ui.get('bc-exclude-contacts-select').options) option.selected = option.value === 'a-ann';
  await ui.fire(ui.get('bc-exclude-contacts-select'), 'change');
  await ui.fire(item(ui, 'audience', 'partial'), 'click');
  assert.equal(radio(ui, 'custom').checked, true);
  assert.match(ui.get('bc-selected-chips').textContent, /Ann.*Team/); assert.doesNotMatch(ui.get('bc-selected-chips').textContent, /Ben/);
  assert.match(ui.get('broadcast-audience-preset-status').textContent, /已恢复 2.*未核验 1.*排除项已保留/);
  await ui.fire(item(ui, 'audience', 'empty'), 'click');
  assert.equal(ui.get('bc-selected-chips').children.length, 0);
  assert.match(ui.get('broadcast-audience-preset-status').textContent, /已恢复 0.*当前没有可用对象/);
  await ui.input('broadcast-message', 'Message'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /至少选择一个/);
  await ui.fire(item(ui, 'audience', 'partial'), 'click'); await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), ['a-team']);
});

test('deleting one same-name tag is ID-bound and persistence failure leaves both visible', async (t) => {
  let fail = true;
  const ui = await fixture({ presets: { a: state('a', { audiences: [
    { id: 'one', name: 'Same', recipientIds: ['a-ann'] }, { id: 'two', name: 'Same', recipientIds: ['a-ben'] },
  ] }) }, before: (name) => { if (name === 'deletePreset' && fail) throw 'BROADCAST_PRESET_PERSISTENCE'; } });
  t.after(() => ui.controller.dispose()); await ui.open();
  await ui.fire(item(ui, 'audience', 'one', 'delete'), 'click');
  assert.equal(ui.calls.some(([name]) => name === 'deletePreset'), false);
  await ui.click('broadcast-audience-preset-delete');
  assert.equal(ui.get('broadcast-recipient-tag-list').children.length, 2);
  assert.match(ui.get('broadcast-audience-preset-status').textContent, /未能保存/);
  fail = false; await ui.click('broadcast-audience-preset-delete');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'deletePreset').at(-1)[1], {
    accountId: 'a', expectedRevision: 0, kind: 'audience', id: 'one',
  });
  assert.deepEqual(ui.presets.read('a').audiences.map((item) => item.id), ['two']);
});

test('a delayed successful message save cannot claim success after text A to B to A edits, but explicit refresh discovers durable state', async (t) => {
  const held = deferred();
  const ui = await fixture({ presets: {}, before: (name) => name === 'saveMessage' ? held.promise : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); await ui.input('broadcast-message', 'A');
  await ui.click('bc-save-message'); await ui.input('broadcast-message-preset-name', 'Name');
  ui.get('broadcast-message-preset-save').fire('click'); ui.get('broadcast-message-preset-save').fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'saveMessage').length, 1);
  for (const text of ['B', 'A']) { ui.get('broadcast-message').value = text; ui.get('broadcast-message').fire('input'); }
  const durable = state('a', { revision: 1, messages: [{ id: 'saved', name: 'Name', message: 'A' }] });
  ui.presets.publish(durable); held.resolve(durable); await ui.controller.idle();
  assert.match(ui.get('bc-saved-message-list').textContent, /暂无/);
  assert.match(ui.get('broadcast-message-preset-status').textContent, /草稿已变化.*刷新/);
  assert.equal(ui.get('broadcast-message').value, 'A');
  await ui.click('broadcast-message-preset-refresh'); assert.match(ui.get('bc-saved-message-list').textContent, /Name/);
});

test('late account-A list data cannot replace account-B presets or its inline name', async (t) => {
  const held = deferred();
  const ui = await fixture({ presets: { b: state('b', { messages: [{ id: 'b-message', name: 'Bob', message: 'B body' }] }) },
    before: (name, id) => name === 'presets' && id === 'a' ? held.promise : undefined });
  t.after(() => ui.controller.dispose()); await startOpen(ui);
  ui.get('broadcast-close').fire('click'); await flush(); ui.switchAccount('b'); await startOpen(ui);
  assert.match(ui.get('bc-saved-message-list').textContent, /Bob/);
  ui.get('bc-save-message').fire('click'); ui.get('broadcast-message-preset-name').value = 'B name';
  ui.get('broadcast-message-preset-name').fire('input');
  held.resolve(state('a', { messages: [{ id: 'a-message', name: 'Alice', message: 'A body' }] })); await ui.controller.idle();
  assert.match(ui.get('bc-saved-message-list').textContent, /Bob/); assert.doesNotMatch(ui.get('bc-saved-message-list').textContent, /Alice/);
  assert.equal(ui.get('broadcast-message-preset-name').value, 'B name');
});

test('metadata load failure has its own retry surface and does not prevent ordinary task creation', async (t) => {
  const ui = await fixture({ presets: {}, before: (name) => { if (name === 'presets') throw 'BROADCAST_PRESET_PERSISTENCE'; } });
  t.after(() => ui.controller.dispose()); await ui.open();
  assert.equal(ui.get('broadcast-message-preset-refresh').classList.contains('hidden'), false);
  await ui.select('a-ann'); await ui.input('broadcast-message', 'Send draft'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.backend.jobs.length, 1);
});

test('invalid names, oversized messages and unverified source audiences are rejected without persistence calls', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose()); await ui.open();
  await ui.input('broadcast-message', 'Body');
  for (const name of [' ', 'Bad\u0001name', '😀'.repeat(41)]) await save(ui, 'message', name);
  await ui.input('broadcast-message', 'x'.repeat(10_001)); await save(ui, 'message', 'Big');
  assert.equal(ui.calls.some(([name]) => name === 'saveMessage'), false);
  await mode(ui, 'paste'); await ui.input('bc-paste-numbers', '+16665550101'); await save(ui, 'audience', 'Unverified');
  assert.equal(ui.calls.some(([name]) => name === 'saveAudience'), false);
  assert.match(ui.get('broadcast-audience-preset-status').textContent, /先核验/);
});

test('audience saves share the native recipient gate and late name edits require refresh instead of a false success', async (t) => {
  const held = deferred();
  const ui = await fixture({ presets: {}, before: (name) => name === 'saveAudience' ? held.promise : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); await ui.select('a-ann');
  await ui.click('broadcast-save-group'); await ui.input('broadcast-audience-preset-name', 'A');
  ui.get('broadcast-audience-preset-save').fire('click'); await flush();
  assert.equal(ui.get('broadcast-import-csv').disabled, true);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('broadcast-message').disabled, false);
  for (const name of ['B', 'A']) {
    ui.get('broadcast-audience-preset-name').value = name; ui.get('broadcast-audience-preset-name').fire('input');
  }
  held.resolve(state('a', { revision: 1, audiences: [{ id: 'saved', name: 'A', recipientIds: ['a-ann'] }] }));
  await ui.controller.idle();
  assert.match(ui.get('broadcast-recipient-tag-list').textContent, /暂无/);
  assert.match(ui.get('broadcast-audience-preset-status').textContent, /草稿已变化.*刷新/);
  assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
  assert.equal(ui.get('broadcast-import-csv').disabled, false);
});

for (const change of ['close', 'account-roundtrip']) {
  test(`a late zero-result restore preserves the old audience after ${change}`, async (t) => {
    const held = deferred();
    const ui = await fixture({ presets: { a: state('a', { audiences: [{ id: 'gone', name: 'Gone', recipientIds: ['missing'] }] }) },
      before: (name) => name === 'restorePreset' ? held.promise : undefined });
    t.after(() => ui.controller.dispose()); await ui.open(); await ui.select('a-ann'); await ui.input('broadcast-message', 'Kept');
    item(ui, 'audience', 'gone').fire('click'); await flush();
    if (change === 'close') { ui.get('broadcast-close').fire('click'); await flush(); }
    else {
      ui.switchAccount('b'); ui.switchAccount('a');
      assert.equal(ui.get('broadcast-import-csv').disabled, true);
    }
    held.resolve({ accountId: 'a', catalog: catalog(), recipientIds: [],
      summary: { total: 1, accepted: 0, duplicates: 0, invalid: 0, unresolved: 1, skipped: 0 } });
    await ui.controller.idle(); if (change === 'close') await ui.open();
    assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
    assert.equal(ui.get('broadcast-message').value, 'Kept');
    assert.doesNotMatch(ui.get('broadcast-audience-preset-status').querySelector('span').textContent, /已恢复/);
    assert.equal(ui.get('broadcast-import-csv').disabled, false);
  });
}
