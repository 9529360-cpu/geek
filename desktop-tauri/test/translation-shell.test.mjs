import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { mountShell } from '../frontend/controller.mjs';
import { DEFAULT_POLICY } from '../frontend/models/translation.mjs';
import { dom } from './helpers/dom.mjs';
import { deferred, signedIn, signedOut, turn } from './helpers/translation.mjs';

async function fixture() {
  const ui = dom();
  const calls = [];
  const controls = { login: null, update: null, hideFailure: false };
  let session = signedOut();
  const state = { activeId: 'a', openedIds: ['a', 'b'], settings: { closeToTray: false }, trayAvailable: true,
    platforms: [{ id: 'whatsapp', family: 'whatsapp', name: 'WhatsApp', enabled: true }],
    accounts: ['a', 'b'].map((id) => ({ id, name: `Account ${id}`, platformId: 'whatsapp', archived: false,
      translation: { revision: 1, global: { ...DEFAULT_POLICY }, chats: {} } })) };
  const api = connectDesktop(async (command, args) => {
    calls.push([command, command === 'session_login' ? { redacted: true } : structuredClone(args)]);
    if (command === 'desktop_snapshot') return structuredClone(state);
    if (command === 'desktop_layout') { if (controls.hideFailure && !args.viewport.visible) throw 'WEBVIEW_FAILED'; return null; }
    if (command === 'desktop_window') return null;
    if (command === 'broadcast_snapshot') return { revision: 0, jobs: [] };
    if (command === 'session_snapshot' || command === 'session_refresh') return structuredClone(session);
    if (command === 'session_login') { await controls.login?.promise; session = signedIn(); return session; }
    if (command === 'session_logout') { session = { ...signedOut(), revision: 3 }; return session; }
    if (command === 'account_activate') { state.activeId = args.id; return structuredClone(state); }
    if (command === 'translation_context') return { accountId: args.accountId, generation: 1,
      available: true, chat: { id: args.accountId === 'a' ? '111@c.us' : '222@c.us', name: `Chat ${args.accountId}` } };
    if (command === 'account_update_translation') {
      const account = state.accounts.find((item) => item.id === args.id);
      assert.equal(args.expectedRevision, account.translation.revision);
      account.translation.global = structuredClone(args.policy); account.translation.revision += 1;
      const response = structuredClone(state);
      if (args.id === 'a') await controls.update?.promise;
      return response;
    }
    throw new Error('Unexpected synthetic command');
  });
  const shell = mountShell({ ...ui, api }); await shell.idle();
  return { ...ui, shell, state, calls, controls,
    click: async (id) => { ui.get(id).fire('click'); await shell.idle(); } };
}

test('actual shell keeps native window controls available during login and restores guest after closing', async () => {
  const ui = await fixture();
  await ui.click('btn-settings'); await ui.click('settings-session-open');
  assert.equal(ui.calls.filter(([name]) => name === 'desktop_layout').at(-1)[1].viewport.visible, false);
  ui.controls.login = deferred();
  ui.get('session-in-email').value = 'synthetic@example.invalid'; ui.get('session-in-pass').value = 'synthetic-password';
  ui.get('session-btn-login').fire('click'); await turn();
  for (const id of ['btn-win-min', 'btn-win-max', 'btn-win-close']) {
    assert.equal(ui.get(id).disabled, false); ui.get(id).fire('click');
  }
  await turn();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'desktop_window').map(([, args]) => args.action),
    ['minimize', 'toggleMaximize', 'close']);
  ui.get('session-btn-close').fire('click'); await turn();
  assert.equal(ui.get('session-overlay').classList.contains('hidden'), true);
  assert.equal(ui.calls.filter(([name]) => name === 'desktop_layout').at(-1)[1].viewport.visible, true);
  ui.controls.login.resolve(); await ui.shell.idle();
  assert.equal(ui.get('session-overlay').classList.contains('hidden'), true);
  ui.shell.dispose();
});

test('actual shell merges only saved translation settings from a response captured before B activation', async () => {
  const ui = await fixture(); await ui.click('btn-translation');
  ui.controls.update = deferred();
  ui.get('translation-message-to').value = 'it'; ui.get('translation-message-to').fire('change'); await turn();
  ui.get('translation-close').fire('click'); await turn();
  ui.get('nav-accounts').children.find((node) => node.dataset.id === 'b').fire('click');
  for (let index = 0; index < 5; index += 1) await turn();
  assert.equal(ui.state.activeId, 'b');
  ui.get('btn-translation').fire('click'); await turn();
  ui.get('translation-message-to').value = 'fr'; ui.get('translation-message-to').fire('change'); await turn();
  ui.controls.update.resolve(); await ui.shell.idle();
  assert.equal(ui.get('nav-accounts').children.find((node) => node.classList.contains('active')).dataset.id, 'b');
  assert.equal(ui.get('translation-message-to').value, 'fr');
  assert.match(ui.get('translation-chat-hint').textContent, /Chat b/);
  assert.equal(ui.state.accounts[0].translation.global.messageTarget, 'it');
  assert.equal(ui.state.accounts[1].translation.global.messageTarget, 'fr');
  ui.shell.dispose();
});

test('failed native guest hiding never exposes translation or account dialogs', async () => {
  const ui = await fixture(); ui.controls.hideFailure = true;
  await ui.click('btn-translation');
  assert.equal(ui.get('translation-popover').classList.contains('hidden'), true);
  assert.ok(ui.get('runtime-status-message').textContent);
  ui.controls.hideFailure = false; await ui.click('btn-settings'); ui.controls.hideFailure = true;
  await ui.click('settings-session-open');
  assert.equal(ui.get('session-overlay').classList.contains('hidden'), true);
  assert.equal(ui.get('settings-overlay').classList.contains('hidden'), false);
  assert.equal(ui.state.activeId, 'a');
  ui.shell.dispose();
});
