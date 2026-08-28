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
const baseData = {
  scheduleTasks: JSON.stringify([
    { id: 'group-task', time: future, message: 'hello', groupId: 'g1' },
    { id: 'named-task', time: future, message: 'hello %nc', groupId: 'g1' },
    { id: 'current-task', time: future, message: 'review me', groupId: '' },
  ]),
  broadcastGroups: JSON.stringify([{ id: 'g1', name: 'Group Set', chatIds: ['chat-1', 'chat-2'] }]),
  broadcastJobSchedules: '[]',
};
const converted = api.migrateRecords(account, baseData);

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

const safetyReview = api.interruptedReview(converted.legacy, converted.needsReview);
assert.ok(safetyReview.some(item => item.id === 'group-task' && /迁移曾被中断/.test(item.reason)), 'otherwise-migratable legacy task needs a durable fail-closed review record before disabling old execution');

assert.match(source, /accountData\.set\(account\.id, BACKUP_KEY/, 'legacy tasks must be backed up before clearing');
assert.ok(source.indexOf('BACKUP_KEY, JSON.stringify(backup)') < source.indexOf("OLD_KEY, '[]'"), 'backup must be durable before legacy key is cleared');
assert.ok(source.indexOf('REVIEW_KEY, JSON.stringify(safetyReview)') < source.indexOf("OLD_KEY, '[]'"), 'conservative recovery notice must be durable before old execution is disabled');
assert.ok(source.indexOf("OLD_KEY, '[]'") < source.indexOf('NEW_KEY, JSON.stringify(result.migrated)'), 'legacy execution must be disabled before new executable schedules are published');
assert.match(source, /legacyDisabled = true/, 'migration must remember when old execution has been disabled');
assert.match(source, /return \{ changed: true, review: safetyReview\.length, interrupted: true \}/, 'interruption after disabling old execution must still force in-memory legacy timer cleanup');
assert.match(source, /usesRecipientNameVariables\(task\.message\)/, 'legacy name variables must fail closed when names were not persisted');
assert.match(source, /targets: ids\.map\(chatId => \(\{ id: chatId, name: '' \}\)\)/, 'legacy chat IDs must not become personalization names');
assert.match(source, /document\.querySelector\('\.nav-account\.active \.nav-account-main'\)\?\.click\(\)/, 'migration must reselect current account so legacy timer registry clears through its own reload path');
assert.match(source, /#broadcast-add-schedule,#broadcast-schedule-list\{display:none!important\}/, 'deprecated multi-message schedule UI must not create new legacy timers');
assert.ok(loader.indexOf("'./broadcast-legacy-schedule-migration.js'") < loader.indexOf("'./broadcast-schedule-persistence.js'"), 'legacy migration must load before new schedule recovery');

(async () => {
  const writes = [];
  global.window = {
    api: {
      accountData: {
        getAll: async () => ({ ...baseData }),
        set: async (_accountId, key, value) => {
          writes.push({ key, value });
          if (key === api.NEW_KEY) throw new Error('simulated new-schedule write failure');
          return true;
        },
      },
    },
  };
  const result = await global.window.GeekBroadcastLegacyScheduleMigration?.migrateAccount?.(account)
    || await (async () => {
      // The CommonJS export intentionally exposes pure helpers only; evaluate the browser
      // module in a tiny VM-like reload with window present to reach migrateAccount.
      delete require.cache[require.resolve(migrationPath)];
      require(migrationPath);
      return global.window.GeekBroadcastLegacyScheduleMigrationInstance?.migrateAccount?.(account);
    })();

  // Static ordering above is the durable contract; this guard ensures our simulated
  // write trace cannot ever publish NEW_KEY before OLD_KEY is disabled.
  const oldIndex = writes.findIndex(item => item.key === api.OLD_KEY && item.value === '[]');
  const newIndex = writes.findIndex(item => item.key === api.NEW_KEY);
  assert.ok(oldIndex >= 0 && newIndex > oldIndex, 'interrupted migration must disable legacy execution before attempting new executable schedules');
  if (result) assert.equal(result.interrupted, true);
  delete global.window;
  console.log('BROADCAST_LEGACY_SCHEDULE_MIGRATION_CONTRACT_OK');
})().catch(error => {
  delete global.window;
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
