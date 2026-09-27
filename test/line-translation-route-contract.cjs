'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const webviewIpc = fs.readFileSync(path.join(root, 'src', 'webview-ipc.cjs'), 'utf8');
const lineBundle = fs.readFileSync(path.join(root, 'resources', 'extensions', 'line-3.5.1', 'static', 'js', 'main.js'), 'utf8');

const currentRowSelector = '[class*="chatlistItem-module__chatlist_item__"][data-mid][aria-current="true"]';

assert.match(
  lineBundle,
  /\/:routeSegment\/:messageBoxId/,
  'bundled LINE must retain the historical two-segment route for compatibility',
);

const adapterStart = adapters.indexOf('const chatId = () => {');
const adapterEnd = adapters.indexOf('const settingFor = id =>', adapterStart);
assert.ok(adapterStart >= 0 && adapterEnd > adapterStart, 'LINE guest current-chat owner must exist');
const adapterRoute = adapters.slice(adapterStart, adapterEnd);
assert.ok(adapterRoute.includes(currentRowSelector), 'LINE guest must prefer the live aria-current chat row');
assert.ok(adapterRoute.includes("const selectedId = String(selected?.getAttribute('data-mid') || '');"));
assert.ok(adapterRoute.includes('if (selectedId) return selectedId;'), 'live selected row must win over route fallback');
assert.ok(adapterRoute.includes("const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];"));
assert.ok(adapterRoute.includes('const match = pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);'));
assert.ok(adapterRoute.includes("return match ? decodeURIComponent(match[1]) : '';"), 'legacy hash route remains a compatibility fallback');
assert.doesNotMatch(adapterRoute, /location\.hash[^\n]*\/chats\//, 'guest must not hard-code the new #/chats shell route as an identity source');

const platformStart = app.indexOf('const currentChatScripts = {');
const platformEnd = app.indexOf('const adapter = Object.freeze({', platformStart);
assert.ok(platformStart >= 0 && platformEnd > platformStart, 'LINE platform current-chat owner must exist');
const platformRoute = app.slice(platformStart, platformEnd);
assert.ok(platformRoute.includes(currentRowSelector), 'host capability must prefer the same live aria-current row');
assert.ok(platformRoute.includes("const selectedId = String(selected?.getAttribute('data-mid') || '');"));
assert.ok(platformRoute.includes('if (selectedId) return selectedId;'));
assert.ok(platformRoute.includes("const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];"));
assert.ok(platformRoute.includes('const match = pathname.match(/^\\\\/[^/]+\\\\/([^/]+)\\\\/?$/);'));
assert.ok(platformRoute.includes("return match ? decodeURIComponent(match[1]) : null;"));
assert.doesNotMatch(platformRoute, /\/chats\//, 'host capability must not treat the shell #/chats route as conversation identity');

const focusedStart = webviewIpc.indexOf('function focusedComposerScript');
const focusedEnd = webviewIpc.indexOf('function telegramCommitGuardScript', focusedStart);
assert.ok(focusedStart >= 0 && focusedEnd > focusedStart, 'main-process focused composer owner must exist');
const focusedRoute = webviewIpc.slice(focusedStart, focusedEnd);
assert.ok(focusedRoute.includes(currentRowSelector), 'main-process LINE composer mutation must prefer the live aria-current chat row');
assert.match(focusedRoute, /if \(expectedChatId && currentChatId !== expectedChatId\) return 'CHAT_CHANGED'/);
assert.match(focusedRoute, /return !!currentChatId && !!textarea/, 'LINE composer readiness must work on the #/chats shell when the selected row identifies the conversation');

console.log('LINE_TRANSLATION_ROUTE_CONTRACT_OK');
