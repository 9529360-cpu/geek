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
assert.match(source, /row\.style\.display = 'flex'/, 'the canonical plugin saved-list row must be made visible');
assert.match(source, /select\.style\.display = ''/, 'the canonical saved-list selector must be visible');
assert.match(source, /save\.style\.display = ''/, 'the canonical save action must be visible');
assert.match(source, /群发名单标签/, 'the product surface must clearly describe reusable broadcast recipient tags');
assert.match(source, /保存当前名单/, 'the save action must clearly save the current broadcast audience');
assert.match(source, /broadcast-recipient-tags'\)\?\.remove\(\)/, 'the accidental duplicate Geek recipient-tag panel must be removed');
assert.match(source, /broadcast-native-label-helper'\)\?\.remove\(\)/, 'the mistaken WhatsApp-native label helper must be removed');
assert.doesNotMatch(source, /W\.labels|WAWebLabelCollection|addNewLabel|addOrRemoveLabels/, 'broadcast saved-list tags must not mutate WhatsApp native labels');
assert.match(app, /savedLists\.push\(\{ name, ids: \[\.\.\.broadcastSelected\] \}\)/, 'the established plugin model must store the current selected chats');
assert.match(closure, /accountData\.set\(accountId, 'savedLists'/, 'saved broadcast tags must persist in current-account durable storage');
assert.match(source, /accountData\.getAll\(accountId\)/, 'the visible tag surface must verify current-account durable state');
assert.match(source, /clear\.onclick\.call\(clear\)/, 'applying a saved tag must clear stale manual recipients first');
assert.match(source, /legacyApply\.call\(controls\.select\)/, 'exact restore must continue through the established plugin renderer');
assert.doesNotMatch(source, /sendTextMessage|authorizeSend|scheduleTasks/, 'recipient-tag UI must not execute sending or scheduling');
assert.ok(loader.indexOf("'./broadcast-product-closure.js'") < loader.indexOf("'./broadcast-recipient-tags.js'"), 'recipient tag UX must load after durable product closure');
assert.ok(loader.indexOf("'./broadcast-recipient-tags.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'recipient tag UX remains inside the bounded broadcast dependency chain');

console.log('broadcast saved recipient tags contract: ok');
