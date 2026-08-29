'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

// BRT-20260829-TG-MANUAL-ROUTE-ISOLATION
// Ordinary/manual Telegram broadcasting is the protected baseline. Saved-target
// route recovery may exist as a dormant helper, but the runtime must not call it
// or introduce any fallback flag/hash route while this containment is active.

assert.doesNotMatch(
  routeSource,
  /window\.GeekPlatformTransports\s*=|forAccount:\s*wrapped|__geekTelegramRouteAware|installWhenReady/,
  'saved-tag Telegram routing must not globally replace GeekPlatformTransports.forAccount or ordinary openChat'
);

assert.match(
  runtimeSource,
  /const opened = await ctx\.platform\.openChat\(target\.id\);\s*await new Promise\(resolve => setTimeout\(resolve, 900\)\);/,
  'ordinary/manual targets must use the real-client-proven direct platform.openChat path'
);

assert.doesNotMatch(runtimeSource, /telegramRouteFallback|openSavedTarget|openTargetChat\(/,
  'ordinary runtime must not opt into saved-target routing during containment');

assert.match(
  routeSource,
  /async function openSavedTarget\(platform, wv, chatId\)/,
  'saved-tag recovery may remain available only as a dormant explicit helper with no global installation side effect'
);

console.log('TELEGRAM_BROADCAST_MANUAL_ROUTE_ISOLATION_CONTRACT_OK');
