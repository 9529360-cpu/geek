import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serialQueue, errorMessage } from '../frontend/model.mjs';
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

test('shell uses text nodes rather than interpolated account HTML', () => {
  const source = read('../frontend/app.mjs');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(source, /title\.textContent = account\.name/);
});

test('native and CSS reserved chrome sizes agree', () => {
  const rust = read('../src-tauri/src/main.rs');
  const css = read('../frontend/style.css');
  for (const [key, size] of [['SIDEBAR', 280], ['HEADER', 88], ['FOOTER', 28]]) {
    assert.ok(rust.includes(`const ${key}: f64 = ${size}.0;`));
    assert.ok(css.includes(`--${key.toLowerCase()}: ${size}px`));
  }
});
