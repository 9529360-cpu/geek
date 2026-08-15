(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekWebviewBridgeSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const REQUEST_ID = /^[a-z0-9_-]{8,80}$/i;
  const TOKEN = /^[a-f0-9]{32,128}$/i;

  function authorize({ expectedToken, suppliedToken, requestId, inflight = 0, limit = 8 }) {
    if (!TOKEN.test(String(expectedToken || '')) || String(expectedToken) !== String(suppliedToken || '')) {
      return { ok: false, reason: 'TOKEN_MISMATCH' };
    }
    if (!REQUEST_ID.test(String(requestId || ''))) return { ok: false, reason: 'INVALID_REQUEST_ID' };
    if (!Number.isFinite(inflight) || inflight >= limit) return { ok: false, reason: 'RATE_LIMIT' };
    return { ok: true, reason: '' };
  }

  return Object.freeze({ authorize });
});
