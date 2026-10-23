import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';
import { dom } from './helpers/dom.mjs';
import { mountShell } from '../frontend/controller.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const actions = (calls) => calls.filter(([name]) => name === 'desktop_window').map(([, args]) => args.action);
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('window controls dispatch while the first account snapshot is still pending', async () => {
  const ui = dom();
  const gate = deferred();
  const calls = [];
  const shell = mountShell({ ...ui, api: {
    snapshot: () => { calls.push(['desktop_snapshot']); return gate.promise; },
    layout: async () => {},
    windowAction: async (action) => { calls.push(['desktop_window', { action }]); },
  } });
  try {
    await flush();
    assert.equal(ui.get('btn-app-center').disabled, true);
    for (const id of ['btn-win-min', 'btn-win-max', 'btn-win-close']) {
      assert.equal(ui.get(id).disabled, false, id);
      ui.get(id).fire('click');
    }
    await flush();
    assert.deepEqual(actions(calls), ['minimize', 'toggleMaximize', 'close']);
    assert.equal(calls.filter(([name]) => name === 'desktop_snapshot').length, 1);
  } finally {
    gate.resolve({ accounts: [], platforms: [], activeId: null, openedIds: [], settings: {}, trayAvailable: false });
    await shell.idle();
    shell.dispose();
  }
});

test('a pending account save keeps window controls independent', async () => {
  const gate = deferred();
  const ui = await fixture({ beforeInvoke: (name) => name === 'account_rename' ? gate.promise : undefined });
  await ui.context('b', 1);
  ui.get('account-settings-name').value = 'Saved once';
  ui.get('account-settings-save').fire('click');
  try {
    await flush();
    assert.equal(ui.get('account-settings-save').disabled, true);
    for (const id of ['btn-win-min', 'btn-win-max', 'btn-win-close']) {
      assert.equal(ui.get(id).disabled, false, id);
      ui.get(id).fire('click');
    }
    await flush();
    assert.deepEqual(actions(ui.calls), ['minimize', 'toggleMaximize', 'close']);
    assert.equal(ui.state.accounts[1].name, 'b');
    assert.equal(ui.get('account-settings-name').value, 'Saved once');
    assert.equal(ui.get('account-settings-overlay').classList.contains('hidden'), false);
    assert.equal(ui.state.activeId, 'a');
  } finally {
    gate.resolve();
    await ui.shell.idle();
  }
  assert.equal(ui.state.accounts[1].name, 'Saved once');
  assert.equal(ui.calls.filter(([name]) => name === 'account_rename').length, 1);
});

test('a pending maximize is coalesced without blocking close or account operations', async () => {
  const gate = deferred();
  const ui = await fixture({ beforeInvoke: (name, args) =>
    name === 'desktop_window' && args.action === 'toggleMaximize' ? gate.promise : undefined });
  try {
    ui.get('btn-win-max').fire('click');
    ui.get('btn-win-max').fire('click');
    await flush();
    assert.equal(ui.get('btn-win-max').disabled, true);
    assert.equal(ui.get('btn-win-close').disabled, false);
    assert.equal(ui.get('btn-app-center').disabled, false);
    ui.get('btn-win-close').fire('click');
    await ui.context('b', 1);
    ui.get('account-settings-name').value = 'Independent save';
    await ui.click('account-settings-save');
    assert.equal(ui.state.accounts[1].name, 'Independent save');
    assert.equal(ui.get('btn-win-max').disabled, true, 'account rendering must retain pending window state');
    assert.deepEqual(actions(ui.calls), ['toggleMaximize', 'close']);
  } finally {
    gate.resolve();
    await flush();
    await ui.shell.idle();
  }
  assert.equal(ui.get('btn-win-max').disabled, false);
});

test('window failures do not refresh or unlock a pending account mutation', async () => {
  const gate = deferred();
  const ui = await fixture({ beforeInvoke: (name) => {
    if (name === 'account_rename') return gate.promise;
    if (name === 'desktop_window') throw 'https://private.invalid/?token=never-echo';
  } });
  await ui.context('b', 1);
  ui.get('account-settings-name').value = 'Draft retained';
  const before = ui.calls.filter(([name]) => name === 'desktop_snapshot').length;
  ui.get('account-settings-save').fire('click');
  try {
    await flush();
    ui.get('btn-win-min').fire('click');
    await flush();
    assert.deepEqual(actions(ui.calls), ['minimize']);
    assert.equal(ui.get('btn-win-min').disabled, false);
    assert.equal(ui.get('account-settings-save').disabled, true);
    assert.equal(ui.get('account-settings-name').value, 'Draft retained');
    assert.ok(ui.get('runtime-status-message').textContent);
    assert.doesNotMatch(ui.get('runtime-status-message').textContent, /private|token|never-echo/);
    assert.equal(ui.calls.filter(([name]) => name === 'desktop_snapshot').length, before);
    assert.equal(ui.calls.filter(([name]) => name === 'account_rename').length, 1);
  } finally {
    gate.resolve();
    await ui.shell.idle();
  }
});

test('titlebar controls do not accidentally initiate native dragging', async () => {
  const ui = await fixture();
  const bar = ui.document.querySelector('.top-bar');
  bar.fire('mousedown', { target: ui.get('btn-win-min') });
  bar.fire('mousedown', { button: 2 });
  await flush();
  assert.deepEqual(actions(ui.calls), []);
});


test('modal keyboard traversal includes window controls but no background account actions', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  const panel = ui.get('account-settings-overlay');
  const controls = [...panel.querySelectorAll('button, input, select')].filter((el) => !el.disabled && el.getClientRects().length);
  controls.at(-1).focus();
  ui.document.fire('keydown', { key: 'Tab' });
  assert.equal(ui.document.activeElement.id, 'btn-win-min');
  ui.document.fire('keydown', { key: 'Tab' });
  assert.equal(ui.document.activeElement.id, 'btn-win-max');
  ui.document.fire('keydown', { key: 'Tab' });
  assert.equal(ui.document.activeElement.id, 'btn-win-close');
  ui.document.fire('keydown', { key: 'Tab' });
  assert.equal(ui.document.activeElement, controls[0]);
  ui.document.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(ui.document.activeElement.id, 'btn-win-close');
  ui.get('btn-app-center').focus();
  ui.document.fire('keydown', { key: 'Tab' });
  assert.equal(ui.document.activeElement, controls[0]);
});

test('a pending modal save still allows keyboard access to close', async () => {
  const gate = deferred();
  const ui = await fixture({ beforeInvoke: (name) => name === 'account_rename' ? gate.promise : undefined });
  await ui.context('b', 1);
  ui.get('account-settings-save').focus();
  ui.get('account-settings-save').fire('click');
  try {
    await flush();
    ui.document.fire('keydown', { key: 'Tab' });
    assert.equal(ui.document.activeElement.id, 'btn-win-min');
    ui.document.fire('keydown', { key: 'Tab', shiftKey: true });
    assert.equal(ui.document.activeElement.id, 'btn-win-close');
    ui.get('btn-win-close').fire('click');
    await flush();
    assert.deepEqual(actions(ui.calls), ['close']);
    assert.equal(ui.get('account-settings-save').disabled, true);
  } finally {
    gate.resolve();
    await ui.shell.idle();
  }
});

test('window controls do not dismiss an account context menu or resume its hidden guest', async () => {
  const ui = await fixture();
  ui.get('nav-accounts').children[1].fire('contextmenu', { clientX: 100, clientY: 100 });
  await ui.shell.idle();
  const before = ui.calls.filter(([name]) => name === 'desktop_layout').length;
  await ui.click('btn-win-min');
  ui.document.fire('click', { target: ui.get('btn-win-min') });
  await ui.shell.idle();
  assert.equal(ui.get('ctx-menu').classList.contains('hidden'), false);
  assert.equal(ui.calls.filter(([name]) => name === 'desktop_layout').length, before);
  assert.equal(ui.state.activeId, 'a');
});

test('a pending account activation does not block titlebar drag', async () => {
  const gate = deferred();
  const ui = await fixture({ beforeInvoke: (name) => name === 'account_activate' ? gate.promise : undefined });
  ui.get('nav-accounts').children[1].fire('click');
  try {
    await flush();
    assert.ok(ui.calls.some(([name]) => name === 'account_activate'));
    ui.document.querySelector('.top-bar').fire('mousedown');
    await flush();
    assert.deepEqual(actions(ui.calls), ['drag']);
    assert.equal(ui.state.activeId, 'a');
  } finally {
    gate.resolve();
    await ui.shell.idle();
  }
  assert.equal(ui.state.activeId, 'b');
  assert.equal(ui.calls.filter(([name]) => name === 'account_activate').length, 1);
});
