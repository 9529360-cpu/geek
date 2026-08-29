'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const safetyPath = path.join(__dirname, '../ui/broadcast-safety.js');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const source = fs.readFileSync(routePath, 'utf8');
const safety = fs.readFileSync(safetyPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const route = require(routePath);

const sameChat = (a, b) => String(a || '').replace(/^#/, '') === String(b || '').replace(/^#/, '');

// BRT-20260829-TG-REAL-ROUTE
// A synthetic location.hash must never certify that Telegram actually switched chats.
assert.equal(route.routeConfirmed(false, '123', '123', sameChat), false,
  'matching route identity without selected Telegram UI is not a confirmed chat switch');
assert.equal(route.routeConfirmed(true, '123', '123', sameChat), true,
  'Telegram route is confirmed only when UI selection and identity both agree');
assert.equal(route.routeConfirmed(true, '456', '123', sameChat), false,
  'selected UI alone cannot authorize the wrong chat');
assert.equal(route.routeConfirmed(true, '123', '123', null), false,
  'route confirmation must retain the shared broadcast safety identity comparator');

const script = route.realRouteScript('123');
assert.match(script, /\.chat-item-clickable/, 'fallback must operate on Telegram real chat rows');
assert.match(script, /\.chat-list\.custom-scroll/, 'fallback must search the virtualized Telegram chat list');
assert.match(script, /scrollTop/, 'fallback must remount off-screen virtualized rows with bounded scrolling');
assert.match(script, /classList\?\.contains\('selected'\)/, 'fallback must require Telegram selected UI state');
assert.doesNotMatch(script, /location\.hash\s*=/, 'fallback must never mutate location.hash to self-certify navigation');
assert.match(script, /TARGET_NOT_MOUNTED/, 'unresolved virtualized targets must fail closed');
assert.match(source, /async function openSavedTarget\(platform, wv, chatId\)/,
  'saved-target recovery must be exposed as an explicit helper');
assert.match(source, /throw new Error\('TG_CHAT_ROUTE_NOT_CONFIRMED:/,
  'failed saved-target routing must fail closed');
assert.match(source, /routeConfirmed\(selected, current, chatId, window\.GeekBroadcastSafety\?\.sameChat\)/,
  'final route confirmation must combine real UI state with the shared chat identity guard');
assert.match(source, /__geekBroadcastTelegramRouteTrace/,
  'runtime diagnostics must expose a stage trace for real-client localization');
const traceFunction = source.match(/function setTrace\(stage\) \{([\s\S]*?)\n  \}/)?.[1] || '';
assert.ok(traceFunction, 'stage trace helper must exist');
assert.doesNotMatch(traceFunction, /target|chatId|name|message|text/i,
  'diagnostic trace helper must not retain Telegram target identity or message content');

assert.match(safety, /telegram-broadcast-route\.js/,
  'broadcast bootstrap must load the Telegram saved-target route helper before runtime use');
assert.doesNotMatch(source,
  /window\.GeekPlatformTransports\s*=|wrapFactory\(|installWhenReady\(|__geekTelegramRouteAware/,
  'saved-target routing must not replace the globally shared Telegram platform factory');
assert.match(runtime,
  /const opened = await ctx\.platform\.openChat\(target\.id\);[\s\S]{0,260}?target\.telegramRouteFallback !== true\) return opened;/,
  'ordinary Telegram broadcasts must preserve the original platform openChat path');

console.log('TELEGRAM_BROADCAST_ROUTE_CONTRACT_OK');
