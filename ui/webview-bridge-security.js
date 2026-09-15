(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekWebviewBridgeSecurity = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const REQUEST_ID = /^[a-z0-9_-]{8,80}$/i;
  const TOKEN = /^[a-f0-9]{32,128}$/i;
  const TRANSLATION_ERROR_PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';
  const TRANSLATION_CAPACITY_ERROR = TRANSLATION_ERROR_PREFIX + JSON.stringify({
    code: 'BRIDGE_BUSY',
    category: 'capacity',
    status: 429,
    retryable: true,
    message: '翻译请求繁忙，请稍后重试',
  });

  function settleRateLimitedTranslation(expectedToken, requestId) {
    const document = root?.document;
    if (!document || typeof document.querySelectorAll !== 'function') return;
    const webviews = Array.from(document.querySelectorAll('webview') || []);
    if (!webviews.length) return;
    const token = String(expectedToken || '');
    const id = String(requestId || '');
    const source = `(() => {
      try {
        if (String(window.__geekTranslationBridgeToken || '') !== ${JSON.stringify(token)}) return false;
        if (!window.__geekTranslationPending?.has?.(${JSON.stringify(id)})) return false;
        return window.__geekResolveTranslation?.(${JSON.stringify(id)}, null, ${JSON.stringify(TRANSLATION_CAPACITY_ERROR)}) === true;
      } catch (_) { return false; }
    })()`;
    Promise.resolve().then(async () => {
      for (const webview of webviews) {
        if (typeof webview?.executeJavaScript !== 'function') continue;
        try {
          if (await webview.executeJavaScript(source)) break;
        } catch (_) {}
      }
    }).catch(() => {});
  }

  function authorize({ expectedToken, suppliedToken, requestId, inflight = 0, limit = 8 }) {
    if (!TOKEN.test(String(expectedToken || '')) || String(expectedToken) !== String(suppliedToken || '')) {
      return { ok: false, reason: 'TOKEN_MISMATCH' };
    }
    if (!REQUEST_ID.test(String(requestId || ''))) return { ok: false, reason: 'INVALID_REQUEST_ID' };
    if (!Number.isFinite(inflight) || inflight >= limit) {
      settleRateLimitedTranslation(expectedToken, requestId);
      return { ok: false, reason: 'RATE_LIMIT' };
    }
    return { ok: true, reason: '' };
  }

  return Object.freeze({ authorize });
});
