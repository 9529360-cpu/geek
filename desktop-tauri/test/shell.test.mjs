import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';

test('original sidebar and menu keep edits bound to B while A stays active; save failures retain draft', async () => {
  const { get, state, failures, calls, context, click } = await fixture();
  await context('b', 1);
  get('account-settings-name').value = 'B renamed';
  failures.add('account_update_display');
  await click('account-settings-save');
  assert.equal(state.activeId, 'a');
  assert.equal(state.accounts[1].name, 'b');
  assert.equal(get('account-settings-name').value, 'B renamed');
  assert.equal(get('account-settings-overlay').classList.contains('hidden'), false);
  failures.clear();
  await click('account-settings-save');
  assert.equal(state.accounts[1].name, 'B renamed');
  assert.equal(state.activeId, 'a');
  assert.equal(get('account-settings-overlay').classList.contains('hidden'), true);
  assert.deepEqual(calls.filter(([n]) => n === 'account_update_display').at(-1)[1], {
    id: 'b', name: 'B renamed', fontSize: 16, fontColor: '#18A058',
  });
});

test('archive and searchable restore use the original account-settings entry without reconnecting', async () => {
  const { get, state, calls, context, click, shell } = await fixture();
  await context('b', 1);
  await click('archive');
  assert.equal(state.accounts[1].archived, true);
  assert.equal(state.activeId, 'a');
  await click('btn-settings');
  await click('open-library');
  get('search').value = 'b';
  get('archived-only').checked = true;
  get('search').fire('input');
  assert.equal(get('library-accounts').children.length, 1);
  get('library-accounts').children[0].children[1].fire('click');
  await shell.idle();
  assert.equal(state.accounts[1].archived, false);
  assert.equal(state.openedIds.includes('b'), false);
  assert.equal(calls.some(([n]) => n === 'account_activate'), false);
});

test('proxy dialog captures its owner, preserves failure draft, and never reconnects after save', async () => {
  const { get, state, failures, calls, context, click } = await fixture();
  await context('b', 2);
  get('proxy-openProxy').checked = true;
  get('proxy-openProxy').fire('change');
  get('proxy-protocal').value = 'http';
  get('proxy-host').value = '127.0.0.1';
  get('proxy-port').value = '8080';
  failures.add('account_set_proxy');
  await click('proxy-save');
  assert.equal(state.accounts[1].proxy.mode, 'system');
  assert.equal(get('proxy-host').value, '127.0.0.1');
  assert.equal(get('proxy-overlay').classList.contains('hidden'), false);
  failures.clear();
  await click('proxy-save');
  assert.equal(state.activeId, 'a');
  assert.equal(state.accounts[1].proxy.mode, 'http');
  assert.equal(state.openedIds.includes('b'), false);
  assert.equal(calls.some(([n]) => n === 'account_activate'), false);
  assert.equal(get('proxy-user').disabled, true);
  assert.equal(get('proxy-pwd').disabled, true);
});

test('original application center binds proxy before first open and retains a saved account on open failure', async () => {
  const { get, state, failures, calls, click, shell } = await fixture();
  await click('btn-app-center');
  get('add-platforms').children.find((e) => e.dataset.type === 'whatsapp').fire('click');
  get('add-name').value = 'New account';
  get('create-proxy-mode').value = 'socks5';
  get('create-proxy-mode').fire('change');
  get('create-proxy-host').value = '127.0.0.1';
  get('create-proxy-port').value = '1080';
  failures.add('account_activate');
  await click('add-confirm');
  await shell.idle();
  assert.equal(state.accounts.at(-1).name, 'New account');
  assert.equal(state.accounts.at(-1).proxy.mode, 'socks5');
  const commands = calls.map(([n]) => n);
  assert.ok(commands.indexOf('account_create_batch') < commands.indexOf('account_activate'));
  assert.equal(commands.filter((n) => n === 'account_create_batch').length, 1);
});

test('overlay is shown only after native hide succeeds; collapsed layout uses measured bounds', async () => {
  const { get, failures, calls, click } = await fixture();
  failures.add('hide');
  await click('btn-app-center');
  assert.equal(get('add-overlay').classList.contains('hidden'), true);
  assert.equal(get('runtime-status').parentElement.id, 'side-nav');
  failures.clear();
  await click('btn-collapse');
  assert.equal(get('side-nav').classList.contains('collapsed'), true);
  assert.equal(calls.filter(([n]) => n === 'desktop_layout').at(-1)[1].viewport.x, 64);
  await click('btn-app-center');
  assert.equal(calls.filter(([n]) => n === 'desktop_layout').at(-1)[1].viewport.visible, false);
  await click('add-cancel');
  assert.equal(calls.filter(([n]) => n === 'desktop_layout').at(-1)[1].viewport.visible, true);
});

test('pending features stay in place and disabled; window controls use their narrow command', async () => {
  const { get, state, calls, click } = await fixture();
  for (const id of ['btn-lock', 'btn-restart', 'btn-translation', 'btn-contact-notes']) {
    assert.equal(get(id).disabled, true, id);
  }
  assert.equal(get('btn-broadcast').disabled, false);
  await click('btn-win-min');
  assert.deepEqual(calls.at(-1), ['desktop_window', { action: 'minimize' }]);
  assert.equal(state.activeId, 'a');
  await click('btn-settings');
  get('close-to-tray').checked = true;
  await click('settings-save');
  assert.equal(state.settings.closeToTray, true);
});
