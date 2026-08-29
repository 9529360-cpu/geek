'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/broadcast-recipient-tags.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'broadcast-recipient-tags.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'ui', 'broadcast-safety.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const closure = fs.readFileSync(path.join(root, 'ui', 'broadcast-product-closure.js'), 'utf8');

assert.deepEqual(api.parsePresets('[{"name":" 客户A ","ids":["1","1","2",""]}]'), [
  { name: '客户A', ids: ['1', '2'] },
]);
assert.deepEqual(api.parsePresets('bad-json'), []);

assert.match(html, /class="bc-saved-row"/, 'the original broadcast plugin saved-list row remains the canonical product surface');
assert.match(html, /id="bc-saved-lists"/, 'the original saved-list selector remains in the editor');
assert.match(html, /id="bc-save-list"/, 'the original save-list action remains in the editor');
assert.match(source, /row\.style\.display = 'grid'/, 'the canonical plugin saved-list row must be visible');
assert.match(source, /select\.style\.display = 'none'/, 'the legacy select remains an internal state bridge rather than a second visible picker');
assert.match(source, /保存当前名单/, 'the canonical save action must be visible');
assert.match(source, /群发名单标签/, 'the surface must clearly describe reusable broadcast audience tags');
assert.match(source, /broadcast-recipient-tag-list/, 'saved audiences must render as clickable custom tag chips');
assert.match(source, /runOwnerSave\(save, doc\)/, 'the visible save button must have an explicit click path');
assert.match(source, /button\.onclick\.call\(button\)/, 'the explicit path must call the app.js state owner exactly once');
assert.match(app, /const name = prompt\('保存为（列表名称）：'/, 'the state owner must prompt for a custom tag name');
assert.match(app, /savedLists\.push\(\{ name, ids: \[\.\.\.broadcastSelected\] \}\)/, 'the state owner must save exactly the current broadcast recipients');
assert.match(app, /accountStorageSetItem\('savedLists'/, 'the owner must persist saved broadcast audiences in account-scoped storage');
assert.match(source, /accountData\.getAll\(accountId\)/, 'the visible tag surface must verify durable current-account state after save');
assert.match(source, /clear\.onclick\.call\(clear\)/, 'applying a saved tag must clear stale manual recipients first');
assert.match(source, /controls\.select\.onchange\.call\(controls\.select\)/, 'tag application must reuse the app.js owner to restore the saved audience');
assert.match(source, /controls\.remove\.onclick\.call\(controls\.remove\)/, 'tag deletion must reuse the app.js owner');
assert.doesNotMatch(source, /W\.labels|WAWebLabelCollection|addNewLabel|addOrRemoveLabels/, 'broadcast tags must never mutate WhatsApp-native labels');
assert.doesNotMatch(source, /sendTextMessage|authorizeSend|scheduleTasks/, 'recipient-tag UI must not execute sending or scheduling');
assert.ok(loader.indexOf("'./broadcast-recipient-tags.js'") < loader.indexOf("'./broadcast-product-closure.js'"), 'recipient tag owner interception must install before the obsolete closure replay listener');
assert.ok(loader.indexOf("'./broadcast-product-closure.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'product closure and recipient tags remain inside the bounded broadcast dependency chain');
assert.match(closure, /stopImmediatePropagation\(\)/, 'legacy closure interception remains present but must be preempted by the owner-first tag listener');

console.log('broadcast recipient tag owner contract: ok');
