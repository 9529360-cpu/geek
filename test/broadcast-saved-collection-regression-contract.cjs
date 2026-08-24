'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../ui/broadcast-saved-collection-feedback.js');
const loaderPath = path.join(__dirname, '../ui/broadcast-safety.js');
const source = fs.readFileSync(modulePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const api = require(modulePath);

const original = [
  { id: 'a', name: '旧集合', chatIds: ['1'], updatedAt: 100 },
  { id: 'b', name: '另一个集合', chatIds: ['2'], updatedAt: 200 },
];
const before = api.snapshot(original);
assert.equal(api.changedGroup(original, before), null, 'unchanged persisted data must not produce a false save success');

const added = [...original, { id: 'c', name: '新集合', chatIds: ['3', '4'], updatedAt: 300 }];
assert.equal(api.changedGroup(added, before)?.id, 'c', 'a newly persisted collection must be detected');

const updated = original.map(group => group.id === 'a' ? { ...group, chatIds: ['1', '3'], updatedAt: 400 } : group);
assert.equal(api.changedGroup(updated, before)?.id, 'a', 'updating a same-name persisted collection must be detected');

assert.deepEqual(api.parseGroups('{broken'), [], 'corrupt saved collection data must fail closed');
assert.deepEqual(api.parseGroups(JSON.stringify({ nope: true })), [], 'non-array saved collection data must fail closed');

assert.match(source, /window\.api\?\.accountData\?\.getAll/, 'save confirmation must verify the durable account sandbox rather than renderer memory only');
assert.match(source, /const beforePromise = persistedGroups\(accountId\)\.then\(snapshot\)/,
  'save confirmation must capture a durable pre-click baseline');
assert.match(source, /void beforePromise\.then\(before =>[\s\S]*settleSave\(accountId, before\)/,
  'post-click verification must wait for the durable baseline before looking for changes');
assert.match(source, /\[\.\.\.select\.options\]\.find\(item => String\(item\.value\) === id\)/,
  'the saved dropdown may be selected only after the persisted option exists');
assert.match(source, /select\.value = id;[\s\S]*dispatchEvent\(new Event\('change'/,
  'confirmed saved collection must become the active collection using the existing change semantics');
assert.match(source, /已保存「\$\{String\(changed\.name/, 'successful persistence must produce inline product feedback');
assert.doesNotMatch(source, /alert\(/, 'saved collection confirmation must not restore a system success alert');
assert.match(loader, /broadcast-saved-collection-feedback\.js/, 'the saved collection verifier must be loaded in the broadcast runtime bundle');

console.log('BROADCAST_SAVED_COLLECTION_REGRESSION_CONTRACT_OK');
