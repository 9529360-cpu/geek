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
  assert.ok(docs.includes(value), `real-client matrix must document case ${value}`);
}

for (const category of ['accepted', 'bridge-capacity', 'auth', 'quota', 'deadline', 'gateway', 'quality', 'cancelled']) {
  assert.ok(script.includes(`'${category}'`), `evidence recorder must expose admission category ${category}`);
  assert.ok(docs.includes(`\`${category}\``), `matrix must define category ${category}`);
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

assert.match(script, /automatedMessageSend\s*=\s*\$false/);
assert.match(script, /releaseGate\s*=\s*\$false/);
assert.match(script, /messageContentIncluded\s*=\s*\$false/);
assert.match(script, /translatedContentIncluded\s*=\s*\$false/);
assert.match(script, /conversationIdentifierIncluded\s*=\s*\$false/);
assert.match(script, /phoneNumberIncluded\s*=\s*\$false/);
assert.match(script, /accountIdentifierIncluded\s*=\s*\$false/);
assert.match(script, /cookieDataIncluded\s*=\s*\$false/);
assert.match(script, /authTokenIncluded\s*=\s*\$false/);
assert.match(script, /bridgeTokenIncluded\s*=\s*\$false/);
assert.match(script, /providerSecretIncluded\s*=\s*\$false/);
assert.match(script, /rawProfilePathIncluded\s*=\s*\$false/);

assert.match(docs, /Broadcast pass != composer pass/);
assert.match(docs, /Electron E2E pass != authenticated WhatsApp pass/);
assert.match(docs, /gateway health pass != current-user auth\/quota ready/);
assert.match(docs, /记录器不会自动发送消息，也不会读取聊天正文/);
assert.match(docs, /不得注册 self-hosted GitHub Actions runner/);
assert.match(docs, /LID `not-applicable` != LID pass/);

// Historical Issue #95 evidence remains a separate compatibility artifact. This
// contract intentionally checks its stable phase/version guards still exist rather
// than merging current translation evidence semantics into it.
assert.match(historical, /ValidateSet\('probe', 'pre-update', 'post-update'\)/);
assert.match(historical, /Pre-update evidence requires installed Geek 1\.2\.8/);
assert.match(historical, /Post-update evidence requires installed Geek 1\.2\.9/);
assert.equal(historical.includes('translation-on-send'), false, 'historical upgrade recorder must not absorb Issue #526 semantics');

console.log('TRANSLATION_REAL_CLIENT_EVIDENCE_CONTRACT_OK');
