'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolvePersistPartition,
  installSessionPartitionCompat,
} = require('../src/session-partition-compat.cjs');

assert.equal(
  resolvePersistPartition({ storagePath: '/tmp/geek/Partitions/webview-page-account_1' }),
  'persist:webview-page-account_1',
  'unix Electron Session.storagePath must recover the persistent account partition',
);
assert.equal(
  resolvePersistPartition({ storagePath: 'C:\\Users\\u\\AppData\\Roaming\\geek\\Partitions\\webview-page-account-2' }),
  'persist:webview-page-account-2',
  'windows Session.storagePath must recover the persistent account partition',
);
assert.equal(
  resolvePersistPartition({ getStoragePath: () => '/tmp/geek/Partitions/webview-page-fallback' }),
  'persist:webview-page-fallback',
  'documented getStoragePath fallback must be supported',
);
assert.equal(resolvePersistPartition({ storagePath: '/tmp/geek/Session Storage' }), '', 'default session must not masquerade as an account partition');
assert.equal(resolvePersistPartition({ storagePath: '/tmp/geek/Partitions/not-webview-page-a' }), '');
assert.equal(resolvePersistPartition({ storagePath: '/tmp/geek/Partitions/webview-page-a/child' }), '', 'only the exact partition leaf is trusted');
assert.equal(resolvePersistPartition({ storagePath: '/tmp/geek/Partitions/webview-page-a.evil' }), '', 'lookalike account leaves must fail closed');
assert.equal(resolvePersistPartition(null), '');

(async () => {
  const proto = {};
  const defaultSession = Object.create(proto);
  defaultSession.storagePath = '/tmp/geek/Session Storage';
  const app = { whenReady: () => Promise.resolve() };
  const compat = installSessionPartitionCompat({ app, sessionModule: { defaultSession } });
  assert.equal(await compat.ready, true);
  assert.equal(compat.isInstalled(), true);

  const accountSession = Object.create(proto);
  accountSession.storagePath = '/tmp/geek/Partitions/webview-page-A_7';
  assert.equal(accountSession.partition, 'persist:webview-page-A_7');
  assert.equal(Object.prototype.propertyIsEnumerable.call(proto, 'partition'), false, 'compat partition must be non-enumerable');

  const nativeProto = {};
  Object.defineProperty(nativeProto, 'partition', { get: () => 'persist:native', configurable: true });
  const nativeSession = Object.create(nativeProto);
  const nativeCompat = installSessionPartitionCompat({
    app,
    sessionModule: { defaultSession: nativeSession },
  });
  assert.equal(await nativeCompat.ready, false, 'future/native Electron partition property must never be overridden');
  assert.equal(nativeSession.partition, 'persist:native');

  const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
  const installIndex = entry.indexOf('installSessionPartitionCompat({ app, sessionModule: session })');
  const mainIndex = entry.indexOf("require('./main.cjs')");
  assert.ok(installIndex >= 0 && mainIndex > installIndex, 'compat must be installed before legacy main.cjs loads');
  assert.match(entry, /sessionPartitionCompat\.ready[\s\S]*\.then\(\(\) => require\('\.\/main\.cjs'\)\)/, 'main startup must await the partition compatibility boundary');
  assert.match(entry, /\.catch\([\s\S]*app\.quit\(\)/, 'partition compatibility failure must fail closed instead of starting with empty owner keys');

  console.log('SESSION_PARTITION_COMPAT_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
