(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSendIntentCommitGuard = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function guardError(code, field = '') {
    const error = new Error(String(code || 'SEND_INTENT_COMMIT_GUARD_FAILED'));
    error.code = String(code || 'SEND_INTENT_COMMIT_GUARD_FAILED');
    if (field) error.field = String(field);
    return error;
  }

  function requiredText(value, field) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', field);
    return text;
  }

  function create(options = {}) {
    const coordinator = options.coordinator;
    const trustedSubmitRuntime = options.trustedSubmitRuntime;
    const platformCapabilities = options.platformCapabilities;
    const familyOf = options.familyOf;
    const normalizeComposerText = options.normalizeComposerText;

    if (!coordinator
      || typeof coordinator.beginCommitOwned !== 'function'
      || typeof coordinator.rebindComposerGenerationOwned !== 'function') {
      throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'coordinator');
    }
    if (!trustedSubmitRuntime
      || typeof trustedSubmitRuntime.generationFor !== 'function'
      || typeof trustedSubmitRuntime.composerGenerationFor !== 'function') {
      throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'trustedSubmitRuntime');
    }
    if (!platformCapabilities || typeof platformCapabilities.forAccount !== 'function') {
      throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'platformCapabilities');
    }
    if (typeof familyOf !== 'function') throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'familyOf');
    if (typeof normalizeComposerText !== 'function') {
      throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'normalizeComposerText');
    }

    function hostContext(account, webview, conversationId) {
      const platform = requiredText(familyOf(account.type)?.key, 'platform');
      return {
        accountId: requiredText(account.id, 'accountId'),
        partition: requiredText(account.partition, 'partition'),
        platform,
        webviewId: String(webview.getWebContentsId()),
        webviewGeneration: trustedSubmitRuntime.generationFor(webview),
        conversationId: requiredText(conversationId, 'conversationId'),
        composerGeneration: trustedSubmitRuntime.composerGenerationFor(webview),
      };
    }

    async function rebindComposerGeneration(input = {}) {
      const intentId = requiredText(input.intentId, 'intentId');
      const account = input.account;
      const webview = input.webview;
      if (!account || typeof account !== 'object') throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'account');
      if (!webview || typeof webview.getWebContentsId !== 'function') {
        throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'webview');
      }
      const adapter = platformCapabilities.forAccount(account, webview);
      if (!adapter || typeof adapter.getCurrentChat !== 'function') {
        throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'platformCapabilities');
      }
      const currentChat = await adapter.getCurrentChat();
      return coordinator.rebindComposerGenerationOwned(
        intentId,
        hostContext(account, webview, currentChat),
      );
    }

    async function beginCommit(input = {}) {
      const intentId = requiredText(input.intentId, 'intentId');
      const account = input.account;
      const webview = input.webview;
      if (!account || typeof account !== 'object') throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'account');
      if (!webview || typeof webview.getWebContentsId !== 'function') {
        throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'webview');
      }
      if (typeof input.expectedComposerText !== 'string') {
        throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'expectedComposerText');
      }

      const adapter = platformCapabilities.forAccount(account, webview);
      if (!adapter || typeof adapter.getCurrentChat !== 'function' || typeof adapter.getComposerText !== 'function') {
        throw guardError('SEND_INTENT_COMMIT_GUARD_INVALID', 'platformCapabilities');
      }

      const [currentChat, currentComposerText] = await Promise.all([
        adapter.getCurrentChat(),
        adapter.getComposerText(),
      ]);
      if (normalizeComposerText(currentComposerText) !== normalizeComposerText(input.expectedComposerText)) {
        throw guardError('SEND_INTENT_COMPOSER_MISMATCH', 'composerText');
      }

      return coordinator.beginCommitOwned(
        intentId,
        hostContext(account, webview, currentChat),
      );
    }

    return Object.freeze({ rebindComposerGeneration, beginCommit });
  }

  return Object.freeze({ create });
});
