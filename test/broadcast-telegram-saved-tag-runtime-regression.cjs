'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');

// BRT-20260829-TG-MANUAL-CONTAINMENT
// Real-client evidence:
// - 9b7007a / bebf776: ordinary/manual Telegram broadcast worked.
// - later saved-tag recovery candidates regressed ordinary/manual Telegram and
//   produced COMPOSER_FAILED:EMPTY in the real client.
// Containment contract: restore the known-good ordinary target resolution and
// direct platform.openChat path. Saved-tag recovery remains intentionally out of
// the runtime until the ordinary path is proven again in a validation client.

assert.match(runtime,
  /const ids = new Set\(selectedChatIds\(\)\);\s*targets = chats\.filter\(chat => ids\.has\(String\(chat\.id\)\)\);/,
  'custom recipients must be resolved only from the fresh platform chat list on the known-good manual path');
assert.match(runtime,
  /const opened = await ctx\.platform\.openChat\(target\.id\);\s*await new Promise\(resolve => setTimeout\(resolve, 900\)\);/,
  'ordinary text sending must use the known-good direct platform.openChat path');
assert.doesNotMatch(runtime, /telegramRouteFallback|resolveSavedTagSelection|selectedCustomIds|openTargetChat\(/,
  'saved-tag recovery must not alter ordinary Telegram runtime behavior during containment');
assert.doesNotMatch(runtime, /location\.hash\s*=\s*targetHash/,
  'broadcast runtime must not self-certify Telegram navigation by mutating location.hash');

console.log('BROADCAST_TELEGRAM_MANUAL_CONTAINMENT_OK');
