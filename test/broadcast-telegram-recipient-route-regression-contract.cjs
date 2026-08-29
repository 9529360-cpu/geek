'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BRT-20260829-TG-RECIPIENT-ROUTE
// Real-client regression sequence:
// 1) 9b7007a: manual TG recipients sent, saved-tag recipients failed.
// 2) 8eca203: bypassing the second chat-list filter made even manual TG recipients fail.
// The durable contract is one selected-state owner plus a TG route that does not require
// the target row to remain mounted in Telegram's virtualized chat list.

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '../ui/broadcast-runtime.js'), 'utf8');

assert.match(app, /window\.__geekBroadcastSelectedTargets\s*=\s*\(\)\s*=>/, 'app.js must expose a read-only snapshot from the real broadcastSelected owner');
assert.match(app, /\[\.\.\.broadcastSelected\]/, 'selected target snapshot must originate from broadcastSelected');
assert.match(app, /broadcastChats\.find\(chat => chat\.id === id\)/, 'the owner snapshot should preserve known chat metadata when available');

assert.match(runtime, /window\.__geekBroadcastSelectedTargets/, 'runtime custom mode must consume the app.js state-owner snapshot');
assert.doesNotMatch(runtime, /function selectedChatTargets\(\)[\s\S]*#bc-selected-chips/, 'runtime must not infer the authoritative custom audience back from rendered chips');
assert.match(runtime, /const refreshed = await ctx\.platform\.listChats\(\)/, 'TG custom mode keeps the previously working platform readiness/list refresh');
assert.match(runtime, /mergeSelectedTargets\(selected, refreshed\)/, 'fresh platform rows may enrich metadata but must not filter selected ids');

assert.match(app, /const targetHash = '#' \+ targetId/, 'Telegram switchChat must be able to route by the saved href id');
assert.match(app, /location\.hash = targetHash/, 'Telegram switchChat must not require a virtualized chat row to stay mounted');
assert.match(app, /if \(a\) \{[\s\S]*return true;[\s\S]*\}[\s\S]*location\.hash = targetHash/, 'existing mounted-row pointer behavior remains first choice, with hash routing only as fallback');
assert.match(app, /GeekBroadcastSafety\.sameChat\(current, chatId\)/, 'all TG navigation still requires the existing same-chat authorization before sending');

console.log('BROADCAST_TELEGRAM_RECIPIENT_ROUTE_REGRESSION_OK');
