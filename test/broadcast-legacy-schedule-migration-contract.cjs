'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '../ui/broadcast-legacy-schedule-migration.js');
const loaderPath = path.join(__dirname, '../ui/broadcast-safety.js');
const source = fs.readFileSync(migrationPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const api = require(migrationPath);

const future = new Date(Date.now() + 60_000).toISOString();
const account = { id: 'A', name: 'Account A', partition: 'persist:a' };
const converted = api.migrateRecords(account, {
  scheduleTasks: JSON.stringify([
    { id: 'group-task', time: future, message: 'hello', groupId: 'g1' },
    { id: 'named-task', time: future, message: 'hello %nc', groupId: 'g1' },
    { id: 'current-task', time: future, message: 'review me', groupId: '' },
  ]),
  broadcastGroups: JSON.stringify([{ id: 'g1', name: 'Group Set', chatIds: ['chat-1', 'chat-2'] }]),
  broadcastJobSchedules: '[]',
});

assert.equal(converted.legacy.length, 3);
assert.equal(converted.migrated.length, 1, 'legacy task with persisted IDs and no name variables should migrate');
assert.deepEqual(converted.migrated[0].targets.map(item => item.id), ['chat-1', 'chat-2']);
assert.deepEqual(converted.migrated[0].targets.map(item => item.name), ['', ''], 'legacy IDs must never be reused as recipient display names');
assert.equal(converted.migrated[0].accountId, 'A');
assert.equal(converted.needsReview.length, 2, 'unknown recipients and name-variable jobs must require review');
assert.ok(converted.needsReview.some(item => item.id === 'current-task' && /未持久化收件人/.test(item.reason)));
assert.ok(converted.needsReview.some(item => item.id === 'named-task' && /联系人名称变量/.test(item.reason)));
assert.equal(api.usesRecipientNameVariables('hello %nc'), true);
assert.equal(api.usesRecipientNameVariables('hello %NR'), true);
assert.equal(api.usesRecipientNameVariables('hello %sa'), false);

assert.match(source, /accountData\.set\(account\.id, BACKUP_KEY/, 'legacy tasks must be backed up before clearing');
assert.ok(source.indexOf('BACKUP_KEY, JSON.stringify(backup)') < source.indexOf("OLD_KEY, '[]'"), 'backup must be durable before legacy key is cleared');
assert.match(source, /accountData\.set\(account\.id, REVIEW_KEY/, 'unrecoverable recipient semantics must be preserved for user review');
assert.match(source, /usesRecipientNameVariables\(task\.message\)/, 'legacy name variables must fail closed when names were not persisted');
assert.match(source, /targets: ids\.map\(chatId => \(\{ id: chatId, name: '' \}\)\)/, 'legacy chat IDs must not become personalization names');
assert.match(source, /document\.querySelector\('\.nav-account\.active \.nav-account-main'\)\?\.click\(\)/, 'migration must reselect current account so legacy timer registry clears through its own reload path');
assert.match(source, /#broadcast-add-schedule,#broadcast-schedule-list\{display:none!important\}/, 'deprecated multi-message schedule UI must not create new legacy timers');
assert.ok(loader.indexOf("'./broadcast-legacy-schedule-migration.js'") < loader.indexOf("'./broadcast-schedule-persistence.js'"), 'legacy migration must load before new schedule recovery');

console.log('BROADCAST_LEGACY_SCHEDULE_MIGRATION_CONTRACT_OK');
