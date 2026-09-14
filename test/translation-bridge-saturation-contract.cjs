'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const security = require('../ui/webview-bridge-security.js');
const token = '0123456789abcdef0123456789abcdef';
const requestId = 'bridge_req_1234';

// Admission stays fail-closed for untrusted/invalid traffic even when the bridge is full.
assert.equal(
  security.authorize({ expectedToken: token, suppliedToken: 'bad', requestId, inflight: 20, limit: 20 }).reason,
  'TOKEN_MISMATCH'
);
assert.equal(
  security.authorize({ expectedToken: token, suppliedToken: token, requestId: 'x', inflight: 20, limit: 20 }).reason,
  'INVALID_REQUEST_ID'
);
assert.deepEqual(
  security.authorize({ expectedToken: token, suppliedToken: token, requestId, inflight: 20, limit: 20 }),
  { ok: false, reason: 'RATE_LIMIT' }
);

const translationStart = app.indexOf('async function processTranslationRequest');
const translationEnd = app.indexOf('\n  // 新传输：guest preload', translationStart);
assert.ok(translationStart >= 0 && translationEnd > translationStart, 'translation bridge owner must exist');
const translationOwner = app.slice(translationStart, translationEnd);

// A correctly authenticated request that only lost admission to capacity must terminate now,
// not sit in the guest pending map until its independent 35s timeout.
assert.match(translationOwner, /authorization\.reason\s*===\s*['"]RATE_LIMIT['"]/);
assert.match(translationOwner, /__geekResolveTranslation/);
assert.match(translationOwner, /BRIDGE_BUSY/);
assert.match(translationOwner, /if\s*\(!authorization\.ok\)[\s\S]*return;/);

// Capacity rejection is not admitted into TranslationRuntime and therefore must happen before
// inflight accounting and before window.api.translation.translate().
const capacityGuardAt = translationOwner.search(/authorization\.reason\s*===\s*['"]RATE_LIMIT['"]/);
const inflightAt = translationOwner.indexOf('changeWebviewBridgeInflight(wv, 1)');
const runtimeAt = translationOwner.indexOf('window.api.translation.translate');
assert.ok(capacityGuardAt >= 0 && capacityGuardAt < inflightAt, 'busy terminal response must precede inflight admission');
assert.ok(inflightAt >= 0 && inflightAt < runtimeAt, 'runtime call must remain behind accepted bridge admission');

// LINE must use the same translation bridge owner instead of keeping a second copy of admission,
// capacity, inflight, and terminal-response logic.
const lineStart = app.indexOf('async function handleLineTranslationIpc');
const lineEnd = app.indexOf('\n  function syncTelegramTranslationCfgToWebview', lineStart);
assert.ok(lineStart >= 0 && lineEnd > lineStart, 'LINE bridge ingress must exist');
const lineIngress = app.slice(lineStart, lineEnd);
assert.match(lineIngress, /processTranslationRequest\s*\(/);
assert.doesNotMatch(lineIngress, /authorizeWebviewBridge\s*\(/);
assert.doesNotMatch(lineIngress, /window\.api\.translation\.translate/);

// Do not weaken bridge security to make the test pass: invalid identity remains silent/fail-closed.
assert.doesNotMatch(translationOwner, /TOKEN_MISMATCH[\s\S]*__geekResolveTranslation/);
assert.doesNotMatch(translationOwner, /INVALID_REQUEST_ID[\s\S]*__geekResolveTranslation/);

console.log('TRANSLATION_BRIDGE_SATURATION_CONTRACT_OK');
