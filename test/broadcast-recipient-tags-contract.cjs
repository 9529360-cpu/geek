'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/broadcast-recipient-tags.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'broadcast-recipient-tags.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.deepEqual(api.parsePresets('[{"name":" 客户A ","ids":["1","1","2",""]}]'), [
  { name: '客户A', ids: ['1', '2'] },
]);
assert.deepEqual(api.parsePresets('bad-json'), []);

assert.match(html, /class="bc-inline-group-save"/, 'the visible row directly under the recipient picker must remain present');
assert.match(html, /id="broadcast-save-group"/, 'the visible save button directly under the recipient picker must remain present');
assert.match(source, /querySelector\('\.bc-inline-group-save'\)/, 'recipient tags must bind to the row the user actually sees');
assert.match(source, /getElementById\('broadcast-save-group'\)/, 'the visible save button must be the public tag action');
assert.match(source, /publicSave\.textContent = '＋ 保存为标签'/, 'the public action must clearly describe custom tag saving');
assert.match(source, /broadcast-recipient-tag-list/, 'saved audiences must render as visible clickable tags in that same row');
assert.match(source, /broadcast-recipient-tag-status/, 'the action path must expose visible runtime status instead of failing silently');

assert.match(html, /id="bc-save-list"/, 'the legacy app.js saved-list owner remains available internally');
assert.match(source, /ownerRow\.style\.display = 'none'/, 'the old hidden saved-list row must not become a second user-facing surface');
assert.match(source, /invokeOwnerHandler\(controls\.ownerSave\)/, 'saving must call the app.js state owner directly, not synthesize another click');
assert.match(app, /const name = prompt\('保存为（列表名称）：'/, 'the state owner must prompt for a custom tag name');
assert.match(app, /savedLists\.push\(\{ name, ids: \[\.\.\.broadcastSelected\] \}\)/, 'the owner must save both contacts and groups from the real selection set');
assert.match(app, /accountStorageSetItem\('savedLists'/, 'the owner must persist tags in account-scoped storage');
assert.match(source, /accountData\.getAll\(accountId\)/, 'the visible flow must verify durable current-account storage');

assert.match(source, /clear\.onclick\.call\(clear\)/, 'applying a tag must clear stale manual recipients before restore');
assert.match(source, /ownerSelect\.onchange\.call\(controls\.ownerSelect\)/, 'applying a tag must restore through the app.js owner');
assert.match(source, /ownerDelete/, 'deletion must reuse the established owner path');

assert.doesNotMatch(source, /addEventListener\('click'[\s\S]*true\)/, 'recipient tags must not use a capture-phase click interceptor');
const publicSaveBinding = source.match(/controls\.publicSave\.onclick = \(\) => \{([\s\S]*?)\};/);
assert.ok(publicSaveBinding, 'the visible public save button must have a direct onclick binding');
assert.doesNotMatch(publicSaveBinding[1], /preventDefault|stopPropagation|stopImmediatePropagation/, 'the public save action must not swallow its own click');
assert.doesNotMatch(source, /W\.labels|WAWebLabelCollection|addNewLabel|addOrRemoveLabels/, 'broadcast tags must never mutate WhatsApp-native labels');
assert.doesNotMatch(source, /sendTextMessage|authorizeSend|scheduleTasks/, 'recipient-tag UI must not execute sending or scheduling');

assert.equal(api.invokeOwnerHandler(null), false);
let calls = 0;
assert.equal(api.invokeOwnerHandler({ onclick() { calls += 1; } }), true);
assert.equal(calls, 1, 'the owner save handler must be invoked exactly once');

console.log('broadcast recipient visible tag workflow contract: ok');
