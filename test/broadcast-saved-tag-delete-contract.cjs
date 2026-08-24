'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const start = source.indexOf('async function deleteBroadcastGroupTag(g) {');
const end = source.indexOf("document.getElementById('broadcast-saved-groups').onchange", start);
assert.ok(start >= 0 && end > start, 'deleteBroadcastGroupTag handler must exist');
const block = source.slice(start, end);

assert.match(
  block,
  /await accountStorageSetItem\('broadcastGroups', JSON\.stringify\(next\)\)/,
  'saved tag deletion must await account-scoped persistence'
);
assert.match(
  block,
  /if \(deleted === false\) \{ alert\('删除标签失败，请重试'\); return; \}[\s\S]*clearBroadcastGroupTagFilter\(\)/,
  'failed persistence must stop before clearing the active tag/filter'
);

console.log('BROADCAST_SAVED_TAG_DELETE_CONTRACT_OK');
