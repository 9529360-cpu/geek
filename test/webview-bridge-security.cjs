const assert = require('node:assert/strict');
const vm = require('node:vm');
const security = require('../ui/webview-bridge-security.js');

const token = '0123456789abcdef0123456789abcdef';
assert.deepEqual(security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'abc_def-1234', inflight: 0, limit: 8 }), { ok: true, reason: '' });
assert.equal(security.authorize({ expectedToken: token, suppliedToken: 'bad', requestId: 'abc_def-1234', inflight: 0, limit: 8 }).reason, 'TOKEN_MISMATCH');
assert.equal(security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'x', inflight: 0, limit: 8 }).reason, 'INVALID_REQUEST_ID');

(async () => {
  const originalDocument = global.document;
  try {
    const requestId = 'req_00000020';
    const pending = new Map();
    let settleRejected;
    const rejected = new Promise(resolve => { settleRejected = resolve; });
    pending.set(requestId, {
      resolve() { throw new Error('rate-limited translation must not resolve successfully'); },
      reject(error) { settleRejected(error); },
    });
    const guestWindow = {
      __geekTranslationBridgeToken: token,
      __geekTranslationPending: pending,
      __geekResolveTranslation(id, result, error) {
        const entry = this.__geekTranslationPending.get(id);
        if (!entry) return false;
        this.__geekTranslationPending.delete(id);
        if (error) entry.reject(new Error(error)); else entry.resolve(result);
        return true;
      },
    };
    let executions = 0;
    let foreignExecutions = 0;
    const foreignWindow = {
      __geekTranslationBridgeToken: 'fedcba9876543210fedcba9876543210',
      __geekTranslationPending: new Map([[requestId, { reject() { throw new Error('foreign WebView must not receive the rejection'); } }]]),
      __geekResolveTranslation() { throw new Error('foreign WebView must not be settled'); },
    };
    const foreignWebview = {
      async executeJavaScript(source) {
        foreignExecutions += 1;
        return vm.runInNewContext(source, { window: foreignWindow });
      },
    };
    const webview = {
      async executeJavaScript(source) {
        executions += 1;
        return vm.runInNewContext(source, { window: guestWindow });
      },
    };
    global.document = { querySelectorAll: selector => selector === 'webview' ? [foreignWebview, webview] : [] };

    for (let inflight = 0; inflight < 20; inflight += 1) {
      const id = `req_${String(inflight).padStart(8, '0')}`;
      assert.deepEqual(
        security.authorize({ expectedToken: token, suppliedToken: token, requestId: id, inflight, limit: 20 }),
        { ok: true, reason: '' },
      );
    }

    assert.equal(
      security.authorize({ expectedToken: token, suppliedToken: token, requestId, inflight: 20, limit: 20 }).reason,
      'RATE_LIMIT',
    );
    const busyError = await Promise.race([
      rejected,
      new Promise((_, reject) => setTimeout(() => reject(new Error('rate-limited translation remained pending')), 100)),
    ]);
    assert.equal(pending.has(requestId), false, 'rate-limited request must leave the pending map immediately');
    const prefix = '__GEEK_TRANSLATION_ERROR_V1__:';
    assert.ok(busyError instanceof Error);
    assert.ok(busyError.message.startsWith(prefix), 'capacity rejection must use the typed translation error envelope');
    const detail = JSON.parse(busyError.message.slice(prefix.length));
    assert.deepEqual(
      { code: detail.code, category: detail.category, status: detail.status, retryable: detail.retryable },
      { code: 'BRIDGE_BUSY', category: 'capacity', status: 429, retryable: true },
    );
    assert.ok(foreignExecutions >= 1, 'capacity settlement may inspect non-owning WebViews');
    assert.ok(executions >= 1, 'capacity rejection must settle through the owning WebView');
    assert.equal(foreignWindow.__geekTranslationPending.has(requestId), true, 'token binding must prevent cross-WebView settlement');

    const beforeInvalid = { owner: executions, foreign: foreignExecutions };
    assert.equal(
      security.authorize({ expectedToken: token, suppliedToken: 'bad', requestId: 'req_invalid_token', inflight: 20, limit: 20 }).reason,
      'TOKEN_MISMATCH',
    );
    assert.equal(
      security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'x', inflight: 20, limit: 20 }).reason,
      'INVALID_REQUEST_ID',
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(executions, beforeInvalid.owner, 'invalid token/request id must not scan the owning WebView');
    assert.equal(foreignExecutions, beforeInvalid.foreign, 'invalid token/request id must not scan any foreign WebView');

    console.log('WEBVIEW_BRIDGE_SECURITY_OK');
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
