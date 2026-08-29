'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/broadcast-recipient-tags.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'broadcast-recipient-tags.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'ui', 'broadcast-safety.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');

assert.equal(api.isGroupId('123@g.us'), true);
assert.equal(api.isGroupId('123@c.us'), false);
assert.deepEqual(api.normalizeLabels([
  { id: 7, name: ' 客户 ', count: 3, hexColor: '#fff' },
  { id: '', name: 'bad' },
]), [{ id: '7', name: '客户', count: 3, hexColor: '#fff' }]);

assert.match(html, /name="bc-sendto" value="label"/, 'the pre-existing WhatsApp label audience entry remains the single product surface');
assert.match(html, /id="bc-label-select"/, 'the pre-existing WhatsApp label selector remains in place');
assert.doesNotMatch(source, /id = 'broadcast-recipient-tags'/, 'the accidental duplicate Geek-local tag panel must not be created again');
assert.match(source, /broadcast-recipient-tags'\)\?\.remove\(\)/, 'hot-reloaded renderers must remove the duplicate panel introduced by the previous candidate');
assert.match(source, /将当前已选联系人保存为标签/, 'the existing WhatsApp label section must expose the save action');
assert.match(source, /selectedContactIds/, 'saving must use the currently selected broadcast contacts');
assert.match(source, /!isGroupId\(id\)/, 'native contact labels must not silently include group ids');
assert.match(source, /W\.labels\.getAllLabels\(\)/, 'the UI must read WhatsApp native labels through WA-JS');
assert.match(source, /W\.labels\.addNewLabel\(wantedName\)/, 'saving a new name must create a WhatsApp native label');
assert.match(source, /W\.labels\.addOrRemoveLabels\(chatIds, \{ labelId, type: 'add' \}\)/, 'saving must attach selected contacts to the native label');
assert.match(source, /const after = await W\.labels\.getAllLabels\(\)/, 'saving must re-read WhatsApp after mutation');
assert.match(source, /if \(!verified\)/, 'success must be fail-closed unless the native label can be verified after saving');
assert.match(source, /await refreshLabels\(doc, labelId\)/, 'the existing label selector must refresh immediately after a successful save');
assert.match(source, /W\.profile\.isBusiness/, 'native label UX must handle WhatsApp Business capability explicitly');
assert.match(source, /保存群组集合/, 'the pre-existing group collection feature must be clearly distinguished from contact labels');
assert.ok(loader.indexOf("'./broadcast-product-closure.js'") < loader.indexOf("'./broadcast-recipient-tags.js'"), 'native label closure remains inside the bounded broadcast dependency chain');
assert.ok(loader.indexOf("'./broadcast-recipient-tags.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'native label closure must load before the final guard');
assert.doesNotMatch(source, /accountData\.set|savedLists|localStorage/, 'native WhatsApp labels must not be shadow-saved to a second Geek-local store');
assert.doesNotMatch(source, /scheduleTasks|sendTextMessage|authorizeSend/, 'contact-label UI must not execute scheduling or sending');

console.log('broadcast native contact labels contract: ok');
