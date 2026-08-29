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
  /window\.GeekPlatformTransports\s*=|forAccount:\s*wrapped|__geekTelegramRouteAware/,
  'saved-tag Telegram routing must not globally replace GeekPlatformTransports.forAccount or ordinary openChat'
);

assert.match(
  runtimeSource,
  /if\s*\(ctx\.platform\.family\s*===\s*'telegram'\s*&&\s*target\.telegramRouteFallback\s*===\s*true\)[\s\S]{0,700}?GeekTelegramBroadcastRoute/,
  'special Telegram route recovery must be entered only for explicit saved-tag fallback targets'
);

assert.match(
  runtimeSource,
  /return\s+ctx\.platform\.openChat\(target\.id\);/,
  'ordinary/manual targets must keep the original platform.openChat path that was real-client proven'
);

console.log('TELEGRAM_BROADCAST_MANUAL_ROUTE_ISOLATION_CONTRACT_OK');
