'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/windows-translation-real-client-evidence.ps1'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/translation-real-client-smoke.md'), 'utf8');
const historical = fs.readFileSync(path.join(root, 'scripts/windows-real-client-evidence.ps1'), 'utf8');

const requiredCases = [
  'translation-off-enter',
  'translation-off-button',
  'translation-on-send',
  'translation-failure-recovery',
  'busy-chat-send',
  'webview-reload-send',
  'app-cold-start-send',
  'quota-valid',
  'quota-zero',
  'subscription-logged-out',
  'upgraded-profile',
  'direct-chat',
  'lid-chat',
  'broadcast-control',
];
for (const value of requiredCases) {
  assert.ok(script.includes(`'${value}'`), `evidence recorder must allow case ${value}`);
}
for (let index = 1; index <= 14; index += 1) {
  const id = `RC-${String(index).padStart(2, '0')}`;
  assert.ok(docs.includes(`### ${id}`), `real-client matrix must document ${id}`);
}

for (const category of ['accepted', 'bridge-capacity', 'auth', 'quota', 'deadline', 'gateway', 'quality', 'cancelled']) {
  assert.ok(script.includes(`'${category}'`), `evidence recorder must expose admission category ${category}`);
}

// The recorder is intentionally categorical. It must not accept free-form fields
// that could tempt an operator to paste customer/chat/account content into evidence.
const paramBlock = script.slice(0, script.indexOf('$ErrorActionPreference'));
for (const forbiddenParam of [
  '$Message', '$Text', '$Translation', '$ChatId', '$ConversationId', '$ContactId',
  '$Phone', '$PhoneNumber', '$AccountId', '$AccountNumber', '$Token', '$Cookie',
  '$Authorization', '$Secret', '$ProfilePath', '$Notes', '$Comment', '$Description',
]) {
  assert.equal(paramBlock.includes(forbiddenParam), false, `privacy boundary must not accept ${forbiddenParam}`);
}

// Machine-check only the evidence schema and privacy boundary. Human-facing prose
// is intentionally free to evolve without turning documentation wording into CI.
for (const field of [
  'automatedMessageSend', 'releaseGate', 'messageContentIncluded', 'translatedContentIncluded',
  'conversationIdentifierIncluded', 'phoneNumberIncluded', 'accountIdentifierIncluded',
  'cookieDataIncluded', 'authTokenIncluded', 'bridgeTokenIncluded', 'providerSecretIncluded',
  'rawProfilePathIncluded',
]) {
  assert.match(script, new RegExp(`${field}\\s*=\\s*\\$false`), `${field} must stay false`);
}
assert.match(script, /capturedUtc\s*=\s*\(Get-Date\)\.ToUniversalTime\(\)\.ToString\('o'\)/);
assert.match(script, /schema\s*=\s*1/);
assert.match(script, /issue\s*=\s*526/);
assert.match(script, /ConvertTo-Json -Depth 8/);
assert.match(script, /Set-Content -LiteralPath \$outputPath -Encoding UTF8/);
assert.equal(script.includes('Invoke-WebRequest'), false, 'recorder must not upload evidence');
assert.equal(script.includes('Invoke-RestMethod'), false, 'recorder must not call remote APIs');
assert.equal(script.includes('SendKeys'), false, 'recorder must not automate message sends');
assert.equal(script.includes('executeJavaScript'), false, 'recorder must not inspect remote chat DOM');

// Historical Issue #95 evidence remains a separate compatibility artifact. This
// contract checks its stable phase/version guards instead of merging current
// translation evidence semantics into the historical upgrade recorder.
assert.match(historical, /ValidateSet\('probe', 'pre-update', 'post-update'\)/);
assert.match(historical, /Pre-update evidence requires installed Geek 1\.2\.8/);
assert.match(historical, /Post-update evidence requires installed Geek 1\.2\.9/);
assert.equal(historical.includes('translation-on-send'), false, 'historical upgrade recorder must not absorb Issue #526 semantics');

console.log('TRANSLATION_REAL_CLIENT_EVIDENCE_CONTRACT_OK');
