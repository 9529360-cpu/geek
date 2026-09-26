'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const smokePath = path.join(__dirname, '..', 'scripts', 'telegram-send-intent-real-client-smoke.cjs');
const source = fs.readFileSync(smokePath, 'utf8');
const smoke = require(smokePath);

assert.equal(smoke.parseMode([]), 'preflight');
assert.equal(smoke.parseMode(['--preflight']), 'preflight');
assert.equal(smoke.parseMode(['--execute']), 'execute');
assert.throws(() => smoke.parseMode(['--execute', 'ignored']), { code: 'ARGUMENTS_INVALID' });
assert.throws(() => smoke.parseMode(['--message', 'text']), { code: 'ARGUMENTS_INVALID' });

for (const ciValue of ['', ' ', 'false', '0', 'true']) {
  assert.throws(
    () => smoke.assertExecutionAllowed('execute', { CI: ciValue, [smoke.CONFIRMATION_ENV]: smoke.CONFIRMATION_VALUE }),
    { code: 'CI_FORBIDDEN' },
    'any present CI variable must block execution',
  );
}
assert.throws(
  () => smoke.assertExecutionAllowed('execute', { [smoke.CONFIRMATION_ENV]: '' }),
  { code: 'CONFIRMATION_REQUIRED' },
);
assert.equal(smoke.assertExecutionAllowed('execute', { [smoke.CONFIRMATION_ENV]: smoke.CONFIRMATION_VALUE }), true);
assert.equal(smoke.assertExecutionAllowed('preflight', { CI: '', [smoke.CONFIRMATION_ENV]: '' }), true);

assert.equal(smoke.buildSmokeMessage(Date.parse('2026-09-26T12:34:56.789Z')), 'GEEK TELEGRAM SEND INTENT SMOKE 2026-09-26T12:34:56Z');
assert.equal(smoke.timingBucket(14999), 'under-15s');
assert.equal(smoke.timingBucket(15000), '15-60s');
assert.equal(smoke.timingBucket(60001), 'over-60s');
assert.equal(smoke.timingBucket(Number.NaN), 'unknown');

const sent = smoke.classifyOwnerTerminal({
  owner: true,
  state: 'sent',
  textReady: true,
  error: 'none',
});
assert.deepEqual(sent, {
  sendResult: 'sent',
  ownerState: 'sent',
  trustedAdmission: true,
  transformComplete: true,
  composerWriteComplete: true,
  generationRebound: true,
  commitGuardPassed: true,
  nativeCommitCount: 'one',
  code: 'OWNER_SENT',
});

const ambiguous = smoke.classifyOwnerTerminal({
  owner: true,
  state: 'unknown',
  textReady: true,
  error: 'uncertain',
});
assert.equal(ambiguous.sendResult, 'ambiguous');
assert.equal(ambiguous.nativeCommitCount, 'one');
assert.equal(ambiguous.code, 'OWNER_AMBIGUOUS');

assert.deepEqual(smoke.classifyUnobservedExecution(true), {
  sendResult: 'ambiguous',
  ownerState: 'uncertain',
  nativeCommitCount: 'unknown',
  code: 'OWNER_AMBIGUOUS',
});
assert.deepEqual(smoke.classifyUnobservedExecution(false), {
  sendResult: 'blocked',
  ownerState: 'not-started',
  nativeCommitCount: 'zero',
  code: 'OPERATOR_TIMEOUT',
});
assert.equal(smoke.classifyOwnerTerminal({
  owner: true,
  state: 'unknown',
  textReady: true,
  error: 'other',
}).nativeCommitCount, 'unknown');

const projected = smoke.projectEvidence({
  mode: 'execute',
  preflightReady: true,
  telegramAccount: true,
  webviewReady: true,
  translationBridgeReady: true,
  trustedAdmission: true,
  sendResult: 'sent',
  ownerState: 'sent',
  recipientReceipt: 'manual-pass',
  accountId: 'private-account',
  chatId: 'private-chat',
  partition: 'private-partition',
  username: 'private-user',
  url: 'https://private.invalid/path?secret=1',
  token: 'private-token',
  message: 'private body',
  profilePath: 'C:\\\\private\\\\profile',
  rawError: 'private error',
});
assert.deepEqual(Object.keys(projected), [
  'schemaVersion',
  'mode',
  'preflightReady',
  'telegramAccount',
  'webviewReady',
  'translationBridgeReady',
  'trustedOwnerRuntimeReady',
  'translationSendEnabled',
  'currentChatReady',
  'composerEmpty',
  'composerPrepared',
  'trustedAdmission',
  'transformComplete',
  'composerWriteComplete',
  'generationRebound',
  'commitGuardPassed',
  'nativeCommitCount',
  'cleanupComplete',
  'ownerState',
  'sendResult',
  'recipientReceipt',
  'operatorActionRequired',
  'code',
  'durationBucket',
]);
assert.equal(JSON.stringify(projected).includes('private-'), false);
assert.equal(JSON.stringify(projected).includes('https://'), false);
assert.equal(projected.recipientReceipt, 'manual-pass');
assert.equal(projected.cleanupComplete, false);
assert.equal(projected.schemaVersion, 'v1');

const executeGuard = "if (' + modeValue + ' !== \"execute\") return out;";
const executeGuardIndex = source.indexOf(executeGuard);
const messageWriteIndex = source.indexOf('window.api.webviewInput.insertText');
assert.ok(executeGuardIndex >= 0, 'preflight must return before the execution branch');
assert.ok(messageWriteIndex > executeGuardIndex, 'message insertion must stay behind the execute branch');
assert.ok(source.includes('result?.delivery?.owner === "send-intent"'));
assert.ok(source.includes('rawError === "SEND_INTENT_OUTCOME_UNCERTAIN"'));
for (const forbidden of ['submitButton.click(', 'dispatchEvent(', 'SendKeys', 'transport.sendText', 'adapter.sendText']) {
  assert.equal(source.includes(forbidden), false, 'the smoke must not synthesize or directly call a send gesture/transport');
}
assert.ok(source.includes('buildHostCleanupExpression(prepared.context, smokeText, !requestSeen && (!operatorWindowOpened || finalState?.sendResult === \'blocked\'))'));
assert.ok(source.includes('outputEvidence.cleanupComplete = cleanupState?.kind === \'CLEANUP_RESULT\''));
assert.ok(source.includes('...classifyUnobservedExecution(true)'));
assert.ok(source.includes('throw codedError(\'CDP_COMMAND_FAILED\')'));
assert.ok(source.includes('const activeId = String(document.querySelector'));
assert.ok(source.indexOf('out.requestSeen = state.requestSeen === true;')
  < source.indexOf('if (activeId !== expected.accountId'));

console.log('TELEGRAM_SEND_INTENT_REAL_CLIENT_SMOKE_CONTRACT_OK');
