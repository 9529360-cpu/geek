'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routePath = path.join(__dirname, '../ui/telegram-broadcast-route.js');
const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

// BRT-20260829-TG-SINGLE-ROUTE-OWNER
// Real-client evidence: validation head 1a0bb09 still fails after #254.
// Audit finding: app.js baseOpenChat can report success from location.hash alone,
// while #254 verifies Telegram's real selected UI only when baseOpenChat returns false.
// A hash-only success must therefore never bypass real UI confirmation.

assert.doesNotMatch(
  routeSource,
  /if\s*\(await\s+baseOpenChat\(chatId\)\)\s*\{[\s\S]{0,220}?return\s+true\s*;/,
  'Telegram route wrapper must not accept baseOpenChat success without verifying the real selected chat UI'
);

assert.match(
  routeSource,
  /routeConfirmed\(/,
  'Telegram route wrapper must retain selected-UI plus chat-identity confirmation'
);

assert.doesNotMatch(
  runtimeSource,
  /location\.hash\s*=\s*targetHash/,
  'broadcast runtime must not retain a second Telegram hash-routing owner after the dedicated route boundary is installed'
);

assert.doesNotMatch(
  runtimeSource,
  /telegramRouteFallback[\s\S]{0,900}?location\.hash\s*=/,
  'saved-tag Telegram fallback must never self-certify navigation by mutating location.hash'
);

console.log('TELEGRAM_BROADCAST_ROUTE_SINGLE_OWNER_CONTRACT_OK');
