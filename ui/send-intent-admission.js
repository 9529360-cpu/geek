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

    if (!trustedSubmitRuntime
      || typeof trustedSubmitRuntime.takeLatest !== 'function'
      || typeof trustedSubmitRuntime.release !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'trustedSubmitRuntime');
    }
    if (!coordinator || typeof coordinator.begin !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'coordinator');
    }
    if (typeof familyOf !== 'function') {
      throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'familyOf');
    }

    const activeLeases = new Map();

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
      const lease = Object.freeze({
        generation: permit.webviewGeneration,
        permitId: permit.permitId,
      });
      try {
        const platform = String(familyOf(account.type)?.key || '').trim();
        if (!platform) throw admissionError('SEND_INTENT_ADMISSION_INVALID', 'platform');
        const created = coordinator.begin({
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
        activeLeases.set(created.intentId, { webview, lease });
        return created;
      } catch (error) {
        trustedSubmitRuntime.release(webview, lease);
        throw error;
      }
    }

    function release(intentId) {
      const key = String(intentId || '');
      const active = activeLeases.get(key);
      if (!active) return false;
      activeLeases.delete(key);
      return trustedSubmitRuntime.release(active.webview, active.lease);
    }

    return Object.freeze({ begin, release });
  }

  return Object.freeze({ create });
});
