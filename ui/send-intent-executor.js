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
    const now = typeof options.now === 'function' ? options.now : () => Date.now();

    if (!admission
      || typeof admission.begin !== 'function'
      || typeof admission.release !== 'function') {
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
      || typeof commitGuard.beginCommit !== 'function'
      || typeof commitGuard.assertBeforeMutation !== 'function') {
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

        const remainingMs = deadlineAt - now();
        if (remainingMs <= 0) throw executorError('SEND_INTENT_DEADLINE_EXCEEDED');
        let deadlineTimer;
        const signal = coordinator.signal(intentId);
        let rejectCancellation;
        const cancellationOperation = new Promise((_, reject) => { rejectCancellation = reject; });
        const onAbort = () => rejectCancellation(signal.reason || executorError('SEND_INTENT_CANCELLED'));
        signal.addEventListener('abort', onAbort, { once: true });
        const transformOperation = Promise.resolve().then(() => input.transform({
          sourceSnapshot: input.sourceSnapshot,
          transformPolicy: input.transformPolicy || {},
          signal,
          intentId,
        }));
        const deadlineOperation = new Promise((_, reject) => {
          deadlineTimer = setTimeout(() => {
            const error = executorError('SEND_INTENT_DEADLINE_EXCEEDED');
            try { coordinator.cancel(intentId, error.code); } catch {}
            reject(error);
          }, remainingMs);
        });
        let transformResult;
        try {
          transformResult = await Promise.race([transformOperation, deadlineOperation, cancellationOperation]);
        } finally {
          clearTimeout(deadlineTimer);
          signal.removeEventListener('abort', onAbort);
        }
        const transformedText = requiredText(transformResult?.text, 'transformResult.text');
        const rewriteComposer = transformResult?.rewriteComposer !== false;
        if (!rewriteComposer && transformedText !== input.sourceSnapshot) {
          throw executorError('SEND_INTENT_IDENTITY_MISMATCH');
        }

        const adapter = platformCapabilities.forAccount(account, webview);
        if (!adapter
          || typeof adapter.setComposerText !== 'function'
          || typeof adapter.sendText !== 'function') {
          throw executorError('SEND_INTENT_EXECUTOR_INVALID', 'platformCapabilities');
        }

        await commitGuard.assertBeforeMutation({
          intentId,
          account,
          webview,
          expectedConversationId: conversationId,
          expectedComposerText: input.sourceSnapshot,
        });
        let commitText = input.sourceSnapshot;
        if (rewriteComposer) {
          const composerResult = await adapter.setComposerText(transformedText, { expectedConversationId: conversationId });
          if (composerResult !== 'OK') {
            const error = executorError('SEND_INTENT_COMPOSER_WRITE_FAILED');
            error.outcome = String(composerResult || '');
            throw error;
          }
          await commitGuard.rebindComposerGeneration({ intentId, account, webview });
          commitText = transformedText;
        }
        coordinator.markReady(intentId);
        phase = 'ready';

        await commitGuard.beginCommit({
          intentId,
          account,
          webview,
          expectedComposerText: commitText,
        });
        phase = 'committing';

        let sendOutcome;
        try {
          sendOutcome = await adapter.sendText('', {
            expectedConversationId: conversationId,
            expectedComposerText: commitText,
          });
        } catch (error) {
          throw executorError('SEND_INTENT_OUTCOME_UNCERTAIN');
        }

        const classified = classifySendOutcome(sendOutcome) || {};
        if (classified.ok !== true) {
          const code = failureCode(
            { code: classified.code },
            'SEND_INTENT_SEND_FAILED',
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
      } finally {
        try { admission.release(intentId); } catch {}
      }
    }

    return Object.freeze({ execute });
  }

  return Object.freeze({ create });
});
