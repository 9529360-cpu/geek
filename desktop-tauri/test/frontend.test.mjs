import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { serialQueue, errorMessage, filterAccounts, archiveAccount } from '../frontend/model.mjs';
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const commands = ['desktop_snapshot', 'account_create', 'account_activate', 'account_close',
  'account_reload', 'desktop_layout', 'account_rename', 'account_set_archived', 'desktop_settings'];

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

test('archive closes the exact captured owner before committing', async () => {
  const calls = [];
  const result = await archiveAccount(async (command, args) => {
    calls.push([command, args]);
    return 'snapshot';
  }, 'immutable-owner');
  assert.equal(result, 'snapshot');
  assert.deepEqual(calls, [
    ['account_close', { id: 'immutable-owner' }],
    ['account_set_archived', { id: 'immutable-owner', archived: true }],
  ]);
});

test('failed close prevents archive and failed persistence is not reported as success', async () => {
  const calls = [];
  await assert.rejects(archiveAccount(async (command) => {
    calls.push(command);
    throw new Error('close failed');
  }, 'a'), /close failed/);
  assert.deepEqual(calls, ['account_close']);
  await assert.rejects(archiveAccount(async (command) => {
    if (command === 'account_set_archived') throw new Error('disk failed');
  }, 'a'), /disk failed/);
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

test('every registered command has permission and native sender authorization', () => {
  const runtime = read('../src-tauri/src/runtime.rs');
  const build = read('../src-tauri/build.rs');
  const main = read('../src-tauri/src/main.rs');
  const permissions = read('../src-tauri/permissions/shell.toml');
  const actual = [...runtime.matchAll(/#\[tauri::command\]\s+pub async fn (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(actual.sort(), [...commands].sort());
  for (const command of commands) {
    assert.ok(build.includes(`"${command}"`));
    assert.ok(main.includes(`runtime::${command}`));
    assert.ok(permissions.includes(`"${command}"`));
  }
  for (const section of runtime.split('#[tauri::command]').slice(1)) {
    assert.match(section, /\{\s*authorize\(&webview\)\?;/);
  }
  assert.match(runtime, /if archived && app\.get_webview\(&label\(&id\)\)\.is_some\(\)/);
  assert.match(runtime, /d\.store\.openable_account\(&id\)\?/);
});

test('shell uses text nodes and all referenced elements exist once', () => {
  const source = read('../frontend/app.mjs');
  const html = read('../frontend/index.html');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(source, /title\.textContent = account\.name/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), id);
});

test('native and CSS chrome agree and the shell cannot zoom out of alignment', () => {
  const rust = read('../src-tauri/src/runtime.rs');
  const css = read('../frontend/style.css');
  for (const [key, size] of [['SIDEBAR', 280], ['HEADER', 88], ['FOOTER', 28]]) {
    assert.ok(rust.includes(`const ${key}: f64 = ${size}.0;`));
    assert.ok(css.includes(`--${key.toLowerCase()}: ${size}px`));
  }
  assert.match(read('../src-tauri/src/main.rs'), /\.zoom_hotkeys_enabled\(false\)/);
  assert.doesNotMatch(read('../src-tauri/src/tray.rs'), /state::<Mutex|\.lock\(/);
});

test('frontend entrypoints parse', () => {
  for (const file of ['../frontend/app.mjs', '../frontend/model.mjs']) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
