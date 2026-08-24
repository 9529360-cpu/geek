(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSafety = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeChatId(value) {
    let text = String(value == null ? '' : value).trim();
    try { text = decodeURIComponent(text); } catch (_) {}
    text = text.replace(/^#/, '');
    const telegramParam = text.match(/(?:^|[?&])p=([^&]+)/);
    if (telegramParam) text = telegramParam[1];
    text = text.replace(/^\/im\/?/, '');
    return text.trim();
  }

  function sameChat(current, target) {
    const a = normalizeChatId(current);
    const b = normalizeChatId(target);
    return !!a && !!b && a === b;
  }

  function normalizeComposerText(value) {
    return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\n[\t ]*\n+/g, '\n').trim();
  }

  function authorizeSend({ opened, currentChatId, targetChatId, composerResult, needsComposer, expectedComposerText, actualComposerText }) {
    if (opened !== true) return { ok: false, reason: 'OPEN_FAILED' };
    if (!sameChat(currentChatId, targetChatId)) return { ok: false, reason: 'WRONG_CHAT' };
    if (needsComposer && composerResult !== 'OK') {
      return { ok: false, reason: `COMPOSER_FAILED:${String(composerResult || 'EMPTY')}` };
    }
    if (needsComposer && expectedComposerText !== undefined && normalizeComposerText(expectedComposerText) !== normalizeComposerText(actualComposerText)) {
      return { ok: false, reason: 'COMPOSER_MISMATCH' };
    }
    return { ok: true, reason: '' };
  }

  return Object.freeze({ normalizeChatId, normalizeComposerText, sameChat, authorizeSend });
});

// Broadcast task presentation is split from app.js so UX state can evolve without
// widening the platform transport/security surface. Browser-only; Node contracts
// importing this file keep seeing only GeekBroadcastSafety.
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.GeekBroadcastJobController) {
  const script = document.createElement('script');
  script.src = './broadcast-job-controller.js';
  script.defer = true;
  document.head.appendChild(script);
}
