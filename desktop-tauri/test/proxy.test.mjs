import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxyFromFields } from '../frontend/models/proxy.mjs';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { mountShell } from '../frontend/controller.mjs';
import { dom, settled } from './helpers/dom.mjs';

test('proxy fields are bounded and system mode omits stale custom input', () => {
  assert.deepEqual(proxyFromFields('system', 'stale', 'bad'), { mode: 'system' });
  assert.deepEqual(proxyFromFields('http', ' 127.0.0.1 ', '8080'), { mode: 'http', host: '127.0.0.1', port: 8080 });
  assert.deepEqual(proxyFromFields('socks5', '[::1]', '1080'), { mode: 'socks5', host: '[::1]', port: 1080 });
  for (const port of ['', '0', '-1', '65536', '80.5', '1e3', '80garbage']) {
    assert.throws(() => proxyFromFields('http', 'localhost', port), (code) => code === 'PROXY_INVALID');
  }
  for (const host of ['user:secret@host', 'http://host', 'host;direct://', 'host?x', 'host --no-sandbox']) {
    assert.throws(() => proxyFromFields('http', host, '80'), (code) => code === 'PROXY_INVALID');
  }
});

test('native host configures proxy before creating its guest and has no fallback branch', () => {
  const source = readFileSync(new URL('../src-tauri/src/desktop/host.rs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('account.proxy.endpoint()?') < source.indexOf('WebviewBuilder::new'));
  assert.ok(source.indexOf('builder.proxy_url(endpoint)') < source.indexOf('.add_child('));
  assert.equal([...source.matchAll(/\.add_child\(/g)].length, 1);
  assert.doesNotMatch(source, /additional_browser_args|set_proxy|--proxy/);
});

test('shell proxy edit captures managed owner, retains drafts on failure and does not reconnect', async () => {
  const { document, get } = dom();
  const calls = [];
  const state = {
    accounts: ['a', 'b'].map((id) => ({ id, name: id, platformId: 'whatsapp', archived: false, proxy: { mode: 'system' } })),
    platforms: [{ id: 'whatsapp', name: 'WhatsApp', enabled: true }],
    activeId: 'a', openedIds: ['a', 'b'], settings: { closeToTray: false }, trayAvailable: true,
  };
  let fail = true;
  const api = connectDesktop(async (command, args) => {
    calls.push([command, structuredClone(args)]);
    if (command === 'account_set_proxy') {
      state.openedIds = state.openedIds.filter((id) => id !== args.id);
      if (fail) throw 'STORE_IO';
      state.accounts.find((a) => a.id === args.id).proxy = args.proxy;
    }
    return structuredClone(state);
  });
  mountShell({ document, window: { addEventListener() {} }, api });
  await settled(get);
  get('accounts').children[1].children[1].fire('click');
  get('edit-name').value = 'unsaved name';
  get('edit-proxy-mode').value = 'http';
  get('edit-proxy-mode').fire('change');
  assert.equal(get('edit-proxy-host').disabled, false);
  get('edit-proxy-host').value = '127.0.0.1';
  get('edit-proxy-port').value = '8080';
  get('proxy-form').fire('submit');
  await settled(get);
  assert.deepEqual(state.accounts[1].proxy, { mode: 'system' });
  assert.equal(get('edit-proxy-port').value, '8080');
  assert.equal(get('edit-name').value, 'unsaved name');
  assert.equal(state.activeId, 'a');
  assert.match(get('status').textContent, /保存失败/);
  fail = false;
  get('proxy-form').fire('submit');
  await settled(get);
  assert.deepEqual(calls.filter(([name]) => name === 'account_set_proxy').at(-1),
    ['account_set_proxy', { id: 'b', proxy: { mode: 'http', host: '127.0.0.1', port: 8080 } }]);
  assert.equal(calls.some(([name]) => name === 'account_activate' || name === 'account_close'), false);
  assert.deepEqual(state.accounts[0].proxy, { mode: 'system' });
  assert.equal(get('edit-name').value, 'unsaved name');
  get('edit-proxy-mode').value = 'system';
  get('edit-proxy-mode').fire('change');
  get('proxy-form').fire('submit');
  await settled(get);
  assert.equal(get('edit-proxy-host').disabled, true);
  assert.deepEqual(state.accounts[1].proxy, { mode: 'system' });
});

test('creation sends selected proxy before any activation and retains saved account on open failure', async () => {
  const { document, get } = dom();
  const calls = [];
  const state = { accounts: [], platforms: [{ id: 'whatsapp', name: 'WhatsApp', enabled: true }],
    activeId: null, openedIds: [], settings: { closeToTray: false }, trayAvailable: false };
  const api = connectDesktop(async (command, args) => {
    calls.push([command, structuredClone(args)]);
    if (command === 'account_create') state.accounts.push({ id: 'new', name: args.name,
      platformId: args.platformId, archived: false, proxy: args.proxy });
    if (command === 'account_activate') throw 'WEBVIEW_FAILED';
    return structuredClone(state);
  });
  mountShell({ document, window: { addEventListener() {} }, api });
  await settled(get);
  get('name').value = 'New';
  get('create-proxy-mode').value = 'socks5';
  get('create-proxy-mode').fire('change');
  get('create-proxy-host').value = 'localhost';
  get('create-proxy-port').value = 'invalid';
  get('create-form').fire('submit');
  await settled(get);
  assert.equal(state.accounts.length, 0);
  assert.equal(calls.some(([name]) => name === 'account_create'), false);
  get('create-proxy-port').value = '1080';
  get('create-form').fire('submit');
  await settled(get);
  assert.deepEqual(state.accounts[0].proxy, { mode: 'socks5', host: 'localhost', port: 1080 });
  assert.ok(calls.findIndex(([name]) => name === 'account_create') < calls.findIndex(([name]) => name === 'account_activate'));
  assert.equal(get('accounts').children.length, 1);
  assert.equal(get('create-proxy-mode').value, 'system');
  assert.match(get('status').textContent, /WebView2/);
});
