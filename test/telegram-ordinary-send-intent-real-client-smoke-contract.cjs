'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const basePath = path.join(__dirname, '..', 'scripts', 'telegram-send-intent-real-client-smoke.cjs');
const entryPath = path.join(__dirname, '..', 'scripts', 'telegram-send-intent-ordinary-real-client-smoke.cjs');
const source = fs.readFileSync(basePath, 'utf8');
const entry = fs.readFileSync(entryPath, 'utf8');
const smoke = require(basePath);

const now = Date.parse('2026-09-27T12:34:56.789Z');
const ordinaryMessage = smoke.buildSmokeMessage(now, 'ordinary');
assert.equal(ordinaryMessage, 'GEEK TELEGRAM ORDINARY SEND INTENT SMOKE 2026-09-27T12:34:56Z');
assert.throws(() => smoke.buildSmokeMessage(now, 'other'), { code: 'ARGUMENTS_INVALID' });

for (const mode of ['preflight', 'execute']) {
  const expression = smoke.buildHostPrepareExpression(mode, ordinaryMessage, 'ordinary');
  assert.doesNotThrow(() => new Function('return ' + expression), mode + ' ordinary host prepare expression must parse');
}
assert.throws(
  () => smoke.buildHostPrepareExpression('preflight', ordinaryMessage, 'other'),
  { code: 'ARGUMENTS_INVALID' },
);

assert.throws(
  () => smoke.assertExecutionAllowed('execute', {
    [smoke.CONFIRMATION_ENV]: smoke.CONFIRMATION_VALUE,
  }, 'ordinary'),
  { code: 'CONFIRMATION_REQUIRED' },
  'translated confirmation must never authorize ordinary-send execution',
);
assert.equal(
  smoke.assertExecutionAllowed('execute', {
    [smoke.ORDINARY_CONFIRMATION_ENV]: smoke.ORDINARY_CONFIRMATION_VALUE,
  }, 'ordinary'),
  true,
);
assert.throws(
  () => smoke.assertExecutionAllowed('execute', {
    CI: 'false',
    [smoke.ORDINARY_CONFIRMATION_ENV]: smoke.ORDINARY_CONFIRMATION_VALUE,
  }, 'ordinary'),
  { code: 'CI_FORBIDDEN' },
);

const sent = smoke.classifyOwnerTerminal({
  owner: true,
  state: 'sent',
  textReady: true,
  identity: true,
  error: 'none',
}, 'ordinary');
assert.deepEqual(sent, {
  sendResult: 'sent',
  ownerState: 'sent',
  trustedAdmission: true,
  transformComplete: true,
  composerWriteComplete: false,
  generationRebound: false,
  identityTransformObserved: true,
  commitGuardPassed: true,
  nativeCommitCount: 'one',
  code: 'OWNER_SENT',
});
assert.equal(smoke.classifyOwnerTerminal({
  owner: true,
  state: 'sent',
  textReady: true,
  identity: false,
  error: 'none',
}, 'ordinary'), null, 'ordinary sent proof must include the identity transform observation');

const projected = smoke.projectEvidence({
  scenario: 'ordinary',
  mode: 'execute',
  preflightReady: true,
  telegramAccount: true,
  webviewReady: true,
  translationBridgeReady: true,
  trustedOwnerRuntimeReady: true,
  ordinaryPolicyReady: true,
  currentChatReady: true,
  composerPrepared: true,
  trustedAdmission: true,
  transformComplete: true,
  identityTransformObserved: true,
  commitGuardPassed: true,
  nativeCommitCount: 'one',
  ownerState: 'sent',
  sendResult: 'sent',
  code: 'OWNER_SENT',
});
assert.equal(projected.schemaVersion, 'v1-ordinary');
assert.equal(projected.scenario, 'ordinary');
assert.equal(projected.ordinaryPolicyReady, true);
assert.equal(projected.identityTransformObserved, true);
assert.equal(projected.composerWriteComplete, false);
assert.equal(projected.generationRebound, false);

assert.match(source, /const policy = \{ \.\.\.base, \.\.\.chatSettings \}/);
assert.match(source, /wouldTranslate = policy\.enabled === true && policy\.autoSend !== false/);
assert.match(source, /scenario === "ordinary" \? out\.ordinaryPolicyReady : out\.translationSendEnabled/);
assert.match(source, /result\?\.mode === \\"identity\\" && result\?\.rewriteComposer === false/);
assert.doesNotMatch(source, /accountData\.set|localStorage\.setItem/, 'real-client smoke must not mutate translation settings to manufacture an ordinary-send condition');

assert.match(entry, /smoke\.runSmoke\(mode, env, 'ordinary'\)/);
assert.doesNotMatch(entry, /submitButton\.click|dispatchEvent|sendText\(/);
assert.equal(entry.includes('--message'), false);

console.log('TELEGRAM_ORDINARY_SEND_INTENT_REAL_CLIENT_SMOKE_CONTRACT_OK');