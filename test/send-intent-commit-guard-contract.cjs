'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const coordinatorApi = require('../ui/send-intent-coordinator.js');
const guardApi = require('../ui/send-intent-commit-guard.js');
const source = fs.readFileSync(path.join(root, 'ui', 'send-intent-commit-guard.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

const normalize = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

function harness(overrides = {}) {
  let intentSeq = 0;
  const state = {
    webviewId: '77',
    webviewGeneration: 7,
    composerGeneration: 11,
    currentChat: 'chat-A',
    composerText: ' translated   text ',
    sendCalls: 0,
    ...overrides.state,
  };
  const account = {
    id: 'account-A',
    partition: 'persist:webview-page-account-A',
    type: 'telegram-k',
    ...overrides.account,
  };
  const webview = {
    getWebContentsId: () => state.webviewId,
  };
  const familyOf = type => ({
    key: type === 'telegram-k' || type === 'telegram-z' ? 'telegram' : type,
  });
  const coordinator = coordinatorApi.createCoordinator({
    now: () => 1000,
    idFactory: () => 'intent-' + (++intentSeq),
    maxRecords: 16,
  });
  const created = coordinator.begin({
    accountId: 'account-A',
    partition: 'persist:webview-page-account-A',
    platform: 'telegram',
    webviewId: '77',
    webviewGeneration: 7,
    conversationId: 'chat-A',
    composerGeneration: 11,
    submitPermitId: 'private-permit',
    sourceSnapshot: 'private source',
    transformPolicy: { enabled: true },
    deadlineAt: 5000,
    ...overrides.binding,
  });
  coordinator.startTransform(created.intentId);
  coordinator.markReady(created.intentId);

  const trustedSubmitRuntime = {
    generationFor: () => state.webviewGeneration,
    composerGenerationFor: () => state.composerGeneration,
  };
  const platformCapabilities = {
    forAccount(accountValue) {
      if (accountValue.type === 'website') throw new Error('unsupported platform');
      return {
        async getCurrentChat() { return state.currentChat; },
        async getComposerText() { return state.composerText; },
        async sendText() { state.sendCalls += 1; return 'SENT'; },
      };
    },
  };
  const guard = guardApi.create({
    coordinator,
    trustedSubmitRuntime,
    platformCapabilities,
    familyOf,
    normalizeComposerText: normalize,
  });
  return { state, account, webview, coordinator, guard, intentId: created.intentId };
}

async function expectReadyFailure(h, code, field) {
  await assert.rejects(
    () => h.guard.beginCommit({
      intentId: h.intentId,
      account: h.account,
      webview: h.webview,
      expectedComposerText: 'translated\ntext',
    }),
    error => error?.code === code && (!field || error?.field === field),
  );
  assert.equal(h.coordinator.get(h.intentId).state, 'ready');
  assert.equal(h.state.sendCalls, 0, 'commit guard must never execute native send');
}

(async () => {
  const happy = harness();
  const committed = await happy.guard.beginCommit({
    intentId: happy.intentId,
    account: happy.account,
    webview: happy.webview,
    expectedComposerText: 'translated\ntext',
  });
  assert.equal(committed.state, 'committing');
  assert.equal(happy.state.sendCalls, 0);

  await expectReadyFailure(harness({ account: { id: 'account-B' } }), 'SEND_INTENT_STALE_CONTEXT', 'accountId');
  await expectReadyFailure(harness({ account: { partition: 'persist:other' } }), 'SEND_INTENT_STALE_CONTEXT', 'partition');
  await expectReadyFailure(harness({ account: { type: 'line' } }), 'SEND_INTENT_STALE_CONTEXT', 'platform');
  await expectReadyFailure(harness({ state: { webviewId: '88' } }), 'SEND_INTENT_STALE_CONTEXT', 'webviewId');
  await expectReadyFailure(harness({ state: { webviewGeneration: 8 } }), 'SEND_INTENT_STALE_CONTEXT', 'webviewGeneration');
  await expectReadyFailure(harness({ state: { currentChat: 'chat-B' } }), 'SEND_INTENT_STALE_CONTEXT', 'conversationId');
  await expectReadyFailure(harness({ state: { composerGeneration: 12 } }), 'SEND_INTENT_STALE_CONTEXT', 'composerGeneration');
  await expectReadyFailure(harness({ state: { composerText: 'different text' } }), 'SEND_INTENT_COMPOSER_MISMATCH', 'composerText');

  const missingChat = harness({ state: { currentChat: '' } });
  await expectReadyFailure(missingChat, 'SEND_INTENT_COMMIT_GUARD_INVALID', 'conversationId');

  const unsupported = harness({ account: { type: 'website' } });
  await assert.rejects(() => unsupported.guard.beginCommit({
    intentId: unsupported.intentId,
    account: unsupported.account,
    webview: unsupported.webview,
    expectedComposerText: 'translated text',
  }));
  assert.equal(unsupported.coordinator.get(unsupported.intentId).state, 'ready');
  assert.equal(unsupported.state.sendCalls, 0);

  assert.doesNotMatch(source, /sendText\s*\(/, 'guard must not execute native send');
  assert.doesNotMatch(source, /translation|querySelector|executeJavaScript|ipcRenderer|sendToHost/, 'guard must not own transform, DOM or Electron transport');
  assert.doesNotMatch(source, /submitPermitId/, 'guard must not receive or expose the private submit permit id');
  assert.match(html, /send-intent-admission\.js[\s\S]*send-intent-commit-guard\.js[\s\S]*broadcast-safety\.js/);

  console.log('SEND_INTENT_COMMIT_GUARD_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
