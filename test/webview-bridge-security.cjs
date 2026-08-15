const assert = require('node:assert/strict');
const security = require('../ui/webview-bridge-security.js');
const token = '0123456789abcdef0123456789abcdef';
assert.deepEqual(security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'abc_def-1234', inflight: 0, limit: 8 }), { ok: true, reason: '' });
assert.equal(security.authorize({ expectedToken: token, suppliedToken: 'bad', requestId: 'abc_def-1234', inflight: 0, limit: 8 }).reason, 'TOKEN_MISMATCH');
assert.equal(security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'x', inflight: 0, limit: 8 }).reason, 'INVALID_REQUEST_ID');
assert.equal(security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'abc_def-1234', inflight: 8, limit: 8 }).reason, 'RATE_LIMIT');
console.log('WEBVIEW_BRIDGE_SECURITY_OK');
