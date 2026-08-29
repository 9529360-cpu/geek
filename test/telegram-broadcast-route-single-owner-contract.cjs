'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const safetyPath = path.join(__dirname, '../ui/broadcast-safety.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const safetySource = fs.readFileSync(safetyPath, 'utf8');

// BRT-20260829-TG-SINGLE-ROUTE-OWNER
// Real-client evidence: validation head 1a0bb09 still fails after #254.
// Audit finding: app.js baseOpenChat can report success from location.hash alone,
// while #254 verified Telegram's real selected UI only when baseOpenChat returned false.
// A hash-only success must therefore never bypass real UI confirmation.

assert.doesNotMatch(
  routeSource,
  /if\s*\(await\s+baseOpenChat\(chatId\)\)\s*\{[\s\S]{0,220}?return\s+true\s*;/,
  'Telegram route wrapper must not accept baseOpenChat success without verifying the real selected chat UI'
);

assert.match(
  routeSource,
  /const baseOpened = await baseOpenChat\(chatId\);[\s\S]*?if \(baseOpened\)[\s\S]*?confirmSelectedRoute\(platform, wv, chatId\)/,
  'baseOpenChat may provide navigation intent, but real selected UI confirmation must authorize success'
);

assert.match(
  routeSource,
  /routeConfirmed\(selected, current, chatId, window\.GeekBroadcastSafety\?\.sameChat\)/,
  'Telegram route confirmation must combine selected UI state with the shared chat identity comparator'
);

assert.match(
  routeSource,
  /throw new Error\('TG_CHAT_ROUTE_NOT_CONFIRMED:/,
  'an unconfirmed dedicated Telegram route must throw instead of returning false to a legacy fallback'
);

assert.match(
  runtimeSource,
  /const opened = await ctx\.platform\.openChat\(target\.id\);/,
  'broadcast runtime must enter Telegram routing through the platform openChat owner first'
);

const routeLoad = safetySource.indexOf("loadScript('./telegram-broadcast-route.js'");
const runtimeLoad = safetySource.indexOf("loadScript('./broadcast-runtime.js'");
assert.ok(routeLoad >= 0 && runtimeLoad > routeLoad,
  'Telegram route boundary must start installing before the broadcast runtime is loaded');
assert.match(routeSource, /setInterval\([\s\S]*?install\(\)/,
  'Telegram route boundary must keep waiting for app.js to publish the platform factory');

// A legacy hash block remains in broadcast-runtime.js for compatibility with the
// pre-boundary implementation. Under the installed wrapper it is unreachable:
// openChat returns true only after real confirmation, otherwise it throws.
// The dedicated route module itself must never mutate location.hash.
assert.doesNotMatch(routeSource, /location\.hash\s*=/,
  'the active Telegram route owner must never self-certify navigation by mutating location.hash');

console.log('TELEGRAM_BROADCAST_ROUTE_SINGLE_OWNER_CONTRACT_OK');
