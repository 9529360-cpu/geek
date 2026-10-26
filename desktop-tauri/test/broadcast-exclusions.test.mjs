import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, catalog } from './helpers/broadcast.mjs';
import { localSchedule } from '../frontend/models/broadcast.mjs';

async function mode(ui, value) {
  const node = ui.get('broadcast-overlay').querySelectorAll('input')
    .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
  node.checked = true; await ui.fire(node, 'change');
}
async function exclude(ui, kind, ids) {
  const select = ui.get(`bc-exclude-${kind}-select`);
  for (const option of select.options) option.selected = ids.includes(option.value);
  await ui.fire(select, 'change');
}
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }
const count = (ui) => ui.get('broadcast-overlay').querySelector('.bc-recipient-card').querySelector('small').textContent;
const creates = (ui) => ui.calls.filter(([name]) => name === 'create').map(([, value]) => value);

test('both original typed exclusion controls start with all chats and merge their explicit exclusions', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts');
  assert.equal(ui.get('bc-sendto-exclude-contacts').classList.contains('hidden'), false);
  assert.equal(ui.get('bc-sendto-custom').classList.contains('hidden'), true);
  assert.deepEqual(ui.get('bc-exclude-contacts-select').options.map((option) => option.value), ['a-ann', 'a-ben']);
  await exclude(ui, 'contacts', ['a-ann']);
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  await mode(ui, 'exclude-groups');
  assert.deepEqual(ui.get('bc-exclude-groups-select').options.map((option) => option.value), ['a-team']);
  await exclude(ui, 'groups', ['a-team']);
  assert.equal(count(ui), '发送 1 个对象，已排除 2 个');
  await ui.input('broadcast-message', 'Hello %nc'); await review(ui);
  assert.match(ui.get('broadcast-review-card').textContent, /1 个对象，已排除 2 个/);
  assert.match(ui.get('broadcast-review-card').textContent, /Hello Ben/);
  await ui.click('broadcast-send');
  assert.deepEqual(creates(ui)[0].recipientIds, ['a-ben']);
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), ['a-ben']);
});

test('typed exclusions filter manual, file, paste and all sources and remain visible in final counts', async (t) => {
  const source = catalog();
  const verified = { accountId: 'a', catalog: source, recipientIds: ['a-ann', 'a-ben'],
    summary: { total: 2, accepted: 2, duplicates: 0, invalid: 0, unresolved: 0, skipped: 0 } };
  const ui = await fixture({ before: (name) => name === 'resolve' ? verified
    : name === 'import' ? { ...verified, fileName: '名单.csv' } : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await mode(ui, 'exclude-groups'); await exclude(ui, 'groups', ['a-team']);
  await mode(ui, 'custom'); await ui.select('a-ann'); await ui.select('a-ben'); await ui.select('a-team');
  await ui.input('broadcast-schedule-toggle', true, 'change');
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  for (const value of ['custom', 'excel', 'paste', 'all']) {
    await mode(ui, value);
    if (value === 'excel') await ui.click('broadcast-import-csv');
    if (value === 'paste') {
      await ui.input('bc-paste-numbers', '+16665550101\n+16665550202'); await ui.click('broadcast-verify-numbers');
    }
    const excluded = ['excel', 'paste'].includes(value) ? 1 : 2;
    assert.equal(count(ui), `发送 1 个对象，已排除 ${excluded} 个`);
    await ui.input('broadcast-message', `Frozen ${value}`); await ui.click('broadcast-add-schedule');
    assert.deepEqual(creates(ui).at(-1).recipientIds, ['a-ben']);
  }
  assert.equal(ui.backend.jobs.length, 4);
  assert.deepEqual(ui.backend.jobs.map((job) => job.targets.map((target) => target.id)), Array(4).fill(['a-ben']));
  await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', []);
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
});

test('refreshing a directory cannot add recipients to the exclusion mode frozen base', async (t) => {
  let refreshed = false;
  const next = catalog('a', { catalogId: 'a-refreshed', chats: [...catalog().chats,
    { id: 'a-new', name: 'New contact', realName: '', kind: 'contact' }] });
  const ui = await fixture({ before: (name) => name === 'catalog' && refreshed ? next : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await ui.input('broadcast-message', 'Fixed audience'); await ui.click('broadcast-cancel');
  refreshed = true; await ui.open();
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  assert.equal(ui.get('bc-exclude-contacts-select').options.some((option) => option.value === 'a-new'), true);
  await mode(ui, 'all'); assert.equal(count(ui), '发送 3 个对象，已排除 1 个');
  await mode(ui, 'exclude-groups'); assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(creates(ui)[0].recipientIds, ['a-ben', 'a-team']);
  assert.equal(creates(ui)[0].catalogId, 'a-refreshed');
});

test('a missing member of the frozen base is not silently dropped after a directory refresh', async (t) => {
  let refreshed = false;
  const ui = await fixture({ before: (name) => name === 'catalog' && refreshed
    ? catalog('a', { catalogId: 'a-refreshed', chats: catalog().chats.filter((chat) => chat.id !== 'a-ben') }) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await ui.input('broadcast-message', 'Retained'); await ui.click('broadcast-cancel'); refreshed = true; await ui.open();
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  await review(ui); await ui.click('broadcast-send');
  assert.equal(creates(ui).length, 0);
  assert.match(ui.get('broadcast-workbench-status').textContent, /聊天列表已变化/);
  assert.equal(ui.get('broadcast-message').value, 'Retained');
});

test('only explicitly updating the exclusion base adopts the current directory and preserves excluded IDs', async (t) => {
  let refreshed = false;
  const next = catalog('a', { catalogId: 'a-updated', chats: [catalog().chats[0], catalog().chats[2],
    { id: 'a-new', name: 'New contact', realName: '', kind: 'contact' }] });
  const ui = await fixture({ before: (name) => name === 'catalog' && refreshed ? next : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await ui.input('broadcast-message', 'Explicit refresh'); await ui.click('broadcast-cancel');
  refreshed = true; await ui.open(); await review(ui); await ui.click('broadcast-send');
  assert.equal(creates(ui).length, 0);
  assert.match(ui.get('broadcast-workbench-status').textContent, /聊天列表已变化/);
  await ui.click('broadcast-update-exclude-contact');
  assert.equal(ui.get('bc-exclude-contacts-select').options.find((option) => option.value === 'a-ann').selected, true);
  assert.match(ui.get('broadcast-workbench-status').textContent, /发送对象已更新，排除项已保留/);
  await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(creates(ui)[0].recipientIds, ['a-team', 'a-new']);
  assert.equal(creates(ui)[0].catalogId, 'a-updated');
});

test('excluding the whole frozen audience blocks creation and preserves the selected exclusions', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann', 'a-ben']);
  await mode(ui, 'exclude-groups'); await exclude(ui, 'groups', ['a-team']);
  await ui.input('broadcast-message', 'Nobody'); await review(ui);
  assert.match(ui.get('broadcast-review-card').textContent, /0 个对象，已排除 3 个/);
  await ui.click('broadcast-send'); assert.equal(creates(ui).length, 0);
  assert.match(ui.get('broadcast-workbench-status').textContent, /至少选择一个/);
  assert.equal(ui.get('bc-exclude-groups-select').options[0].selected, true);
});

test('typed exclusions and frozen bases belong to their account draft', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await ui.click('broadcast-cancel'); ui.switchAccount('b'); await ui.open(); await mode(ui, 'exclude-contacts');
  assert.equal(count(ui), '发送 3 个对象，已排除 0 个');
  assert.equal(ui.get('bc-exclude-contacts-select').options.some((option) => option.selected), false);
  await exclude(ui, 'contacts', ['b-ben']); await ui.click('broadcast-cancel');
  ui.switchAccount('a'); await ui.open();
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  assert.equal(ui.get('bc-exclude-contacts-select').options.find((option) => option.value === 'a-ann').selected, true);
  assert.equal(ui.get('bc-exclude-contacts-select').options.some((option) => option.value.startsWith('b-')), false);
});
