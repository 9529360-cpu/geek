'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

// BRT-20260829-TG-MANUAL-CONTAINMENT
// Real-client evidence:
// - 9b7007a / bebf776: ordinary/manual Telegram broadcast worked.
// - later saved-tag recovery candidates regressed ordinary/manual Telegram and
//   produced COMPOSER_FAILED:EMPTY in the real client.
// Containment contract: ordinary/manual targets retain the known-good fresh-list
// resolution and direct platform.openChat path. Only targets explicitly restored
// from a saved recipient tag may opt into the fail-closed saved-target helper.

assert.match(runtime,
  /const saved = savedRecipientTargets\(\);\s*targets = mergeCustomTargets\(chats, selectedChatIds\(\), saved\);/,
  'ordinary custom recipients must stay on the fresh list while saved-tag snapshots survive virtual-list eviction');
assert.match(runtime,
  /if \(ctx\.platform\.family !== 'telegram' \|\| target\?\.telegramSavedTarget !== true\) \{\s*return ctx\.platform\.openChat\(target\.id\);\s*\}/,
  'ordinary text sending must preserve the known-good direct platform.openChat path');
assert.match(runtime,
  /target\?\.telegramSavedTarget === true[\s\S]*?route\.openSavedTarget\(ctx\.platform, ctx\.wv, target\.id\)/,
  'only an explicit saved-tag target may use Telegram saved-target recovery');
assert.match(runtime,
  /TG_CHAT_ROUTE_NOT_CONFIRMED:HELPER_UNAVAILABLE/,
  'saved-tag routing must fail closed when its dedicated helper is unavailable');
assert.doesNotMatch(runtime, /telegramRouteFallback|resolveSavedTagSelection|selectedCustomIds|openTargetChat\(/,
  'retired global/fallback routing must not return');
assert.doesNotMatch(runtime, /location\.hash\s*=\s*targetHash/,
  'broadcast runtime must not self-certify Telegram navigation by mutating location.hash');
assert.match(app,
  /broadcastChats\.find\(c => c\.id === id\) \|\| broadcastSavedRecipientTargets\.get\(String\(id\)\)/,
  'saved Telegram recipients evicted from the virtual chat list must remain visible and removable in the editor');
assert.match(app,
  /broadcastSavedRecipientTargets\.delete\(String\(btn\.dataset\.id \|\| ''\)\)/,
  'removing a restored recipient chip must also revoke its saved-tag routing provenance');

console.log('BROADCAST_TELEGRAM_MANUAL_CONTAINMENT_OK');
