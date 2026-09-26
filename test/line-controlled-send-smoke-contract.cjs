'use strict';

const assert = require('node:assert/strict');
const {
  CONFIRMATION_ENV,
  CONFIRMATION_VALUE,
  SMOKE_PREFIX,
  parseMode,
  assertExecutionAllowed,
  buildSmokeMessage,
  projectControlledSendResult,
  buildHostExpression,
  runControlledSend,
} = require('../scripts/line-controlled-send-smoke.cjs');

(async () => {
  assert.equal(parseMode(), 'preflight');
  assert.equal(parseMode('--preflight'), 'preflight');
  assert.equal(parseMode('execute'), 'execute');
  assert.throws(() => parseMode('--send'), error => error?.code === 'CONTROLLED_SEND_MODE_INVALID');

  assert.equal(assertExecutionAllowed('preflight', {}), true);
  assert.throws(
    () => assertExecutionAllowed('execute', {}),
    error => error?.code === 'CONTROLLED_SEND_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => assertExecutionAllowed('execute', {
      CI: 'true',
      [CONFIRMATION_ENV]: CONFIRMATION_VALUE,
    }),
    error => error?.code === 'CONTROLLED_SEND_CI_FORBIDDEN',
  );
  assert.equal(assertExecutionAllowed('execute', {
    [CONFIRMATION_ENV]: CONFIRMATION_VALUE,
  }), true);

  let debuggerTouched = false;
  await assert.rejects(
    runControlledSend('execute', {
      env: {},
      getDebugTargets: async () => { debuggerTouched = true; return []; },
    }),
    error => error?.code === 'CONTROLLED_SEND_CONFIRMATION_REQUIRED',
  );
  assert.equal(debuggerTouched, false, 'missing confirmation must block before debugger access');

  const message = buildSmokeMessage(Date.UTC(2026, 8, 26, 12, 34, 56));
  assert.equal(message, `${SMOKE_PREFIX} 2026-09-26T12:34:56Z`);
  assert.ok(message.length < 128);

  const projected = projectControlledSendResult({
    ready: true,
    lineAccount: true,
    candidateMode: true,
    authReady: true,
    webviewVisible: true,
    transportReady: true,
    chatReady: true,
    composerEmpty: true,
    accountStable: true,
    messagePrepared: true,
    sendAttempted: true,
    sendConfirmed: true,
    sendResult: 'sent',
    code: 'READY',
    accountId: 'private-account',
    partition: 'persist:private',
    chatId: 'private-chat',
    message: 'private-message',
    token: 'private-token',
  }, 'execute');
  assert.deepEqual(projected, {
    mode: 'execute',
    ready: true,
    lineAccount: true,
    candidateMode: true,
    authReady: true,
    webviewVisible: true,
    transportReady: true,
    chatReady: true,
    composerEmpty: true,
    accountStable: true,
    messagePrepared: true,
    sendAttempted: true,
    sendConfirmed: true,
    sendResult: 'sent',
    code: 'READY',
  });
  assert.doesNotMatch(JSON.stringify(projected), /private-account|persist:private|private-chat|private-message|private-token/);

  const preflightExpression = buildHostExpression({ execute: false });
  assert.match(preflightExpression, /window\.api\?\.accounts\?\.list/);
  assert.match(preflightExpression, /GeekPlatformTransports\?\.forAccount/);
  assert.match(preflightExpression, /transport\.getCurrentChat/);
  assert.match(preflightExpression, /transport\.getComposerText/);
  assert.match(preflightExpression, /GeekLineDownloads/);
  assert.match(preflightExpression, /outputKeys\.every/);
  assert.match(preflightExpression, /if \(!execute \|\| !result\.ready\) return result/);
  assert.doesNotMatch(preflightExpression, /getChats\(|textContent|innerHTML|outerHTML|document\.cookie|localStorage/);

  const executeExpression = buildHostExpression({ execute: true, message });
  assert.match(executeExpression, /transport\.setComposerText\(smokeText\)/);
  assert.match(executeExpression, /currentChat !== initialChat/);
  assert.match(executeExpression, /actualComposer !== smokeText\.trim\(\)/);
  assert.match(executeExpression, /transport\.sendText\(smokeText\)/);
  assert.match(executeExpression, /sendResult === 'SENT'/);
  assert.match(executeExpression, /transport\.clearComposerText/);
  assert.doesNotMatch(executeExpression, /querySelectorAll\([^)]*message-module|chatlistItem|contact|recipient/);

  const hostTarget = {
    type: 'page',
    url: 'file:///C:/work/geek/ui/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/host',
  };
  const rawReady = {
    kind: 'CONTROLLED_SEND_RESULT',
    ready: true,
    lineAccount: true,
    candidateMode: true,
    authReady: true,
    webviewVisible: true,
    transportReady: true,
    chatReady: true,
    composerEmpty: true,
    accountStable: true,
    messagePrepared: false,
    sendAttempted: false,
    sendConfirmed: false,
    sendResult: 'not-attempted',
    code: 'READY',
    secret: 'must-not-leak',
  };
  const preflight = await runControlledSend('preflight', {
    targets: [hostTarget],
    evaluateTarget: async () => rawReady,
    env: {},
  });
  assert.equal(preflight.ready, true);
  assert.equal(preflight.sendAttempted, false);
  assert.doesNotMatch(JSON.stringify(preflight), /must-not-leak/);

  let executeExpressionSeen = '';
  const executed = await runControlledSend('execute', {
    targets: [hostTarget],
    evaluateTarget: async (_target, expression) => {
      executeExpressionSeen = expression;
      return {
        ...rawReady,
        messagePrepared: true,
        sendAttempted: true,
        sendConfirmed: true,
        sendResult: 'sent',
      };
    },
    env: { [CONFIRMATION_ENV]: CONFIRMATION_VALUE },
    now: Date.UTC(2026, 8, 26, 12, 34, 56),
  });
  assert.equal(executed.sendConfirmed, true);
  assert.match(executeExpressionSeen, /GEEK LINE CANDIDATE TEXT SEND SMOKE 2026-09-26T12:34:56Z/);

  console.log('LINE_CONTROLLED_SEND_SMOKE_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
