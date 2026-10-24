import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, catalog } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const state = (accountId = 'a', overrides = {}) => ({ accountId, revision: 0, messages: [], audiences: [],
  excludedContactIds: [], excludedGroupIds: [], ...overrides });
const savedCalls = (ui) => ui.calls.filter(([name]) => name === 'saveExclusions').map(([, args]) => args);
const count = (ui) => ui.get('broadcast-overlay').querySelector('.bc-recipient-card').querySelector('small').textContent;
const selected = (ui, kind = 'contacts') => ui.get(`bc-exclude-${kind}-select`).options
  .filter((option) => option.selected).map((option) => option.value);
async function mode(ui, value) {
  const radio = ui.get('broadcast-overlay').querySelectorAll('input')
    .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
  radio.checked = true; await ui.fire(radio, 'change');
}
function change(ui, kind, ids) {
  const select = ui.get(`bc-exclude-${kind}-select`);
  for (const option of select.options) option.selected = ids.includes(option.value);
  select.fire('change');
}
async function exclude(ui, kind, ids) { change(ui, kind, ids); await ui.controller.idle(); }
async function startOpen(ui) {
  ui.get('btn-broadcast').fire('click'); await flush(); ui.get('bc-menu-send').fire('click'); await flush();
}
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }

test('typed exclusion changes persist in the existing account revision and survive a fresh shell', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'exclude-contacts'); await exclude(ui, 'contacts', ['a-ann']);
  await mode(ui, 'exclude-groups'); await exclude(ui, 'groups', ['a-team']);
  assert.deepEqual(savedCalls(ui), [
    { accountId: 'a', expectedRevision: 0, excludedContactIds: ['a-ann'], excludedGroupIds: [] },
    { accountId: 'a', expectedRevision: 1, excludedContactIds: ['a-ann'], excludedGroupIds: ['a-team'] },
  ]);
  assert.match(ui.get('broadcast-exclusions-group-status').textContent, /已保存/);
  const reopened = await fixture({ presets: { a: ui.presets.read('a') } }); t.after(() => reopened.controller.dispose());
  await reopened.open(); await mode(reopened, 'all');
  assert.equal(count(reopened), '发送 1 个对象，已排除 2 个');
  assert.deepEqual(selected(reopened), ['a-ann']); assert.deepEqual(selected(reopened, 'groups'), ['a-team']);
  await reopened.input('broadcast-message', 'Persisted selection'); await review(reopened); await reopened.click('broadcast-send');
  assert.deepEqual(reopened.backend.jobs[0].targets.map((row) => row.id), ['a-ben']);
  assert.equal(savedCalls(reopened).length, 0);
});

test('pending exclusion persistence blocks submission but unrelated message edits remain intact', async (t) => {
  const held = deferred();
  const ui = await fixture({ presets: {}, before: (name) => name === 'saveExclusions' ? held.promise : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); await mode(ui, 'all');
  change(ui, 'contacts', ['a-ann']); await flush();
  assert.equal(ui.get('broadcast-send').disabled, true); assert.equal(ui.get('bc-exclude-contacts-select').disabled, true);
  ui.get('broadcast-message').value = 'While saving'; ui.get('broadcast-message').fire('input');
  ui.get('broadcast-send').fire('click'); assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  const committed = state('a', { revision: 1, excludedContactIds: ['a-ann'] });
  ui.presets.publish(committed); held.resolve(committed); await ui.controller.idle();
  assert.equal(ui.get('broadcast-send').disabled, false); assert.equal(ui.get('broadcast-message').value, 'While saving');
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  assert.equal(savedCalls(ui).length, 1);
});

test('failed saves keep local choices across close and reopen, and only explicit retry commits them', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'all'); ui.failures.add('saveExclusions');
  await exclude(ui, 'contacts', ['a-ann']);
  assert.deepEqual(ui.presets.read('a').excludedContactIds, []);
  assert.deepEqual(selected(ui), ['a-ann']); assert.equal(ui.get('broadcast-send').disabled, true);
  assert.match(ui.get('broadcast-exclusions-contact-status').textContent, /未保存/);
  await ui.click('broadcast-cancel'); await ui.open();
  assert.deepEqual(selected(ui), ['a-ann']); assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(savedCalls(ui).length, 1);
  ui.failures.clear(); await ui.click('broadcast-exclusions-contact-save');
  assert.deepEqual(ui.presets.read('a').excludedContactIds, ['a-ann']);
  assert.equal(ui.get('broadcast-send').disabled, false); assert.equal(savedCalls(ui).length, 2);
});

test('explicitly using saved exclusions discards failed local changes without writing them', async (t) => {
  const ui = await fixture({ presets: { a: state('a', { revision: 2, excludedContactIds: ['a-ann'] }) } });
  t.after(() => ui.controller.dispose()); await ui.open(); await mode(ui, 'all');
  ui.failures.add('saveExclusions'); await exclude(ui, 'contacts', ['a-ben']);
  assert.equal(ui.get('broadcast-exclusions-contact-reload').textContent, '使用已保存');
  await ui.click('broadcast-exclusions-contact-reload');
  assert.deepEqual(selected(ui), ['a-ann']); assert.equal(ui.presets.read('a').revision, 2);
  assert.equal(ui.get('broadcast-send').disabled, false); assert.equal(savedCalls(ui).length, 1);
});

test('a stale shared revision never overwrites a newer exclusion set and requires an explicit reload', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'all');
  ui.presets.publish(state('a', { revision: 1, excludedGroupIds: ['a-team'] }));
  await exclude(ui, 'contacts', ['a-ann']);
  assert.deepEqual(ui.presets.read('a').excludedContactIds, []);
  assert.deepEqual(ui.presets.read('a').excludedGroupIds, ['a-team']);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.match(ui.get('broadcast-exclusions-contact-status').textContent, /已变化/);
  await ui.click('broadcast-exclusions-contact-reload');
  assert.deepEqual(selected(ui), []); assert.deepEqual(selected(ui, 'groups'), ['a-team']);
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
  await exclude(ui, 'contacts', ['a-ann']);
  assert.equal(savedCalls(ui).at(-1).expectedRevision, 1);
  assert.deepEqual(ui.presets.read('a').excludedGroupIds, ['a-team']);
});

test('late account-A exclusion saves cannot replace account-B choices and are discovered on reopening A', async (t) => {
  const held = deferred();
  const ui = await fixture({ presets: { b: state('b', { revision: 1, excludedContactIds: ['b-ben'] }) },
    before: (name) => name === 'saveExclusions' ? held.promise : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); change(ui, 'contacts', ['a-ann']); await flush();
  ui.get('broadcast-close').fire('click'); await flush(); ui.switchAccount('b'); await startOpen(ui);
  assert.deepEqual(selected(ui), ['b-ben']);
  const committed = state('a', { revision: 1, excludedContactIds: ['a-ann'] });
  ui.presets.publish(committed); held.resolve(committed); await ui.controller.idle();
  assert.deepEqual(selected(ui), ['b-ben']); assert.equal(ui.get('broadcast-send').disabled, false);
  await ui.click('broadcast-close'); ui.switchAccount('a'); await ui.open();
  assert.deepEqual(selected(ui), ['a-ann']); assert.equal(ui.get('broadcast-send').disabled, false);
  assert.equal(savedCalls(ui).length, 1);
});

test('an incomplete native exclusion response cannot silently remove the saved deny lists', async (t) => {
  for (const broken of [{}, { excludedContactIds: null, excludedGroupIds: [] },
    { excludedContactIds: [], excludedGroupIds: ['group', 'group'] }]) await t.test(JSON.stringify(broken), async () => {
    const ui = await fixture({ presets: {}, before: (name) => name === 'presets'
      ? { accountId: 'a', revision: 1, messages: [], audiences: [], ...broken } : undefined });
    try {
      await ui.open(); assert.equal(ui.get('broadcast-send').disabled, true);
      assert.match(ui.get('broadcast-exclusions-contact-status').textContent, /未能读取/);
      assert.equal(savedCalls(ui).length, 0);
    } finally { ui.controller.dispose(); }
  });
});

test('saved exclusions absent from the current directory remain visible and survive a later save', async (t) => {
  const ui = await fixture({ presets: { a: state('a', { revision: 1, excludedContactIds: ['a-old'] }) },
    accountCatalogs: { a: catalog('a') } });
  t.after(() => ui.controller.dispose()); await ui.open(); await mode(ui, 'exclude-contacts');
  assert.deepEqual(selected(ui), ['a-old']);
  assert.match(ui.get('bc-exclude-contacts-select').options.find((row) => row.value === 'a-old').textContent, /当前不可用/);
  await exclude(ui, 'contacts', ['a-old', 'a-ann']);
  assert.deepEqual(ui.presets.read('a').excludedContactIds, ['a-ann', 'a-old']);
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个');
});

test('a failed refresh after a valid snapshot blocks edits and submission until a complete reread succeeds', async (t) => {
  let broken = false;
  const ui = await fixture({ presets: {}, before: (name) => name === 'presets' && broken
    ? state('a', { excludedContactIds: null }) : undefined });
  t.after(() => ui.controller.dispose()); await ui.open(); await mode(ui, 'all');
  assert.equal(ui.get('broadcast-send').disabled, false);
  broken = true;
  // This is the same refresh operation exposed on the durable preset controls.
  ui.get('broadcast-message-preset-refresh').fire('click'); await ui.controller.idle();
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('bc-exclude-contacts-select').disabled, true);
  assert.equal(ui.get('bc-exclude-groups-select').disabled, true);
  assert.match(ui.get('broadcast-exclusions-contact-status').textContent, /未能读取/);
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  broken = false; await ui.click('broadcast-exclusions-contact-reload');
  assert.equal(ui.get('broadcast-send').disabled, false);
  assert.equal(ui.get('bc-exclude-contacts-select').disabled, false);
});

test('an exclusion added after preview blocks the native create; refreshing never resubmits automatically', async (t) => {
  const ui = await fixture({ presets: {} }); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'all'); await ui.input('broadcast-message', 'Review again'); await review(ui);
  ui.presets.publish(state('a', { revision: 1, excludedContactIds: ['a-ann'] }));
  await ui.click('broadcast-send'); assert.equal(ui.backend.jobs.length, 0);
  assert.match(ui.get('broadcast-workbench-status').textContent, /排除名单已变化/);
  await ui.click('broadcast-message-preset-refresh');
  assert.equal(count(ui), '发送 2 个对象，已排除 1 个'); assert.equal(ui.backend.jobs.length, 0);
  await ui.click('broadcast-send');
  assert.deepEqual(ui.backend.jobs[0].targets.map((row) => row.id), ['a-ben', 'a-team']);
});
