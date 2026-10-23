import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { serialQueue, errorMessage, filterAccounts } from '../frontend/model.mjs';
import { connectDesktop } from '../frontend/api/desktop.mjs';
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');


test('operations stay ordered and rejection does not poison the queue', async () => {
  const enqueue = serialQueue();
  const order = [];
  const first = enqueue(async () => { order.push('first'); throw new Error('synthetic'); });
  const second = enqueue(async () => { order.push('second'); return 2; });
  await assert.rejects(first, /synthetic/);
  assert.equal(await second, 2);
  assert.deepEqual(order, ['first', 'second']);
});

test('errors do not echo native messages, private URLs or prototype keys', () => {
  for (const input of ['https://private.invalid/?token=synthetic', '__proto__', 'constructor']) {
    assert.equal(errorMessage(input), '操作未完成，请检查开发版运行状态。');
  }
  assert.match(errorMessage('DPAPI_FAILED'), /明文/);
  assert.match(errorMessage('ACCOUNT_STILL_OPEN'), /未执行归档/);
});

test('filter separates archives and searches names/platforms without changing owner state', () => {
  const accounts = Object.freeze([
    Object.freeze({ id: 'a', name: 'Sales A', platformId: 'whatsapp', archived: false }),
    Object.freeze({ id: 'b', name: 'Sales B', platformId: 'telegram-k', archived: false }),
    Object.freeze({ id: 'c', name: 'Old', platformId: 'whatsapp', archived: true }),
  ]);
  const platforms = [{ id: 'whatsapp', name: 'WhatsApp' }, { id: 'telegram-k', name: 'Telegram K' }];
  assert.deepEqual(filterAccounts(accounts, platforms, ' WHATSAPP ').map((a) => a.id), ['a']);
  assert.deepEqual(filterAccounts(accounts, platforms, '', true).map((a) => a.id), ['c']);
  assert.deepEqual(filterAccounts(accounts, platforms, 'sales').map((a) => a.id), ['a', 'b']);
  assert.deepEqual(filterAccounts(accounts, platforms, '<script>'), []);
  assert.equal(accounts[0].id, 'a');
});

test('archive is one native-owned operation with a captured account ID', async () => {
  const calls = [];
  const api = connectDesktop(async (command, args) => {
    calls.push([command, args]);
    return 'snapshot';
  });
  assert.equal(await api.setArchived('immutable-owner', true), 'snapshot');
  assert.deepEqual(calls, [
    ['account_set_archived', { id: 'immutable-owner', archived: true }],
  ]);
  assert.equal(Object.hasOwn(api, 'invoke'), false);
  assert.equal(connectDesktop(null), null);
});

test('failed native mutation is not retried or reported as success', async () => {
  const calls = [];
  const api = connectDesktop(async (command) => {
    calls.push(command);
    throw new Error('disk failed');
  });
  await assert.rejects(api.setArchived('a', true), /disk failed/);
  assert.deepEqual(calls, ['account_set_archived']);
});

test('exported URLs come from the existing canonical catalog', () => {
  const { exportPlatforms } = require('../scripts/export-platforms.cjs');
  const { PLATFORM_CATALOG } = require('../../src/platform-catalog.cjs');
  for (const item of exportPlatforms()) {
    assert.equal(item.url, PLATFORM_CATALOG[item.id].url || null);
    assert.deepEqual(item.hostnames, PLATFORM_CATALOG[item.id].hostnames || []);
  }
});

test('only the local shell webview receives narrow permissions', () => {
  const capability = JSON.parse(read('../src-tauri/capabilities/shell.json'));
  const config = JSON.parse(read('../src-tauri/tauri.conf.json'));
  assert.deepEqual(capability.webviews, ['shell']);
  assert.equal(capability.windows, undefined);
  assert.equal(capability.remote, undefined);
  assert.equal(capability.local, true);
  assert.deepEqual(capability.permissions, ['shell-commands']);
  assert.deepEqual(config.app.security.capabilities, ['shell']);
  assert.equal(config.bundle.active, false);
  assert.match(config.app.security.csp, /frame-src 'none'/);
  assert.doesNotMatch(config.app.security.csp, /unsafe-eval/);
});

test('all commands share the same native sender gate and blocking executor', () => {
  const commands = read('../src-tauri/src/desktop/commands.rs');
  const security = read('../src-tauri/src/desktop/security.rs');
  assert.match(commands, /authorize\(&webview\)\?;/);
  assert.match(commands, /spawn_blocking/);
  for (const section of commands.split('#[tauri::command]').slice(1)) {
    if (section.includes('pub async fn desktop_window(')) {
      assert.match(section, /execute\(webview, move \|app\| super::window::apply\(&app, action\)\)/);
      assert.doesNotMatch(section, /State|SharedDesktop|\.lock\(/);
    } else assert.match(section, /\{\s*execute_workspace\(webview, state,/);
  }
  assert.match(commands, /execute\(webview, move \|_\| \{\s*let mut desktop = shared\.lock\(/);
  const window = read('../src-tauri/src/desktop/window.rs');
  assert.match(window, /get_window\("main"\)/);
  assert.match(window, /WindowAction::Close => window\.close\(\)/);
  assert.doesNotMatch(window, /SharedDesktop|\.lock\(|\.destroy\(|\.exit\(/);
  assert.match(security, /webview\.label\(\) != "shell"/);
  assert.match(security, /webview\.window\(\)\.label\(\) != "main"/);
  assert.match(security, /shell_url/);
});

test('shell keeps original identifiers without unsafe dynamic markup', () => {
  const { compose } = require('../scripts/prepare-frontend.cjs');
  const source = read('../frontend/view.mjs') + read('../frontend/controller.mjs');
  const html = compose().html;
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), id);
});

test('native geometry follows measured original content and shell zoom stays disabled', () => {
  const source = read('../frontend/controller.mjs') + read('../frontend/models/shell.mjs');
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /await syncLayout\(false\)/);
  assert.match(read('../src-tauri/src/desktop/layout.rs'), /viewport\.clipped/);
  assert.doesNotMatch(read('../src-tauri/src/desktop/layout.rs'), /SIDEBAR|HEADER|FOOTER/);
  assert.match(read('../src-tauri/src/bootstrap.rs'), /\.zoom_hotkeys_enabled\(false\)/);
  assert.match(read('../src-tauri/src/bootstrap.rs'), /\.decorations\(false\)/);
  assert.doesNotMatch(read('../src-tauri/src/desktop/tray.rs'), /state::<Mutex|\.lock\(/);
});

test('frontend entrypoints parse', () => {
  for (const file of ['../frontend/app.mjs', '../frontend/model.mjs', '../frontend/view.mjs',
    '../frontend/controller.mjs', '../frontend/api/desktop.mjs']) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
