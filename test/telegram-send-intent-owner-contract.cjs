'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

assert.match(
  app,
  /safePayload\.intent === 'outgoing-send' && familyOf\(account\.type\)\.key === 'telegram'[\s\S]{0,260}executeTelegramOutgoingSendIntent\(account, wv, safePayload\)/,
  'all Telegram outgoing-send requests should enter the SendIntent owner',
);
assert.match(
  app,
  /: await window\.api\.translation\.translate\(\{ \.\.\.safePayload, accountId: account\.id \}\)/,
  'non-owner translation paths must keep the existing translation runtime route',
);

assert.match(app, /GeekSendIntentCoordinator\.createCoordinator\(\)/);
assert.match(app, /GeekSendIntentAdmission\.create\(\{[\s\S]*trustedSubmitRuntime,[\s\S]*coordinator: sendIntentCoordinator,[\s\S]*familyOf/);
assert.match(app, /GeekSendIntentCommitGuard\.create\(\{[\s\S]*coordinator: sendIntentCoordinator,[\s\S]*trustedSubmitRuntime,[\s\S]*platformCapabilities/);
assert.match(app, /GeekSendIntentExecutor\.create\(\{[\s\S]*admission: sendIntentAdmission,[\s\S]*coordinator: sendIntentCoordinator,[\s\S]*commitGuard: sendIntentCommitGuard,[\s\S]*platformCapabilities/);

assert.match(
  app,
  /async function executeTelegramOutgoingSendIntent\(account, wv, safePayload\)[\s\S]*const sourceSnapshot = String\(await adapter\.getComposerText\(\) \|\| ''\)[\s\S]*transformPolicy: \{[\s\S]*mode: translate \? 'translation' : 'identity'[\s\S]*window\.api\.translation\.translate\(\{[\s\S]*requestId: intentId/,
  'Telegram ordinary and translated sends must use the same executor; host policy chooses identity versus translation',
);
assert.match(
  app,
  /if \(!translate\) return \{ text: sourceSnapshot, mode: 'identity', rewriteComposer: false \}/,
  'ordinary Telegram sends must preserve the native composer while still using SendIntent ownership',
);
assert.match(
  app,
  /delivery: \{[\s\S]*owner: 'send-intent',[\s\S]*state: execution\.intent\.state,[\s\S]*intentId: execution\.intent\.intentId/,
  'host must report SendIntent-owned delivery back to the guest',
);

const ownerCheck = adapters.indexOf("if (result?.delivery?.owner === 'send-intent')");
const legacyNativeFill = adapters.indexOf('await nativeInsertText(result.text, cid)', ownerCheck);
const legacySyntheticSubmit = adapters.indexOf('submitButton.click();', ownerCheck);
assert.ok(ownerCheck >= 0, 'Telegram guest must recognize SendIntent-owned delivery');
assert.ok(legacyNativeFill > ownerCheck, 'legacy native fill must remain only after owner short-circuit');
assert.ok(legacySyntheticSubmit > ownerCheck, 'legacy synthetic submit must remain only after owner short-circuit');
assert.match(
  adapters.slice(ownerCheck, legacyNativeFill),
  /if \(result\.delivery\.state !== 'sent'\) throw new Error\('SEND_INTENT_SEND_FAILED'\);[\s\S]*return;/,
  'owner-delivered success must return before the legacy guest send tail',
);

assert.match(
  adapters,
  /const requestTimeoutMs = intent === 'outgoing-send' \? 55000 : 35000/,
  'Telegram outgoing SendIntent must have enough bridge time to include transform and native outcome',
);
assert.match(
  adapters,
  /SEND_INTENT_OUTCOME_UNCERTAIN[\s\S]{0,180}系统不会自动重发/,
  'ambiguous outcome must tell the user the system will not automatically resend',
);

assert.match(
  app,
  /window\.__geekTelegramNativeInputCommit=true[\s\S]*webviewInput\.insertText[\s\S]*window\.__geekTelegramNativeInputCommit=false/,
  'host owner composer write must enter and leave the existing Telegram native-input compatibility window',
);
assert.match(
  app,
  /window\.api\.webviewInput\.commitSubmit\([\s\S]{0,260}expected\.conversationId,[\s\S]{0,180}expected\.composerText/,
  'Telegram owner commit must delegate the native Enter to the main-process WebView IPC owner with exact chat/composer binding',
);
const ownerSendTextStart = app.indexOf("async sendText(text = '', commit = {})");
const ownerSendTextEnd = app.indexOf("const script = typeof transport.send", ownerSendTextStart);
assert.ok(ownerSendTextStart >= 0 && ownerSendTextEnd > ownerSendTextStart);
const ownerSendTextRegion = app.slice(ownerSendTextStart, ownerSendTextEnd);
assert.doesNotMatch(ownerSendTextRegion, /button\.click\(\)/, 'SendIntent owner commit must not synthesize a Telegram DOM button click');
assert.doesNotMatch(ownerSendTextRegion, /sendInputEvent\(/, 'renderer must not bypass the main-process native-input owner');
assert.match(ownerSendTextRegion, /state\?\.count > baseline\.count && state\?\.empty === true/, 'owner must only confirm sent after a new message appears and the composer clears');
assert.match(
  adapters,
  /addEventListener\('beforeinput'[\s\S]{0,220}data-geek-native-submit-commit/,
  'guest beforeinput lock must yield to the owner-native Enter commit',
);
assert.match(
  adapters,
  /addEventListener\('keydown'[\s\S]{0,220}data-geek-native-submit-commit/,
  'guest keydown capture listener must yield to the owner-native Enter commit',
);

assert.match(
  html,
  /send-intent-commit-guard\.js[\s\S]*send-intent-executor\.js[\s\S]*broadcast-safety\.js/,
  'executor must load after commit guard and before app.js consumers',
);


assert.match(
  app,
  /const webviewGuestIds = new WeakMap\(\)[\s\S]*did-start-navigation[\s\S]*cancelSendIntentsForWebview\(wv, 'SEND_INTENT_WEBVIEW_RELOADED'\)[\s\S]*trustedSubmitRuntime\.advanceGeneration\(wv\)/,
  'reload cancellation must use the last safely attached guest id before advancing trusted generation',
);
assert.doesNotMatch(
  app,
  /did-start-navigation[\s\S]{0,260}getWebContentsId\(\)/,
  'navigation-start must not call getWebContentsId before Electron guarantees an attached guest',
);
assert.match(
  app,
  /render-process-gone[\s\S]{0,260}cancelSendIntentsForWebview\(wv, 'SEND_INTENT_WEBVIEW_RELOADED'\)/,
  'renderer loss must cancel active SendIntents through the remembered guest owner',
);

const route = app.match(/const result = safePayload\.intent === 'outgoing-send'[\s\S]{0,420}?;/)?.[0] || '';
assert.doesNotMatch(route, /line|whatsapp/i, 'live SendIntent migration must not broaden to LINE or WhatsApp in this slice');

console.log('TELEGRAM_SEND_INTENT_OWNER_CONTRACT_OK');
