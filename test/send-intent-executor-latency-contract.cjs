'use strict';

const assert = require('node:assert/strict');

const coordinatorApi = require('../ui/send-intent-coordinator.js');
const executorApi = require('../ui/send-intent-executor.js');
const recorderApi = require('../ui/send-latency-recorder.js');

function harness(overrides = {}) {
  let seq = 0;
  let now = 1000;
  const coordinator = coordinatorApi.createCoordinator({
    now: () => now,
    idFactory: () => 'latency-intent-' + (++seq),
    maxRecords: 16,
  });
  let latestIntentId = '';
  const admission = {
    begin(input) {
      const created = coordinator.begin({
        accountId: 'account-A',
        partition: 'persist:account-A',
        platform: 'telegram',
        webviewId: '77',
        webviewGeneration: 4,
        conversationId: input.conversationId,
        composerGeneration: 9,
        submitPermitId: 'private-permit',
        sourceSnapshot: input.sourceSnapshot,
        transformPolicy: input.transformPolicy,
        deadlineAt: input.deadlineAt,
      });
      latestIntentId = created.intentId;
      return created;
    },
    release() { return true; },
  };
  const account = { id: 'account-A', partition: 'persist:account-A', type: 'telegram-k' };
  const webview = { getWebContentsId: () => 77 };
  const state = { sendResult: 'SENT', ...overrides.state };
  const adapter = {
    async setComposerText() { return 'OK'; },
    async sendText() {
      if (typeof overrides.onSend === 'function') overrides.onSend();
      if (overrides.sendThrows) throw overrides.sendThrows;
      return state.sendResult;
    },
  };
  const platformCapabilities = { forAccount: () => adapter };
  const commitGuard = {
    async assertBeforeMutation() { return true; },
    async rebindComposerGeneration({ intentId }) {
      return coordinator.rebindComposerGenerationOwned(intentId, {
        accountId: 'account-A',
        partition: 'persist:account-A',
        platform: 'telegram',
        webviewId: '77',
        webviewGeneration: 4,
        conversationId: 'chat-A',
        composerGeneration: 10,
      });
    },
    async beginCommit({ intentId }) {
      return coordinator.beginCommitOwned(intentId, {
        accountId: 'account-A',
        partition: 'persist:account-A',
        platform: 'telegram',
        webviewId: '77',
        webviewGeneration: 4,
        conversationId: 'chat-A',
        composerGeneration: 10,
      });
    },
  };
  const classifySendOutcome = value => value === 'SENT'
    ? { ok: true, code: '' }
    : { ok: false, code: 'SEND_INTENT_SEND_FAILED' };
  const executor = executorApi.create({
    admission,
    coordinator,
    commitGuard,
    platformCapabilities,
    classifySendOutcome,
    now: () => now,
    latencyRecorder: overrides.latencyRecorder,
    platformOf: overrides.platformOf,
  });
  return {
    executor, coordinator, account, webview,
    intentId: () => latestIntentId,
    setNow(value) { now = value; },
    now: () => now,
  };
}

function input(h, overrides = {}) {
  return {
    account: h.account,
    webview: h.webview,
    conversationId: 'chat-A',
    sourceSnapshot: 'private original',
    transformPolicy: { target: 'en' },
    deadlineAt: 100000,
    transform: async () => ({ text: 'translated text' }),
    ...overrides,
  };
}

(async () => {
  // Happy path: submit -> sent duration is measured on coordinator time.
  const recorder = recorderApi.createSendLatencyRecorder();
  const happy = harness({
    latencyRecorder: recorder,
    platformOf: () => 'telegram',
    onSend: () => happy.setNow(1350),
  });
  const result = await happy.executor.execute(input(happy));
  assert.equal(result.intent.state, 'sent');
  assert.equal(recorder.size(), 1);
  assert.deepEqual(recorder.records()[0], {
    platform: 'telegram',
    path: 'composer-submit',
    outcome: 'sent',
    durationMs: 350,
    at: recorder.records()[0].at,
  });
  assert.equal(recorder.summary()['telegram|composer-submit|sent'].count, 1);

  // Failed send: outcome 'failed' with the same timing semantics.
  const failedRecorder = recorderApi.createSendLatencyRecorder();
  const failed = harness({
    latencyRecorder: failedRecorder,
    platformOf: () => 'telegram',
    state: { sendResult: 'MAYBE' },
    onSend: () => failed.setNow(1800),
  });
  await assert.rejects(failed.executor.execute(input(failed)), error => error?.code === 'SEND_INTENT_SEND_FAILED');
  assert.equal(failedRecorder.size(), 1);
  assert.equal(failedRecorder.records()[0].outcome, 'failed');
  assert.equal(failedRecorder.records()[0].durationMs, 800);
  assert.equal(failedRecorder.records()[0].path, 'composer-submit');

  // Cancelled send: outcome 'cancelled', not hidden as failed.
  const cancelledRecorder = recorderApi.createSendLatencyRecorder();
  const cancelled = harness({
    latencyRecorder: cancelledRecorder,
    platformOf: () => 'telegram',
  });
  const run = cancelled.executor.execute(input(cancelled, {
    transform: ({ signal }) => new Promise(() => {
      cancelled.setNow(1200);
      cancelled.coordinator.cancelForWebview('77');
    }),
  }));
  await assert.rejects(run, error => error?.code === 'SEND_INTENT_WEBVIEW_RELOADED');
  assert.equal(cancelledRecorder.size(), 1);
  assert.equal(cancelledRecorder.records()[0].outcome, 'cancelled');
  assert.equal(cancelledRecorder.records()[0].durationMs, 200);

  // Default platformOf falls back to account type when no mapper is given.
  const defaultRecorder = recorderApi.createSendLatencyRecorder();
  const fallback = harness({ latencyRecorder: defaultRecorder });
  await fallback.executor.execute(input(fallback));
  assert.equal(defaultRecorder.records()[0].platform, 'telegram-k');

  // A throwing recorder never breaks the send.
  const throwingRecorder = { record() { throw new Error('recorder exploded'); } };
  const isolated = harness({ latencyRecorder: throwingRecorder, platformOf: () => 'telegram' });
  const isolatedResult = await isolated.executor.execute(input(isolated));
  assert.equal(isolatedResult.intent.state, 'sent');

  // No recorder at all: behaviour unchanged (backward compatible).
  const plain = harness();
  const plainResult = await plain.executor.execute(input(plain));
  assert.equal(plainResult.intent.state, 'sent');

  console.log('send-intent-executor-latency contract: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
