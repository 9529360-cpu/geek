'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const smoke = require('../scripts/whatsapp-send-intent-real-client-smoke.cjs');

const evidence = smoke.projectEvidence({
  whatsappAccount: true,
  accountActive: false,
  webviewReady: true,
  wppReady: true,
  chatListReady: true,
  chatListPopulated: true,
  currentChatReady: false,
  composerPresent: false,
  composerEmpty: true,
  translationBridgeReady: true,
  trustedOwnerRuntimeReady: true,
  directComposerVersion: 9,
  code: 'CHAT_LIST_READY_NO_ACTIVE_CHAT',
});
assert.equal(evidence.composerEmpty, false, 'missing composer must never be projected as an empty composer');
assert.equal(evidence.code, 'CHAT_LIST_READY_NO_ACTIVE_CHAT');
assert.equal(JSON.stringify(evidence).includes('@'), false, 'projected evidence must not expose chat identifiers');

const expression = smoke.buildHostPreflightExpression();
assert.match(expression, /chat\.list/);
assert.match(expression, /chat\.getActiveChat/);
assert.match(expression, /composerPresent/);
assert.match(expression, /CHAT_LIST_READY_NO_ACTIVE_CHAT/);
assert.match(expression, /GeekPlatformCapabilitiesRuntime/);
assert.match(expression, /__geekWhatsAppDirectComposerController/);
assert.doesNotMatch(expression, /\.click\(\)/, 'preflight must not mutate real chat/read state');

const source = fs.readFileSync(path.join(__dirname, '../scripts/whatsapp-send-intent-real-client-smoke.cjs'), 'utf8');
assert.doesNotMatch(source, /recipientReceipt|contactName|messageText/, 'privacy-safe preflight output must not carry recipient/message identifiers');
console.log('WHATSAPP_SEND_INTENT_REAL_CLIENT_SMOKE_CONTRACT_OK');
