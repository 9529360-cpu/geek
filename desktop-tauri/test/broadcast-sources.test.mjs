import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { fixture, deferred, catalog } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const radio = (ui, value) => ui.get('broadcast-overlay').querySelectorAll('input')
  .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
async function mode(ui, value) { const node = radio(ui, value); node.checked = true; await ui.fire(node, 'change'); }
async function choose(ui, id, values) {
  const select = ui.get(id);
  for (const option of select.options) option.selected = values.includes(option.value);
  if (!select.hasAttribute('multiple')) select.value = values[0] || '';
  await ui.fire(select, 'change');
}
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }
function sourceCatalog(accountId = 'a', overrides = {}) {
  const base = catalog(accountId);
  return { ...base, capabilities: { ...base.capabilities, groupMembers: true },
    labels: [{ id: 'label-one', name: '客户' }, { id: 'label-two', name: '客户' }],
    chats: [...base.chats, { id: `${accountId}-other-team`, name: 'Other team', kind: 'group' }], ...overrides };
}
function resolved(ids = ['a-ben'], overrides = {}) {
  return { accountId: 'a', catalog: sourceCatalog('a', { catalogId: 'a-read' }), recipientIds: ids,
    summary: { total: ids.length, accepted: ids.length, duplicates: 0, invalid: 0, unresolved: 0, skipped: 0 }, ...overrides };
}
const setup = (before, overrides = {}) => fixture({ accountCatalogs: { a: sourceCatalog(), b: sourceCatalog('b') }, before, ...overrides });

test('the finite audience gateway forwards only the pinned owner, catalog and typed source', async () => {
  const calls = [];
  const result = resolved();
  const api = connectDesktop(async (command, args) => { calls.push([command, args]); return result; });
  for (const source of [{ kind: 'groups', groupIds: ['a-team', 'a-other-team'] }, { kind: 'label', labelId: 'label-two' }]) {
    assert.equal(await api.broadcastResolveAudience('a', 'a-catalog', source), result);
    assert.deepEqual(calls.at(-1), ['broadcast_resolve_audience', { accountId: 'a', catalogId: 'a-catalog', source }]);
  }
  assert.equal(Object.hasOwn(api, 'invoke'), false);
});

test('original group controls read once on demand, freeze contacts and retain all independent audience drafts', async (t) => {
  const ui = await setup((name) => name === 'audience' ? resolved(['a-ben'], {
    summary: { total: 3, accepted: 1, duplicates: 1, invalid: 0, unresolved: 0, skipped: 1 },
  }) : name === 'resolve' ? resolved(['a-ann']) : name === 'import' ? { ...resolved(['a-ben']), fileName: '联系人.csv' } : undefined);
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-ann');
  await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await mode(ui, 'paste'); await ui.input('bc-paste-numbers', '+16665550101'); await ui.click('broadcast-verify-numbers');
  await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', ['a-team', 'a-other-team']);
  assert.equal(ui.calls.some(([name]) => name === 'audience'), false);
  assert.equal(ui.get('bc-sendto-group-members').classList.contains('hidden'), false);
  assert.equal(ui.get('broadcast-read-group-members').parentElement.parentElement.id, 'bc-sendto-group-members');
  await ui.input('broadcast-message', 'Hello %nc'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /先读取/);
  await ui.click('broadcast-read-group-members');
  assert.deepEqual(ui.calls.find(([name]) => name === 'audience')[1], {
    accountId: 'a', catalogId: 'a-read', source: { kind: 'groups', groupIds: ['a-team', 'a-other-team'] },
  });
  assert.match(ui.get('bc-groups-meta').textContent, /已读取 1 个联系人.*重复 1.*跳过 1/);
  await mode(ui, 'custom'); assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
  await mode(ui, 'excel'); assert.match(ui.get('bc-excel-meta').textContent, /已导入 1/);
  await mode(ui, 'paste'); assert.equal(ui.get('bc-paste-numbers').value, '+16665550101');
  assert.match(ui.get('bc-paste-meta').textContent, /已核验 1/);
  await mode(ui, 'group-members'); await review(ui); await ui.click('broadcast-send');
  const payload = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(payload.recipientIds, ['a-ben']);
  assert.equal(Object.hasOwn(payload, 'sources'), false);
  assert.equal(Object.hasOwn(payload, 'groupIds'), false);
  assert.equal(ui.backend.jobs[0].targets[0].name, 'Ben');
});

test('labels use IDs even with duplicate names, allow group targets and share explicit exclusions', async (t) => {
  const ui = await setup((name) => name === 'audience' ? resolved(['a-ann', 'a-ben', 'a-team']) : undefined);
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await choose(ui, 'bc-exclude-contacts-select', ['a-ann']);
  await mode(ui, 'exclude-groups'); await choose(ui, 'bc-exclude-groups-select', ['a-other-team']);
  await mode(ui, 'label'); await choose(ui, 'bc-label-select', ['label-two']);
  assert.equal(ui.calls.some(([name]) => name === 'audience'), false);
  await ui.click('broadcast-read-label');
  assert.deepEqual(ui.calls.find(([name]) => name === 'audience')[1].source, { kind: 'label', labelId: 'label-two' });
  assert.match(ui.get('bc-label-meta').textContent, /已读取 3 个对象/);
  await ui.input('broadcast-message', 'Message'); await review(ui);
  assert.match(ui.get('broadcast-review-card').textContent, /2 个对象，已排除 1 个/);
  await ui.click('broadcast-send');
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), ['a-ben', 'a-team']);
});

test('source capability absence and an empty label list remain distinct and explicitly unavailable', async (t) => {
  const disabled = await fixture(); t.after(() => disabled.controller.dispose()); await disabled.open();
  assert.equal(radio(disabled, 'group-members').disabled, true);
  assert.equal(radio(disabled, 'label').disabled, true);
  assert.match(radio(disabled, 'label').title, /尚不可用/);
  const empty = await setup(undefined, { accountCatalogs: { a: sourceCatalog('a', { labels: [] }) } });
  t.after(() => empty.controller.dispose()); await empty.open(); await mode(empty, 'label');
  assert.equal(radio(empty, 'label').disabled, false);
  assert.match(empty.get('bc-label-meta').textContent, /暂无平台标签/);
  assert.equal(empty.get('broadcast-read-label').disabled, true);
  assert.equal(empty.calls.some(([name]) => name === 'audience'), false);
});

test('changing groups A to B to A invalidates a pending read, while one shared gate prevents duplicate work', async (t) => {
  const held = deferred(); let hold = false;
  const ui = await setup((name) => name === 'audience' ? hold ? held.promise : resolved() : undefined);
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', ['a-team']);
  await ui.click('broadcast-read-group-members'); await ui.input('broadcast-message', 'Preserved'); hold = true;
  ui.get('broadcast-read-group-members').fire('click'); ui.get('broadcast-read-group-members').fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'audience').length, 2);
  assert.equal(ui.get('broadcast-import-csv').disabled, true);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('bc-group-members-select').disabled, false);
  for (const values of [['a-other-team'], ['a-team']]) {
    for (const option of ui.get('bc-group-members-select').options) option.selected = values.includes(option.value);
    ui.get('bc-group-members-select').fire('change');
  }
  held.resolve(resolved()); await ui.controller.idle();
  await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /先读取/);
  hold = false; await ui.click('broadcast-read-group-members'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.backend.jobs[0].total, 1);
});

test('changing a label invalidates its result while group and label drafts remain independent', async (t) => {
  const ui = await setup((name, args) => name === 'audience'
    ? resolved(args.source.kind === 'groups' ? ['a-ann'] : ['a-ben', 'a-team']) : undefined);
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', ['a-team']);
  await ui.click('broadcast-read-group-members'); await mode(ui, 'label'); await choose(ui, 'bc-label-select', ['label-one']);
  await ui.click('broadcast-read-label'); await choose(ui, 'bc-label-select', ['label-two']);
  await ui.input('broadcast-message', 'Message'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  await mode(ui, 'group-members'); assert.match(ui.get('bc-groups-meta').textContent, /已读取 1/);
  await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), ['a-ann']);
});

test('invalid group results, stale source catalogs and native failures preserve an unchanged prior read', async (t) => {
  let result = resolved(); let error = null;
  const ui = await setup((name) => {
    if (name !== 'audience') return;
    if (error) throw error;
    return result;
  });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', ['a-team']);
  await ui.click('broadcast-read-group-members');
  for (const invalid of [resolved(['a-team']), { ...resolved(), accountId: 'b' }, resolved([]),
    resolved(['a-ben'], { catalog: sourceCatalog('a', { chats: catalog().chats.filter((chat) => chat.kind === 'contact') }) })]) {
    result = invalid; await ui.click('broadcast-read-group-members');
    assert.equal(ui.get('bc-groups-meta').dataset.state, 'error');
  }
  error = 'BROADCAST_IMPORT_LIMIT'; await ui.click('broadcast-read-group-members');
  assert.match(ui.get('bc-groups-meta').textContent, /20.*2000/);
  await ui.input('broadcast-message', 'Retry'); ui.failures.add('create'); await review(ui); await ui.click('broadcast-send');
  const first = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(first.recipientIds, ['a-ben']);
  ui.failures.clear(); await ui.click('broadcast-send');
  assert.equal(ui.calls.filter(([name]) => name === 'create').at(-1)[1].id, first.id);
});

for (const change of ['close', 'account-roundtrip', 'catalog']) {
  test(`a late label read cannot overwrite the draft after ${change}`, async (t) => {
    const pending = deferred(); let reload = false;
    const ui = await setup((name, accountId) => {
      if (name === 'audience') return pending.promise;
      if (name === 'catalog' && reload) return sourceCatalog(accountId, { catalogId: `${accountId}-new` });
    }, change === 'catalog' ? { accountCatalogs: { a: sourceCatalog('a', { chats: [] }) } } : {});
    t.after(() => ui.controller.dispose());
    await ui.open(); await mode(ui, 'label'); await choose(ui, 'bc-label-select', ['label-one']);
    await ui.input('broadcast-message', 'Draft A'); ui.get('broadcast-read-label').fire('click'); await flush();
    if (change === 'close') { ui.get('broadcast-cancel').fire('click'); await flush(); }
    if (change === 'account-roundtrip') { ui.switchAccount('b'); ui.switchAccount('a'); }
    if (change === 'catalog') {
      reload = true; assert.equal(ui.get('broadcast-reload-chats').classList.contains('hidden'), false);
      ui.get('broadcast-reload-chats').fire('click'); await flush();
    }
    pending.resolve(resolved()); await ui.controller.idle(); if (change === 'close') await ui.open();
    assert.equal(ui.get('bc-label-select').value, 'label-one');
    assert.equal(ui.get('broadcast-message').value, 'Draft A');
    await review(ui); await ui.click('broadcast-send');
    assert.equal(ui.calls.some(([name]) => name === 'create'), false);
    assert.match(ui.get('broadcast-workbench-status').textContent, /先读取/);
  });
}

test('a removed group source blocks its retained recipients until the user explicitly selects and reads another group', async (t) => {
  let removed = false;
  const ui = await setup((name) => name === 'audience' ? resolved()
    : name === 'catalog' && removed ? sourceCatalog('a', { catalogId: 'a-new', chats: sourceCatalog().chats.filter((chat) => chat.id !== 'a-team') }) : undefined);
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', ['a-team']);
  await ui.click('broadcast-read-group-members'); await ui.input('broadcast-message', 'Message'); await ui.click('broadcast-cancel');
  removed = true; await ui.open();
  assert.match(ui.get('bc-group-members-select').textContent, /a-team（已失效）/);
  await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /来源已失效/);
  await choose(ui, 'bc-group-members-select', ['a-other-team']); await ui.click('broadcast-read-group-members');
  await review(ui); await ui.click('broadcast-send'); assert.equal(ui.backend.jobs[0].total, 1);
});

test('selecting more than twenty groups is rejected locally without truncating the selection', async (t) => {
  const groups = Array.from({ length: 21 }, (_, i) => ({ id: `group-${i}`, name: `Group ${i}`, kind: 'group' }));
  const ui = await setup(undefined, { accountCatalogs: { a: sourceCatalog('a', { chats: groups }) } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'group-members'); await choose(ui, 'bc-group-members-select', groups.map((group) => group.id));
  await ui.click('broadcast-read-group-members');
  assert.equal(ui.calls.some(([name]) => name === 'audience'), false);
  assert.match(ui.get('bc-groups-meta').textContent, /20/);
  assert.equal([...ui.get('bc-group-members-select').options].filter((option) => option.selected).length, 21);
});
