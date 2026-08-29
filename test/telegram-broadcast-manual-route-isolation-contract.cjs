'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

// BRT-20260829-TG-MANUAL-ROUTE-ISOLATION
// Real-client boundary:
// - ordinary/manual Telegram broadcasting was confirmed working before saved-tag
//   route recovery was introduced;
// - saved-tag work must not replace the platform openChat implementation used by
//   ordinary/manual recipients.

assert.doesNotMatch(
  routeSource,
  /window\.GeekPlatformTransports\s*=|forAccount:\s*wrapped|__geekTelegramRouteAware|installWhenReady/,
  'saved-tag Telegram routing must not globally replace GeekPlatformTransports.forAccount or ordinary openChat'
);

assert.match(
  runtimeSource,
  /const opened = await ctx\.platform\.openChat\(target\.id\);[\s\S]{0,260}?target\.telegramRouteFallback !== true\) return opened;/,
  'ordinary/manual targets must return from the original platform.openChat path unless an explicit saved-tag fallback is required'
);

assert.match(
  routeSource,
  /async function openSavedTarget\(platform, wv, chatId\)/,
  'saved-tag recovery may remain available only as an explicit helper with no global installation side effect'
);

console.log('TELEGRAM_BROADCAST_MANUAL_ROUTE_ISOLATION_CONTRACT_OK');
