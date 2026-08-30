'use strict';

const assert = require('node:assert/strict');
const {
  SUPPORTED_ACCOUNT_TYPES,
  validateAccountAddPayload,
  installAccountTypeBoundary,
} = require('../src/account-type-boundary.cjs');

for (const type of SUPPORTED_ACCOUNT_TYPES) {
  assert.doesNotThrow(() => validateAccountAddPayload({ type }));
}
assert.doesNotThrow(() => validateAccountAddPayload({ name: 'legacy default' }));
assert.doesNotThrow(() => validateAccountAddPayload('legacy string payload'));
assert.throws(() => validateAccountAddPayload({ type: 'website' }), (error) => error?.code === 'ACCOUNT_TYPE_UNSUPPORTED');
assert.throws(() => validateAccountAddPayload({ type: 'telegrm' }), (error) => error?.code === 'ACCOUNT_TYPE_UNSUPPORTED');
assert.throws(() => validateAccountAddPayload({ type: '' }), (error) => error?.code === 'ACCOUNT_TYPE_UNSUPPORTED');
assert.throws(() => validateAccountAddPayload([]), (error) => error?.code === 'ACCOUNT_PAYLOAD_INVALID');

const handlers = new Map();
const ipcMain = {
  handle(channel, handler) {
    handlers.set(channel, handler);
  },
};
const boundary = installAccountTypeBoundary({ ipcMain });
ipcMain.handle('accounts:add', (_event, payload) => ({ accepted: payload?.type || 'whatsapp' }));
ipcMain.handle('other:channel', () => 'ok');

assert.deepEqual(handlers.get('accounts:add')({}, { type: 'telegram-k' }), { accepted: 'telegram-k' });
assert.deepEqual(handlers.get('accounts:add')({}, { name: 'legacy' }), { accepted: 'whatsapp' });
assert.throws(
  () => handlers.get('accounts:add')({}, { type: 'website' }),
  (error) => error?.code === 'ACCOUNT_TYPE_UNSUPPORTED',
);
assert.equal(handlers.get('other:channel')(), 'ok');

boundary.restore();
assert.equal(typeof ipcMain.handle, 'function');

console.log('ACCOUNT_TYPE_BOUNDARY_CONTRACT_OK');
