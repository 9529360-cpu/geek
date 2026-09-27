'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const coordinatorApi = require('../ui/send-intent-coordinator.js');
const executorApi = require('../ui/send-intent-executor.js');
const source = fs.readFileSync(path.join(root, 'ui', 'send-intent-executor.js'), 'utf8');

function harness(overrides = {}) {
  let seq = 0;
  let now = 1000;
  const calls = [];
  const coordinator = coordinatorApi.createCoordinator({
    now: () => now,
    idFactory: () => 'executor-intent-' + (++seq),
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
      calls.push('admit');
      return created;
    },
    release(intentId) {
      state.releaseCalls += 1;
      calls.push('release');
      assert.equal(intentId, latestIntentId);
      return true;
    },
  };
  const account = { id: 'account-A', partition: 'persist:account-A', type: 'telegram-k' };
  const webview = { getWebContentsId: () => 77 };
  const state = {
    setResult: 'OK',
    sendResult: 'SENT',
    setCalls: 0,
    sendCalls: 0,
    rebindCalls: 0,
    commitCalls: 0,
    releaseCalls: 0,
    ...overrides.state,
  };
  const adapter = {
    async setComposerText(text) {
      state.setCalls += 1;
      state.setText = text;
      calls.push('set');
      if (overrides.setThrows) throw overrides.setThrows;
      return state.setResult;
    },
    async sendText(text, commit) {
      state.sendCalls += 1;
      state.sendArg = text;
      state.commit = commit;
      calls.push('send');
      if (overrides.sendThrows) throw overrides.sendThrows;
      return state.sendResult;
    },
  };
  const platformCapabilities = { forAccount: () => adapter };
  const commitGuard = {
    async assertBeforeMutation({ intentId, expectedConversationId, expectedComposerText }) {
      calls.push('pre-write-guard');
      if (overrides.preMutationThrows) throw overrides.preMutationThrows;
      assert.equal(expectedConversationId, 'chat-A');
      assert.equal(expectedComposerText, 'private original');
      assert.equal(coordinator.get(intentId).state, 'transforming');
      return true;
    },
    async rebindComposerGeneration({ intentId }) {
      state.rebindCalls += 1;
      calls.push('rebind');
      if (overrides.rebindThrows) throw overrides.rebindThrows;
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
    async beginCommit({ intentId, expectedComposerText }) {
      state.commitCalls += 1;
      calls.push('guard');
      if (overrides.commitThrows) throw overrides.commitThrows;
      assert.equal(expectedComposerText, state.rebindCalls > 0 ? 'translated text' : 'private original');
      return coordinator.beginCommitOwned(intentId, {
        accountId: 'account-A',
        partition: 'persist:account-A',
        platform: 'telegram',
        webviewId: '77',
        webviewGeneration: 4,
        conversationId: 'chat-A',
        composerGeneration: state.rebindCalls > 0 ? 10 : 9,
      });
    },
  };
  const classifySendOutcome = value => value === 'SENT'
    ? { ok: true, code: '' }
    : value === 'MAYBE'
      ? { ok: false, code: 'SEND_INTENT_OUTCOME_UNCERTAIN' }
      : { ok: false, code: 'SEND_INTENT_SEND_FAILED' };
  const executor = executorApi.create({
    admission,
    coordinator,
    commitGuard,
    platformCapabilities,
    classifySendOutcome,
    now: () => now,
  });

  return {
    executor, coordinator, account, webview, state, calls,
    intentId: () => latestIntentId,
    setNow(value) { now = value; },
  };
}

function input(h, overrides = {}) {
  return {
    account: h.account,
    webview: h.webview,
    conversationId: 'chat-A',
    sourceSnapshot: 'private original',
    transformPolicy: { target: 'en' },
    deadlineAt: 5000,
    transform: async ({ sourceSnapshot, signal, intentId }) => {
      h.calls.push('transform');
      assert.equal(sourceSnapshot, 'private original');
      assert.equal(signal.aborted, false);
      assert.equal(intentId, h.intentId());
      return { text: 'translated text', provider: 'test-provider' };
    },
    ...overrides,
  };
}

(async () => {
  let finishReloadTransform;
  let reloadSignal;
  const reload = harness();
  reload.setNow(Date.now());
  const reloadRun = reload.executor.execute(input(reload, {
    deadlineAt: Date.now() + 5000,
    transform: ({ signal }) => {
      reloadSignal = signal;
      return new Promise(resolve => { finishReloadTransform = resolve; });
    },
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reload.coordinator.cancelForWebview(String(reload.webview.getWebContentsId())), 1);
  await assert.rejects(reloadRun, error => error?.code === 'SEND_INTENT_WEBVIEW_RELOADED');
  assert.equal(reloadSignal.aborted, true);
  finishReloadTransform({ text: 'late reload result' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reload.state.setCalls, 0, 'reload-cancelled transform cannot write composer');
  assert.equal(reload.state.sendCalls, 0, 'reload-cancelled transform cannot commit');

  let finishLateTransform;
  let deadlineSignal;
  const timed = harness();
  timed.setNow(Date.now());
  const timedRun = timed.executor.execute(input(timed, {
    deadlineAt: Date.now() + 25,
    transform: ({ signal }) => {
      deadlineSignal = signal;
      return new Promise(resolve => { finishLateTransform = resolve; });
    },
  }));
  await assert.rejects(timedRun, error => error?.code === 'SEND_INTENT_DEADLINE_EXCEEDED');
  assert.equal(deadlineSignal.aborted, true);
  assert.equal(timed.coordinator.get(timed.intentId()).state, 'cancelled');
  finishLateTransform({ text: 'late result' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timed.state.setCalls, 0, 'late transform completion cannot write the composer');
  assert.equal(timed.state.sendCalls, 0, 'late transform completion cannot commit a send');

  const happy = harness();
  const result = await happy.executor.execute(input(happy));
  assert.equal(result.intent.state, 'sent');
  assert.equal(result.transformResult.text, 'translated text');
  assert.equal(result.sendOutcome, 'SENT');
  assert.deepEqual(happy.calls, ['admit', 'transform', 'pre-write-guard', 'set', 'rebind', 'guard', 'send', 'release']);
  assert.equal(happy.state.setCalls, 1);
  assert.equal(happy.state.sendCalls, 1);
  assert.equal(happy.state.setText, 'translated text');
  assert.equal(happy.state.sendArg, '');
  assert.deepEqual(happy.state.commit, { expectedConversationId: 'chat-A', expectedComposerText: 'translated text' });
  assert.equal(JSON.stringify(result.intent).includes('private original'), false);
  assert.equal(JSON.stringify(result.intent).includes('private-permit'), false);
  assert.equal(happy.state.releaseCalls, 1);

  const identity = harness();
  const identityResult = await identity.executor.execute(input(identity, {
    transform: async () => {
      identity.calls.push('transform');
      return { text: 'private original', mode: 'identity', rewriteComposer: false };
    },
  }));
  assert.equal(identityResult.intent.state, 'sent');
  assert.deepEqual(identity.calls, ['admit', 'transform', 'pre-write-guard', 'guard', 'send', 'release']);
  assert.equal(identity.state.setCalls, 0, 'identity send must preserve the native composer');
  assert.equal(identity.state.rebindCalls, 0, 'identity send must preserve composer generation');
  assert.deepEqual(identity.state.commit, { expectedConversationId: 'chat-A', expectedComposerText: 'private original' });

  const invalidIdentity = harness();
  await assert.rejects(
    () => invalidIdentity.executor.execute(input(invalidIdentity, {
      transform: async () => ({ text: 'changed without rewrite', rewriteComposer: false }),
    })),
    error => error?.code === 'SEND_INTENT_IDENTITY_MISMATCH',
  );
  assert.equal(invalidIdentity.state.setCalls, 0);
  assert.equal(invalidIdentity.state.sendCalls, 0);
  assert.equal(invalidIdentity.state.releaseCalls, 1);

  const transformFailure = harness();
  await assert.rejects(
    () => transformFailure.executor.execute(input(transformFailure, {
      transform: async () => { throw Object.assign(new Error('provider down'), { code: 'TRANSFORM_FAILED' }); },
    })),
    /provider down/,
  );
  assert.equal(transformFailure.coordinator.get(transformFailure.intentId()).state, 'failed');
  assert.equal(transformFailure.state.setCalls, 0);
  assert.equal(transformFailure.state.sendCalls, 0);
  assert.equal(transformFailure.state.releaseCalls, 1);

  const composerFailure = harness({ state: { setResult: 'EMPTY' } });
  await assert.rejects(
    () => composerFailure.executor.execute(input(composerFailure)),
    error => error?.code === 'SEND_INTENT_COMPOSER_WRITE_FAILED',
  );
  assert.equal(composerFailure.coordinator.get(composerFailure.intentId()).state, 'failed');
  assert.equal(composerFailure.state.sendCalls, 0);

  const staleAfterWrite = harness({
    rebindThrows: Object.assign(new Error('stale chat'), { code: 'SEND_INTENT_STALE_CONTEXT' }),
  });
  await assert.rejects(
    () => staleAfterWrite.executor.execute(input(staleAfterWrite)),
    error => error?.code === 'SEND_INTENT_STALE_CONTEXT',
  );
  assert.equal(staleAfterWrite.coordinator.get(staleAfterWrite.intentId()).state, 'failed');
  assert.equal(staleAfterWrite.state.sendCalls, 0);

  const guardFailure = harness({
    commitThrows: Object.assign(new Error('composer mismatch'), { code: 'SEND_INTENT_COMPOSER_MISMATCH' }),
  });
  await assert.rejects(
    () => guardFailure.executor.execute(input(guardFailure)),
    error => error?.code === 'SEND_INTENT_COMPOSER_MISMATCH',
  );
  assert.equal(guardFailure.coordinator.get(guardFailure.intentId()).state, 'failed');
  assert.equal(guardFailure.state.sendCalls, 0);

  const ambiguous = harness({ state: { sendResult: 'MAYBE' } });
  await assert.rejects(
    () => ambiguous.executor.execute(input(ambiguous)),
    error => error?.code === 'SEND_INTENT_OUTCOME_UNCERTAIN',
  );
  assert.equal(ambiguous.state.sendCalls, 1, 'ambiguous native commit must never be retried');
  assert.equal(ambiguous.coordinator.get(ambiguous.intentId()).state, 'failed');
  assert.equal(ambiguous.coordinator.get(ambiguous.intentId()).failureCode, 'SEND_INTENT_OUTCOME_UNCERTAIN');

  const thrownAfterCommit = harness({ sendThrows: new Error('renderer disappeared') });
  await assert.rejects(
    () => thrownAfterCommit.executor.execute(input(thrownAfterCommit)),
    error => error?.code === 'SEND_INTENT_OUTCOME_UNCERTAIN',
  );
  assert.equal(thrownAfterCommit.state.sendCalls, 1, 'exception after commit authorization must not trigger retry');
  assert.equal(thrownAfterCommit.coordinator.get(thrownAfterCommit.intentId()).state, 'failed');
  assert.equal(thrownAfterCommit.coordinator.get(thrownAfterCommit.intentId()).failureCode, 'SEND_INTENT_OUTCOME_UNCERTAIN');

  assert.doesNotMatch(source, /querySelector|executeJavaScript|ipcRenderer|sendToHost|\btelegram\b|\bwhatsapp\b|\bline\b/i, 'executor must remain platform/DOM/Electron neutral');
  assert.doesNotMatch(source, /Math\.random/, 'executor must not mint transaction identity');
  assert.match(source, /adapter\.sendText\('', \{/, 'native commit must have one explicit executor-owned send point');

  console.log('SEND_INTENT_EXECUTOR_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
