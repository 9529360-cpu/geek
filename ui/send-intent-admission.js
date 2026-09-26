(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSendIntentAdmission = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function admissionError(code, field = '') {
    const error = new Error(String(code || 'SEND_INTENT_ADMISSION_FAILED'));
    error.code = String(code || 'SEND_INTENT_ADMISSION_FAILED');
    if (field) error.field = String(field);
    return error;
  }

  function create(options = {}) {
    const trustedSubmitRuntime = options.trustedSubmitRuntime;
    const coordinator = options.coordinator;
    const familyOf = options.familyOf;

    if (!trustedSubmitRuntime || typeof trustedSubmitRuntime.takeLatest !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'trustedSubmitRuntime');
    }
    if (!coordinator || typeof coordinator.begin !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'coordinator');
    }
    if (typeof familyOf !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'familyOf');
    }

    function begin(input = {}) {
      const account = input.account;
      const webview = input.webview;
      if (!account || typeof account !== 'object') {
        throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'account');
      }
      if (!webview || typeof webview.getWebContentsId !== 'function') {
        throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'webview');
      }

      const permit = trustedSubmitRuntime.takeLatest(account, webview, input.expectedKind);
      const platform = String(familyOf(account.type)?.key || '').trim();
      if (!platform) throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'platform');

      return coordinator.begin({
        accountId: String(account.id || ''),
        partition: String(account.partition || ''),
        platform,
        webviewId: String(webview.getWebContentsId()),
        webviewGeneration: permit.webviewGeneration,
        conversationId: input.conversationId,
        composerGeneration: permit.composerGeneration,
        submitPermitId: permit.permitId,
        sourceSnapshot: input.sourceSnapshot,
        transformPolicy: input.transformPolicy,
        deadlineAt: input.deadlineAt,
      });
    }

    return Object.freeze({ begin });
  }

  return Object.freeze({ create });
});
