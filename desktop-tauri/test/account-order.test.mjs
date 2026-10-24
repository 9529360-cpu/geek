import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';

const type = 'application/x-geek-account-order';
const row = (ui, id) => ui.get('nav-accounts').children.find((item) => item.dataset.id === id);
const order = (ui) => ui.get('nav-accounts').children.map((item) => item.dataset.id);
const moves = (ui) => ui.calls.filter(([name]) => name === 'account_move');
const account = (id, platformId = 'whatsapp') => ({ id, name: id, platformId, archived: false, proxy: { mode: 'system' } });
function transfer(initial = []) {
  const data = new Map(initial);
  return {
    get types() { return [...data.keys()]; },
    getData: (key) => data.get(key) || '',
    setData: (key, value) => data.set(key, value),
  };
}
function drop(ui, from, to, data = transfer()) {
  const source = row(ui, from);
  source.fire('dragstart', { dataTransfer: data });
  row(ui, to).fire('dragover', { dataTransfer: data });
  row(ui, to).fire('drop', { dataTransfer: data });
  source.fire('dragend');
  return data;
}

test('dragging within a family persists target identity without changing selection or native guests', async () => {
  const ui = await fixture({ initialState: { accounts: [account('a'), account('b'), account('c')], openedIds: ['a', 'b', 'c'] } });
  drop(ui, 'a', 'c');
  await ui.shell.idle();
  assert.deepEqual(order(ui), ['b', 'c', 'a']);
  assert.deepEqual(moves(ui), [['account_move', { id: 'a', targetId: 'c' }]]);
  assert.equal(ui.state.activeId, 'a');
  assert.deepEqual(ui.state.openedIds, ['a', 'b', 'c']);
  assert.equal(ui.calls.some(([name]) => ['account_activate', 'account_close', 'account_reload'].includes(name)), false);
  row(ui, 'c').fire('click', { detail: 1 });
  await ui.shell.idle();
  assert.equal(ui.state.activeId, 'a', 'drop-associated click must not activate its target');
  drop(ui, 'a', 'b');
  await ui.shell.idle();
  assert.deepEqual(order(ui), ['a', 'b', 'c']);
  assert.deepEqual(moves(ui).at(-1), ['account_move', { id: 'a', targetId: 'b' }]);
  row(ui, 'c').fire('pointerdown');
  row(ui, 'c').fire('click', { detail: 1 });
  await ui.shell.idle();
  assert.equal(ui.state.activeId, 'c', 'a new deliberate click still activates');
});

test('pending sort has no optimistic reorder; failed save keeps order and cannot replay on recovery', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const ui = await fixture({ beforeInvoke: (name) => name === 'account_move' ? pending : undefined });
  ui.failures.add('account_move');
  drop(ui, 'a', 'b');
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order(ui), ['a', 'b']);
    assert.equal(row(ui, 'a').disabled, true);
    assert.equal(ui.get('btn-win-close').disabled, false);
    row(ui, 'a').fire('dragstart', { dataTransfer: transfer() });
    row(ui, 'b').fire('drop', { dataTransfer: transfer([[type, 'a']]) });
    assert.equal(moves(ui).length, 1);
  } finally {
    release();
    await ui.shell.idle();
  }
  assert.deepEqual(order(ui), ['a', 'b']);
  assert.equal(ui.state.activeId, 'a');
  assert.match(ui.get('runtime-status-message').textContent, /读写失败/);
  ui.failures.clear();
  await ui.click('runtime-retry');
  assert.deepEqual(order(ui), ['a', 'b']);
  assert.equal(moves(ui).length, 1);
  assert.ok(ui.get('nav-accounts').children.every((item) => !item.classList.contains('dragging') && !item.classList.contains('drop-target')));
});

test('external text, forged MIME, self-drop and altered payload cannot dispatch a sort', async () => {
  const ui = await fixture();
  for (const data of [transfer([['text/plain', 'a']]), transfer([[type, 'a']])]) {
    row(ui, 'b').fire('dragover', { dataTransfer: data });
    assert.equal(data.dropEffect, 'none');
    row(ui, 'b').fire('drop', { dataTransfer: data });
  }
  drop(ui, 'a', 'a');
  const changed = transfer();
  row(ui, 'a').fire('dragstart', { dataTransfer: changed });
  changed.setData(type, 'outside');
  row(ui, 'b').fire('drop', { dataTransfer: changed });
  row(ui, 'a').fire('dragend');
  await ui.shell.idle();
  assert.deepEqual(moves(ui), []);
  assert.deepEqual(order(ui), ['a', 'b']);
});

test('same-family platform variants sort but a refreshed family invalidates the old drag', async () => {
  const ui = await fixture({ initialState: {
    accounts: [account('z', 'telegram-z'), account('k', 'telegram-k'), account('a')],
    activeId: 'z', openedIds: ['z'],
  } });
  drop(ui, 'z', 'k');
  await ui.shell.idle();
  assert.deepEqual(order(ui), ['k', 'z']);
  const oldSource = row(ui, 'z');
  const data = transfer();
  oldSource.fire('dragstart', { dataTransfer: data });
  ui.state.activeId = 'a';
  await ui.click('runtime-retry');
  assert.deepEqual(order(ui), ['a']);
  row(ui, 'a').fire('drop', { dataTransfer: data });
  oldSource.fire('dragend');
  await ui.shell.idle();
  assert.equal(moves(ui).length, 1);
  assert.deepEqual(ui.state.accounts.map((item) => item.id), ['k', 'z', 'a']);
});

test('an open modal prevents background sort; cancellation leaves later keyboard activation usable', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  drop(ui, 'a', 'b');
  await ui.shell.idle();
  assert.equal(moves(ui).length, 0);
  await ui.click('account-settings-cancel');
  row(ui, 'b').fire('click', { detail: 0 });
  await ui.shell.idle();
  assert.equal(ui.state.activeId, 'b');
});
