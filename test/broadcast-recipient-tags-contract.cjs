'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/broadcast-recipient-tags.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/broadcast-recipient-tags.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'ui/broadcast-safety.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

assert.deepEqual(api.parsePresets('[{"name":" Team A ","ids":["1","1","2",""]}]'), [
  { name: 'Team A', ids: ['1', '2'] },
]);
assert.deepEqual(api.parsePresets('bad-json'), []);
assert.equal(api.presetKey({ name: 'A', ids: ['1', '2'] }), 'A\u00001\u00012');

assert.match(html, /id="bc-saved-lists"[^>]*style="display:none"/, 'legacy saved-list controls stay hidden from product UI');
assert.match(source, /id = 'broadcast-recipient-tags'/, 'a visible recipient tag surface must exist');
assert.match(source, /保存当前选择为标签/, 'recipient tag surface must expose an explicit save action');
assert.match(source, /accountData\.getAll\(accountId\)/, 'tags must read from account-scoped durable storage');
assert.match(source, /accountData\.set\(accountId, 'savedLists'/, 'tag deletion must write through account-scoped durable storage');
assert.match(source, /closure\.persistRecipientPreset\(legacySave\)/, 'tag saving must reuse the product closure durable save path');
assert.match(source, /clear\.onclick\.call\(clear\)/, 'applying a tag must replace stale manual recipients rather than silently unioning them');
assert.match(source, /select\.onchange\.call\(select\)/, 'applying a tag must reuse the established broadcast selection renderer');
assert.match(source, /bc-original-tag__remove/, 'saved tags must be individually removable');
assert.ok(loader.indexOf("'./broadcast-product-closure.js'") < loader.indexOf("'./broadcast-recipient-tags.js'"), 'recipient tags must load after durable preset closure');
assert.ok(loader.indexOf("'./broadcast-recipient-tags.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'recipient tags must remain inside the bounded broadcast dependency chain');
assert.doesNotMatch(source, /localStorage/, 'recipient tag closure must not create a parallel global storage path');
assert.doesNotMatch(source, /scheduleTasks|sendTextMessage|authorizeSend/, 'recipient tag UI must not execute scheduling or sending');

console.log('broadcast recipient tags contract: ok');
