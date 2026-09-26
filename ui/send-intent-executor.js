(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSendIntentExecutor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function executorError(code, field = '') {
    const error = new Error(String(code || 'SEND_INTENT_EXECUTOR_FAILED'));
    error.code = String(code || 'SEND_INTENT_EXECUTOR_FAILED');
    if (field) error.field = String(field);
    return error;
  }

  function requiredText(value, field) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw executorError('SEND_INTENT_EXECUTOR_INVALID', field);
    return text;
  }

  function failureCode(error, fallback) {
    const raw = String(error?.code || '').trim();
    return /^[A-Z0-9_:-]{3,80}$/.test(raw) ? raw : fallback;
  }

  function create(options = {}) {
    const admission = options.admission;
    const coordinator = options.coordinator;
    const commitGuard = options.commitGuard;
    const platformCapabilities = options.platformCapabilities;
    const classifySendOutcome = options.classifySendOutcome;

    if (!admission || typeof admission.begin !== 'function') {
      throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'admission');
    }
    if (!coordinator
      || typeof coordinator.startTransform !== 'function'
      || typeof coordinator.markReady !== 'function'
      || typeof coordinator.markSent !== 'function'
      || typeof coordinator.fail !== 'function'
      || typeof coordinator.signal !== 'function') {
      throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'coordinator');
    }
    if (!commitGuard
      || typeof commitGuard.rebindComposerGeneration !== 'function'
      || typeof commitGuard.beginCommit !== 'function') {
      throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'commitGuard');
    }
    if (!platformCapabilities || typeof platformCapabilities.forAccount !== 'function') {
      throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'platformCapabilities');
    }
    if (typeof classifySendOutcome !== 'function') {
      throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'classifySendOutcome');
    }

    async function execute(input = {}) {
      const account = input.account;
      const webview = input.webview;
      if (!account || typeof account !== 'object') throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'account');
      if (!webview || typeof webview.getWebContentsId !== 'function') {
        throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'webview');
      }
      if (typeof input.transform !== 'function') throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'transform');
      if (typeof input.sourceSnapshot !== 'string') throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'sourceSnapshot');
      const conversationId = requiredText(input.conversationId, 'conversationId');
      const deadlineAt = Number(input.deadlineAt);
      if (!Number.isFinite(deadlineAt)) throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'deadlineAt');

      const created = admission.begin({
        account,
        webview,
        conversationId,
        sourceSnapshot: input.sourceSnapshot,
        transformPolicy: input.transformPolicy || {},
        expectedKind: input.expectedKind || '',
        deadlineAt,
      });
      const intentId = created.intentId;
      let phase = 'created';

      try {
        coordinator.startTransform(intentId);
        phase = 'transforming';

        const transformResult = await input.transform({
          sourceSnapshot: input.sourceSnapshot,
          transformPolicy: input.transformPolicy || {},
          signal: coordinator.signal(intentId),
          intentId,
        });
        const transformedText = requiredText(transformResult?.text, 'transformResult.text');

        const adapter = platformCapabilities.forAccount(account, webview);
        if (!adapter
          || typeof adapter.setComposerText !== 'function'
          || typeof adapter.sendText !== 'function') {
          throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'platformCapabilities');
        }

        const composerResult = await adapter.setComposerText(transformedText);
        if (composerResult !== 'OK') {
          const error = executorError('SEND_INTENT_COMPOSER_WRITE_FAILED');
          error.outcome = String(composerResult || '');
          throw error;
        }

        await commitGuard.rebindComposerGeneration({ intentId, account, webview });
        coordinator.markReady(intentId);
        phase = 'ready';

        await commitGuard.beginCommit({
          intentId,
          account,
          webview,
          expectedComposerText: transformedText,
        });
        phase = 'committing';

        let sendOutcome;
        try {
          sendOutcome = await adapter.sendText('');
        } catch (error) {
          throw executorError('SEND_INTENT_OUTCOME_UNCERTAIN');
        }

        const classified = classifySendOutcome(sendOutcome) || {};
        if (classified.ok !== true) {
          const code = requiredText(
            classified.code || 'SEND_INTENT_SEND_FAILED',
            'sendOutcome.code',
          );
          throw executorError(code);
        }

        const sent = coordinator.markSent(intentId);
        phase = 'sent';
        return Object.freeze({
          intent: sent,
          transformResult,
          sendOutcome,
        });
      } catch (error) {
        let current;
        try { current = coordinator.get(intentId); } catch {}
        if (current && !['sent', 'cancelled', 'failed'].includes(current.state)) {
          const code = phase === 'committing'
            ? failureCode(error, 'SEND_INTENT_OUTCOME_UNCERTAIN')
            : failureCode(error, phase === 'transforming'
              ? 'SEND_INTENT_TRANSFORM_FAILED'
              : 'SEND_INTENT_EXECUTION_FAILED');
          try { coordinator.fail(intentId, code); } catch {}
        }
        throw error;
      }
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({ create });
});
