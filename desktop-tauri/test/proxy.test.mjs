import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxyFromFields } from '../frontend/models/proxy.mjs';
import { connectDesktop } from '../frontend/api/desktop.mjs';

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
