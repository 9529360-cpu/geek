'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '../ui/app.js');
const source = fs.readFileSync(appPath, 'utf8');

const start = source.indexOf("document.getElementById('broadcast-save-group').onclick = async () => {");
const end = source.indexOf('function clearBroadcastGroupTagFilter()', start);
assert.ok(start >= 0 && end > start, 'saved broadcast group handler must exist');
const block = source.slice(start, end);

assert.match(
  block,
  /await accountStorageSetItem\('broadcastGroups', JSON\.stringify\(next\)\)/,
  'saved selection must await account-scoped persistence before applying UI state'
);
assert.match(
  block,
  /renderSavedGroups\(\);[\s\S]*savedGroups\.value = tag\.id/,
  'saved selection option must be rendered before selecting the new tag id'
);
assert.match(block, /正在保存…/, 'save button must expose an in-progress state');
assert.match(block, /已保存 ·/, 'save button must expose non-blocking success feedback');
assert.match(block, /保存失败，请重试/, 'persistence failure must be visible in place');
assert.doesNotMatch(block, /alert\(`已保存群组标签/, 'successful save must not restore the blocking system alert');

console.log('BROADCAST_SAVED_SELECTION_CONTRACT_OK');
