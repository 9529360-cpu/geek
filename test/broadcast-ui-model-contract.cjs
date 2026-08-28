'use strict';

const assert = require('node:assert/strict');
const model = require('../ui/broadcast-ui-model.js');

(async () => {
  assert.deepEqual(model.normalizeMessages('not json'), []);
  assert.deepEqual(model.normalizeMessages([
    null,
    { name: ' Welcome ', msg: 'first' },
    { name: '', msg: 'invalid' },
    { name: 'Welcome', msg: 'latest' },
  ]), [{ name: 'Welcome', msg: 'latest' }]);
  assert.deepEqual(model.upsertMessage([{ name: 'A', msg: '1' }], { name: 'A', msg: '2' }), [{ name: 'A', msg: '2' }]);
  assert.deepEqual(model.removeMessage([{ name: 'A', msg: '1' }, { name: 'B', msg: '2' }], 'A'), [{ name: 'B', msg: '2' }]);

  const normalizedGroups = model.normalizeGroupTags([{ name: '客户群', chatIds: ['g1', 'g1', '', 'g2'] }]);
  assert.equal(normalizedGroups.length, 1);
  assert.deepEqual(normalizedGroups[0].chatIds, ['g1', 'g2']);
  assert.ok(normalizedGroups[0].id);
  const overwritten = model.upsertGroupTag(normalizedGroups, { name: '客户群', chatIds: ['g3'] }, 2000);
  assert.equal(overwritten.tag.id, normalizedGroups[0].id, 'same-name overwrite must preserve stable tag identity');
  assert.deepEqual(overwritten.tag.chatIds, ['g3']);

  const chats = [
    { id: 'contact-1', type: '联系人' },
    { id: 'group-1', type: '群组' },
    { id: 'group-2', type: '群组' },
  ];
  assert.deepEqual(model.resolveAudience({ mode: 'all', chats, selectedIds: ['contact-1'] }).map(chat => chat.id), ['contact-1', 'group-1', 'group-2']);
  assert.deepEqual(model.resolveAudience({ mode: 'all-groups', chats }).map(chat => chat.id), ['group-1', 'group-2']);
  assert.deepEqual(model.resolveAudience({ mode: 'exclude-groups', chats, selectedIds: ['contact-1'], excludedIds: ['group-1'] }).map(chat => chat.id), ['contact-1', 'group-2']);

  const original = [{ name: 'A', msg: 'old' }];
  const rejected = await model.persistBeforeCommit([{ name: 'A', msg: 'new' }], async () => false);
  assert.equal(rejected.ok, false);
  assert.deepEqual(original, [{ name: 'A', msg: 'old' }], 'a rejected persistence operation must not mutate current UI state');
  const accepted = await model.persistBeforeCommit([{ name: 'A', msg: 'new' }], async () => true);
  assert.equal(accepted.ok, true);

  console.log('BROADCAST_UI_MODEL_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
