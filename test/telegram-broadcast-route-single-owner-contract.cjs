'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const route = require(routePath);

// BRT-20260829-TG-SAVED-ROUTE-HELPER
// Saved-target recovery still requires real Telegram UI confirmation, but it must
// remain an explicit helper rather than a global replacement for every Telegram
// platform.openChat call.

assert.doesNotMatch(
  routeSource,
  /window\.GeekPlatformTransports\s*=|wrapFactory\(|installWhenReady\(|__geekTelegramRouteAware/,
  'saved-target route recovery must not install a global Telegram platform decorator'
);

assert.match(
  routeSource,
  /async function openSavedTarget\(platform, wv, chatId\)[\s\S]*?const baseOpened = await platform\.openChat\(chatId\);[\s\S]*?if \(baseOpened\)[\s\S]*?confirmSelectedRoute\(platform, wv, chatId\)/,
  'saved-target helper must verify real selected UI even when base openChat reports success'
);

assert.match(
  routeSource,
  /routeConfirmed\(selected, current, chatId, window\.GeekBroadcastSafety\?\.sameChat\)/,
  'saved-target route confirmation must combine selected UI state with the shared chat identity comparator'
);

assert.match(
  routeSource,
  /throw new Error\('TG_CHAT_ROUTE_NOT_CONFIRMED:/,
  'unconfirmed saved-target routing must fail closed'
);

const routeScript = route.realRouteScript('123');
assert.match(routeScript, /querySelectorAll\('\.chat-list\.custom-scroll, \.custom-scroll'\)/,
  'fallback must evaluate candidate scroll containers rather than trusting the first chat-list element');
assert.match(routeScript, /filter\(list => list\.querySelector\('\.chat-item-clickable'\)\)/,
  'fallback must reject Telegram forum/topic lists that do not contain real chat rows');
assert.match(routeScript, /find\(visibleList\)/,
  'fallback should prefer the visible real chat list when multiple candidate lists are mounted');
assert.doesNotMatch(routeScript, /const list = document\.querySelector\('\.chat-list\.custom-scroll'\)/,
  'fallback must not blindly choose the first chat-list custom-scroll container');
assert.doesNotMatch(routeSource, /location\.hash\s*=/,
  'saved-target helper must never self-certify navigation by mutating location.hash');

console.log('TELEGRAM_BROADCAST_SAVED_ROUTE_HELPER_CONTRACT_OK');
