'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');
const hostAdapters = fs.readFileSync(path.join(root, 'ui', 'platform-host-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8').replace(/\r\n?/g, '\n');
const runtime = fs.readFileSync(path.join(root, 'ui', 'trusted-submit-runtime.js'), 'utf8').replace(/\r\n?/g, '\n');

assert.match(
  app,
  /safePayload\.intent === 'outgoing-send' && \(family === 'telegram' \|\| family === 'line' \|\| family === 'whatsapp' \|\| family === 'messenger'\)[\s\S]{0,180}executePlatformOutgoingSendIntent/,
  'Telegram, LINE, WhatsApp, and Messenger outgoing sends must share the same host SendIntent owner',
);
assert.match(
  app,
  /async function executePlatformOutgoingSendIntent\([\s\S]*family !== 'telegram' && family !== 'line'[\s\S]*sendIntentExecutor\.execute/,
  'the shared owner must use the generic executor rather than a LINE-specific state machine',
);
assert.match(
  app,
  /if \(!translate\) return \{ text: sourceSnapshot, mode: 'identity', rewriteComposer: false \}/,
  'ordinary LINE send must preserve composer content while still entering SendIntent',
);

const lineInstallStart = adapters.indexOf('function installLineTranslation');
assert.ok(lineInstallStart >= 0);
const lineSource = adapters.slice(lineInstallStart);
const ownerStart = lineSource.indexOf('const submitThroughOwner');
const ownerEnd = lineSource.indexOf("document.addEventListener('keydown'", ownerStart);
assert.ok(ownerStart >= 0 && ownerEnd > ownerStart);
const ownerRegion = lineSource.slice(ownerStart, ownerEnd);
assert.match(ownerRegion, /intent:\s*'outgoing-send'/);
assert.match(ownerRegion, /delivery\?\.owner !== 'send-intent'/);
assert.match(ownerRegion, /delivery\.state !== 'sent'/);
assert.match(adapters, /if \(\/\^SEND_INTENT_\/\.test\(raw\)\) return '消息未发送，请确认当前聊天和草稿后重试'/, 'ordinary LINE SendIntent failures must not be mislabeled as translation failures');
assert.doesNotMatch(ownerRegion, /nativeInsertText|submitButton\.click|insertValue|settingFor\(/, 'LINE guest owner must not translate, rewrite composer, or commit natively');
assert.match(lineSource, /addEventListener\('keydown'[\s\S]{0,500}submitThroughOwner\(event, host\)/);
assert.match(lineSource, /addEventListener\('click'[\s\S]{0,500}submitThroughOwner\(event, composerHost\(event\)\)/);

const lineHostStart = hostAdapters.indexOf("factories.set('line'");
const lineHostEnd = hostAdapters.indexOf("factories.set('whatsapp'", lineHostStart);
assert.ok(lineHostStart >= 0 && lineHostEnd > lineHostStart);
const lineHost = hostAdapters.slice(lineHostStart, lineHostEnd);
assert.match(lineHost, /commit\.expectedConversationId && commit\.expectedComposerText/);
assert.match(
  hostAdapters,
  /chatlistItem-module__chatlist_item__[\s\S]{0,140}data-mid[\s\S]{0,140}aria-current="true"/,
  'LINE current chat identity must prefer the selected chat row because modern LINE keeps location.hash at #/chats',
);
assert.match(
  hostAdapters,
  /selectedId[\s\S]{0,260}pathname[\s\S]{0,260}match/,
  'LINE current chat identity must retain the legacy hash parser only as a compatibility fallback',
);
assert.match(lineHost, /currentChat!==expected\.conversationId/);
assert.match(lineHost, /norm\([\s\S]*expected\.composerText/);
assert.match(lineHost, /api\.webviewInput\.commitSubmit\([\s\S]{0,260}account\.id,[\s\S]{0,260}webview\.getWebContentsId\(\)[\s\S]{0,260}expected\.conversationId[\s\S]{0,260}expected\.composerText/, 'LINE final commit must delegate exact chat/composer binding to the main-process WebView input owner');
assert.doesNotMatch(lineHost, /button\.click\(\)/, 'LINE SendIntent owner must not synthesize a DOM click after migration to native commit');
assert.match(lineHost, /state\?\.count > baseline\.count && state\?\.empty === true/, 'LINE sent outcome requires both a new message and cleared composer');
assert.match(lineHost, /return 'MAYBE'/, 'ambiguous LINE commit must remain fail-closed');

assert.doesNotMatch(runtime, /binding\.platform !== 'telegram'/, 'trusted submit runtime must be exact-platform generic');
assert.match(runtime, /!platform \|\| platform !== binding\.platform/);

console.log('LINE_SEND_INTENT_OWNER_CONTRACT_OK');
