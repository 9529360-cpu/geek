'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SUPPORTED_ACCOUNT_TYPES,
  validateAccountAddPayload,
  installAccountTypeBoundary,
} = require('../src/account-type-boundary.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const mainEntrySource = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const appTypesPattern = /const APP_TYPES = \{([\s\S]*?)\r?\n\};\r?\n\r?\nfunction appTypeConfig/;
const appTypesMatch = mainSource.match(appTypesPattern);
assert.ok(appTypesMatch, 'main.cjs APP_TYPES must remain discoverable as the formal platform source');
assert.ok(
  mainSource.replace(/\r?\n/g, '\r\n').match(appTypesPattern),
  'main.cjs APP_TYPES source contract must remain discoverable after a Windows CRLF checkout',
);
const formalTypes = [...appTypesMatch[1].matchAll(/^\s{2}(?:'([^']+)'|([a-z][a-z0-9-]*)):\s*\{/gm)]
  .map((match) => match[1] || match[2]);
assert.deepEqual(
  [...SUPPORTED_ACCOUNT_TYPES].sort(),
  formalTypes.sort(),
  'account type boundary must stay locked to the formal APP_TYPES platform set',
);
assert.match(mainSource, /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*registerIpcHandlers\(\)/, 'legacy IPC registration remains deferred until app ready');
assert.match(mainEntrySource, /installAccountTypeBoundary\(\{ ipcMain \}\);[\s\S]*sessionPartitionCompat\.ready[\s\S]*require\('\.\/main\.cjs'\)/, 'account type guard must be installed before loading deferred legacy main');
assert.doesNotMatch(mainEntrySource, /accountTypeBoundary\.restore\(\)/, 'main-entry must not restore the guard before deferred accounts:add registration occurs');

for (const type of SUPPORTED_ACCOUNT_TYPES) {
  const payload = type === 'website' ? { type, customUrl: 'https://example.com/app' } : { type };
  assert.doesNotThrow(() => validateAccountAddPayload(payload), `formal type ${type} must remain accepted`);
}
assert.doesNotThrow(() => validateAccountAddPayload({ name: 'legacy default' }), 'object payload without type keeps the historical WhatsApp default');
assert.doesNotThrow(() => validateAccountAddPayload('legacy string payload'), 'legacy string payload remains supported');
assert.doesNotThrow(() => validateAccountAddPayload(undefined), 'omitted payload remains compatible with the historical default');

function assertAccountTypeUnsupported(payload) {
  assert.throws(
    () => validateAccountAddPayload(payload),
    (error) => error?.code === 'ACCOUNT_TYPE_UNSUPPORTED' && error?.message === 'ACCOUNT_TYPE_UNSUPPORTED',
  );
}
assertAccountTypeUnsupported({ type: 'telegrm' });
assertAccountTypeUnsupported({ type: '' });
assertAccountTypeUnsupported({ type: null });
assertAccountTypeUnsupported({ type: ' whatsapp' });

for (const payload of [
  { type: 'website', customUrl: '' },
  { type: 'website', customUrl: 'http://example.com/' },
  { type: 'website', customUrl: 'https://user:pass@example.com/' },
]) {
  assert.throws(
    () => validateAccountAddPayload(payload),
    (error) => error?.code === 'ACCOUNT_WEBSITE_URL_INVALID' && error?.message === 'ACCOUNT_WEBSITE_URL_INVALID',
    'invalid Website URL must fail before downstream account creation',
  );
}

for (const payload of [null, [], 42, true]) {
  assert.throws(
    () => validateAccountAddPayload(payload),
    (error) => error?.code === 'ACCOUNT_PAYLOAD_INVALID' && error?.message === 'ACCOUNT_PAYLOAD_INVALID',
    'malformed payload must not fall through to WhatsApp creation',
  );
}

const handlers = new Map();
function nativeHandle(channel, handler) {
  handlers.set(channel, handler);
}
function delegatedRegistrationBoundary(channel, handler) {
  nativeHandle(channel, handler);
  if (channel === 'account-data:get-all') {
    this.handle = nativeHandle;
  }
}
const ipcMain = { handle: delegatedRegistrationBoundary };
let downstreamCalls = 0;
const boundary = installAccountTypeBoundary({ ipcMain });

// Simulate a current startup boundary finishing its expected registrations and
// restoring ipcMain.handle while account-type registration protection is active.
ipcMain.handle('account-data:get-all', () => 'account-data');
assert.notEqual(ipcMain.handle, nativeHandle, 'account type guard must survive a delegated boundary restoring handle()');

ipcMain.handle('accounts:add', (_event, payload) => {
  downstreamCalls += 1;
  return { accepted: payload?.type || 'whatsapp' };
});
assert.equal(ipcMain.handle, nativeHandle, 'guard must self-restore only after accounts:add has actually been wrapped');
ipcMain.handle('other:channel', () => 'ok');

assert.deepEqual(handlers.get('accounts:add')({}, { type: 'telegram-k' }), { accepted: 'telegram-k' });
assert.deepEqual(handlers.get('accounts:add')({}, { type: 'website', customUrl: 'https://example.com/app' }), { accepted: 'website' });
assert.deepEqual(handlers.get('accounts:add')({}, { name: 'legacy' }), { accepted: 'whatsapp' });
assert.equal(downstreamCalls, 3);
for (const payload of [
  { type: 'website', customUrl: 'javascript:alert(1)' },
  { type: 'telegrm' },
  { type: '' },
  null,
  [],
]) {
  assert.throws(() => handlers.get('accounts:add')({}, payload));
}
assert.equal(downstreamCalls, 3, 'rejected payloads must never reach the real accounts:add handler or its mutations');
assert.equal(handlers.get('other:channel')(), 'ok');

boundary.restore();
assert.equal(ipcMain.handle, nativeHandle, 'explicit restore remains idempotent after self-restoration');

console.log('ACCOUNT_TYPE_BOUNDARY_CONTRACT_OK');
