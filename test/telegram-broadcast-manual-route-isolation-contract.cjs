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
// route recovery may be called only for an explicitly saved-tag target and must
// never replace or decorate the ordinary platform transport.

assert.doesNotMatch(
  routeSource,
  /window\.GeekPlatformTransports\s*=|forAccount:\s*wrapped|__geekTelegramRouteAware|installWhenReady/,
  'saved-tag Telegram routing must not globally replace GeekPlatformTransports.forAccount or ordinary openChat'
);

assert.match(
  runtimeSource,
  /if \(ctx\.platform\.family !== 'telegram' \|\| target\?\.telegramSavedTarget !== true\) \{\s*return ctx\.platform\.openChat\(target\.id\);\s*\}/,
  'ordinary/manual targets must use the real-client-proven direct platform.openChat path'
);

assert.match(runtimeSource,
  /target\?\.telegramSavedTarget === true[\s\S]*?route\.openSavedTarget\(ctx\.platform, ctx\.wv, target\.id\)/,
  'only an explicit saved-tag target may opt into the dedicated recovery helper');

assert.doesNotMatch(runtimeSource, /telegramRouteFallback|openTargetChat\(/,
  'retired implicit fallback routing must remain absent');

assert.match(
  routeSource,
  /async function openSavedTarget\(platform, wv, chatId\)/,
  'saved-tag recovery must remain an explicit helper with no global installation side effect'
);

console.log('TELEGRAM_BROADCAST_MANUAL_ROUTE_ISOLATION_CONTRACT_OK');
