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
// A saved recipient tag is only a shortcut that restores the same app-owned
// selection as manual clicks. The Job/runtime/transport must not retain or branch
// on tag provenance.

assert.match(runtime,
  /if \(mode === 'custom'\) \{\s*targets = selectedTargets\(\);/,
  'manual clicks and restored tags must enter the same canonical custom selection path');
assert.match(app,
  /window\.__broadcastSelectedTargets = \(\) => \[\.\.\.broadcastSelected\]/,
  'app.js must remain the single owner of the canonical recipient selection');
assert.match(runtime,
  /const opened = await ctx\.platform\.openChat\(target\.id\);\s*await new Promise\(resolve => setTimeout\(resolve, 900\)\);/,
  'ordinary text sending must use the known-good direct platform.openChat path');
assert.doesNotMatch(runtime, /telegramSavedTarget|savedRecipientTargets|openSavedTarget|telegramRouteFallback|resolveSavedTagSelection|openTargetChat\(/,
  'runtime must not know whether a recipient came from a saved tag');
assert.doesNotMatch(runtime, /location\.hash\s*=\s*targetHash/,
  'broadcast runtime must not self-certify Telegram navigation by mutating location.hash');

console.log('BROADCAST_TELEGRAM_MANUAL_CONTAINMENT_OK');
