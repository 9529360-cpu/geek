'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');
const hostAdapters = fs.readFileSync(path.join(root, 'ui', 'platform-host-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

assert.match(
  app,
  /safePayload\.intent === 'outgoing-send' && \(family === 'telegram' \|\| family === 'line' \|\| family === 'whatsapp' \|\| family === 'messenger'\)[\s\S]{0,260}executePlatformOutgoingSendIntent\(account, wv, safePayload\)/,
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
  /async function executePlatformOutgoingSendIntent\(account, wv, safePayload\)[\s\S]*const sourceSnapshot = String\(await adapter\.getComposerText\(\) \|\| ''\)[\s\S]*transformPolicy: \{[\s\S]*mode: translate \? 'translation' : 'identity'[\s\S]*window\.api\.translation\.translate\(\{[\s\S]*requestId: intentId/,
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

const telegramStart = adapters.indexOf('function installTelegramTranslation');
const lineStart = adapters.indexOf('function installLineTranslation');
assert.ok(telegramStart >= 0 && lineStart > telegramStart);
const telegramGuest = adapters.slice(telegramStart, lineStart);
assert.match(
  telegramGuest,
  /result\?\.delivery\?\.owner !== 'send-intent'[\s\S]{0,120}SEND_INTENT_OWNER_REQUIRED/,
  'Telegram guest must fail closed when the host does not return SendIntent ownership',
);
assert.match(
  telegramGuest,
  /result\.delivery\.state !== 'sent'[\s\S]{0,120}SEND_INTENT_SEND_FAILED/,
  'Telegram guest must accept only a terminal sent result from the SendIntent owner',
);
assert.doesNotMatch(telegramGuest, /nativeInsertText|__geekNativeInputPending|__geekTakeNativeInputRequest|__geekResolveNativeInput/, 'Telegram guest must not keep a second native composer mutation path');
assert.doesNotMatch(telegramGuest, /submitButton\.click\(\)/, 'Telegram guest must not keep a synthetic send-button commit tail');
assert.doesNotMatch(telegramGuest, /setAttribute\('contenteditable', 'false'\)/, 'Telegram guest must not own composer mutability while SendIntent is active');

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
  hostAdapters,
  /window\.__geekTelegramNativeInputCommit=true[\s\S]*webviewInput\.insertText[\s\S]*window\.__geekTelegramNativeInputCommit=false/,
  'host owner composer write must enter and leave the existing Telegram native-input compatibility window',
);
assert.match(
  hostAdapters,
  /api\.webviewInput\.commitSubmit\([\s\S]{0,260}expected\.conversationId,[\s\S]{0,180}expected\.composerText/,
  'Telegram owner commit must delegate the native Enter to the main-process WebView IPC owner with exact chat/composer binding',
);
const telegramHostStart = hostAdapters.indexOf("factories.set('telegram'");
const telegramHostEnd = hostAdapters.indexOf("factories.set('line'", telegramHostStart);
assert.ok(telegramHostStart >= 0 && telegramHostEnd > telegramHostStart);
const telegramHost = hostAdapters.slice(telegramHostStart, telegramHostEnd);
assert.doesNotMatch(telegramHost, /button\.click\(\)/, 'SendIntent owner commit must not synthesize a Telegram DOM button click');
assert.doesNotMatch(telegramHost, /sendInputEvent\(/, 'renderer must not bypass the main-process native-input owner');
assert.match(telegramHost, /state\?\.count > baseline\.count && state\?\.empty === true/, 'owner must only confirm sent after a new message appears and the composer clears');

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
assert.match(route, /family === 'telegram' \|\| family === 'line' \|\| family === 'whatsapp' \|\| family === 'messenger'/, 'shared SendIntent migration must explicitly include Telegram, LINE, WhatsApp, and Messenger');

console.log('TELEGRAM_SEND_INTENT_OWNER_CONTRACT_OK');
