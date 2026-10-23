import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';
import { dom } from './helpers/dom.mjs';
import { mountShell } from '../frontend/controller.mjs';

const names = (ui) => ui.calls.map(([name]) => name);

test('initial snapshot failure leaves window controls and read-only recovery available', async () => {
  const ui = await fixture({ initialFailures: ['desktop_snapshot'] });
  assert.equal(ui.get('btn-app-center').disabled, true);
  assert.equal(ui.get('btn-settings').disabled, true);
  assert.match(ui.get('runtime-status-message').textContent, /\u8bfb\u5199\u5931\u8d25/);
  for (const id of ['btn-win-min', 'btn-win-max', 'btn-win-close', 'runtime-retry']) {
    assert.equal(ui.get(id).disabled, false, id);
  }
  await ui.click('btn-win-min');
  assert.ok(names(ui).includes('desktop_window'));
  assert.equal(ui.get('runtime-retry').hidden, false);
  assert.equal(ui.get('runtime-status').classList.contains('hidden'), false);
  ui.failures.clear();
  await ui.click('runtime-retry');
  assert.equal(ui.get('btn-app-center').disabled, false);
  assert.equal(ui.get('runtime-status').classList.contains('hidden'), true);
  assert.equal(ui.calls.filter(([name]) => name === 'desktop_layout').at(-1)[1].viewport.visible, true);
  assert.equal(ui.state.accounts.length, 2);
  assert.ok(names(ui).every((name) => ['desktop_snapshot', 'desktop_layout', 'desktop_window'].includes(name)));
});

test('retry cannot replay a failed save and keeps a modal suspended with its draft intact', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  ui.get('account-settings-name').value = 'Unsaved draft';
  ui.failures.add('account_rename');
  await ui.click('account-settings-save');
  assert.equal(ui.get('runtime-status').classList.contains('hidden'), false);
  assert.ok(ui.get('account-settings-overlay').contains(ui.get('runtime-retry')));
  ui.failures.clear();
  await ui.click('runtime-retry');
  assert.equal(names(ui).filter((name) => name === 'account_rename').length, 1);
  assert.equal(ui.state.accounts[1].name, 'b');
  assert.equal(ui.get('account-settings-name').value, 'Unsaved draft');
  assert.equal(ui.get('account-settings-overlay').classList.contains('hidden'), false);
  assert.equal(ui.calls.filter(([name]) => name === 'desktop_layout').at(-1)[1].viewport.visible, false);
  assert.equal(ui.state.activeId, 'a');
});

test('a failed recovery remains retryable without enabling account mutations or duplicate reads', async () => {
  const ui = await fixture({ initialFailures: ['desktop_snapshot'] });
  assert.equal(names(ui).filter((name) => name === 'desktop_snapshot').length, 1);
  await ui.click('runtime-retry');
  assert.equal(ui.get('btn-app-center').disabled, true);
  assert.equal(ui.get('runtime-retry').disabled, false);
  assert.equal(ui.get('runtime-status').classList.contains('hidden'), false);
  assert.ok(names(ui).every((name) => name === 'desktop_snapshot'));
  assert.equal(names(ui).filter((name) => name === 'desktop_snapshot').length, 2);
});

test('browser preview does not enable window commands or pretend to recover native state', async () => {
  const ui = dom();
  const shell = mountShell({ ...ui, api: null });
  await shell.idle();
  for (const id of ['btn-app-center', 'btn-settings', 'btn-win-close', 'runtime-retry']) {
    assert.equal(ui.get(id).disabled, true, id);
  }
  assert.equal(ui.get('runtime-retry').hidden, true);
});

test('startup chooses a populated family without activating accounts or opening guests', async () => {
  const ui = await fixture({ initialState: {
    accounts: [{ id: 't', name: 'Telegram owner', platformId: 'telegram-z', archived: false, proxy: { mode: 'system' } }],
    activeId: null, openedIds: [],
  } });
  assert.deepEqual(ui.get('nav-accounts').children.map((row) => row.dataset.id), ['t']);
  assert.equal(ui.get('account-tabs').children[0].classList.contains('active'), true);
  assert.equal(ui.state.activeId, null);
  assert.deepEqual(ui.state.openedIds, []);
  assert.equal(names(ui).includes('account_activate'), false);
});

test('archiving the last selected-family account reveals a populated neighbor without opening it', async () => {
  const ui = await fixture({ initialState: {
    accounts: [
      { id: 'a', name: 'WA owner', platformId: 'whatsapp', archived: false, proxy: { mode: 'system' } },
      { id: 't', name: 'TG owner', platformId: 'telegram-k', archived: false, proxy: { mode: 'system' } },
    ],
    openedIds: ['a'],
  } });
  await ui.context('a', 1);
  await ui.click('archive');
  assert.deepEqual(ui.get('nav-accounts').children.map((row) => row.dataset.id), ['t']);
  assert.equal(ui.get('account-tabs').children[0].classList.contains('active'), true);
  assert.equal(ui.state.activeId, null);
  assert.deepEqual(ui.state.openedIds, []);
  assert.equal(names(ui).includes('account_activate'), false);
});
