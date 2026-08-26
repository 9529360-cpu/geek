'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../ui/broadcast-original.css'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '../ui/broadcast-runtime.js'), 'utf8');

assert.match(html, /id="bc-sender-account"/, 'editor must identify the sending account');
assert.match(html, /id="bc-footer-summary"[^>]*aria-live="polite"/, 'editor must expose a persistent live summary');
assert.match(app, /selected\.slice\(0, 3\)/, 'selected chips must be capped so the modal cannot grow without bound');
assert.match(app, /另 \$\{selected\.length - visible\.length\} 个/, 'hidden selected chips must be represented by a count');
assert.doesNotMatch(app, /visibleBroadcastChats\(\)\.filter\(c => !broadcastSelected\.has\(c\.id\)\)/, 'selected recipients must remain available for direct unchecking');
assert.match(app, /__geekBroadcastSelection = Object\.freeze/, 'the editor must expose its complete selection independently of rendered chips');
assert.match(runtime, /__geekBroadcastSelection\?\.ids\?\.\(\)/, 'runtime must consume the complete editor selection');
assert.doesNotMatch(runtime, /querySelectorAll\('#bc-selected-chips/, 'runtime must never infer recipients from visible chips');
assert.match(runtime, /mode === 'exclude-contacts'.*targets = chats\.slice\(\)/, 'exclude modes must begin from a complete recipient set');
const allModeStart = app.indexOf("if (v === 'all-contacts' || v === 'all-groups' || v === 'all')");
const allModeBlock = app.slice(allModeStart, app.indexOf('updateBroadcastComposerSummary();', allModeStart));
assert.ok(allModeStart >= 0, 'all-recipient mode handler must exist');
assert.doesNotMatch(allModeBlock, /\bq\b|toLowerCase\(\)/, 'all-recipient modes must not be narrowed by stale search text');
assert.match(app, /内容已就绪.*targetText.*秒间隔/, 'footer summary must cover content, recipients, and interval');
assert.match(css, /\.bc-sender-account/, 'sending-account badge must be styled by the formal editor stylesheet');

console.log('BROADCAST_COMPLETION_UX_CONTRACT_OK');
