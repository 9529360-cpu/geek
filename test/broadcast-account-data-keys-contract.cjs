'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACCOUNT_DATA_KEYS } = require('../src/account-data-store.cjs');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('../src/broadcast-account-data-keys.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const persistence = fs.readFileSync(path.join(root, 'ui/broadcast-schedule-persistence.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'ui/broadcast-legacy-schedule-migration.js'), 'utf8');

const expected = [
  'broadcastJobSchedules',
  'broadcastLegacyScheduleBackup',
  'broadcastLegacyScheduleNeedsReview',
  'broadcastScheduleMigrationV2',
];
assert.deepEqual([...BROADCAST_ACCOUNT_DATA_KEYS], expected);
assert.equal(new Set([...ACCOUNT_DATA_KEYS, ...BROADCAST_ACCOUNT_DATA_KEYS]).size, ACCOUNT_DATA_KEYS.length + expected.length, 'broadcast keys must extend rather than collide with the stable account-data allowlist');
assert.match(main, /allowedKeys:\s*\[\.\.\.ACCOUNT_DATA_KEYS, \.\.\.BROADCAST_ACCOUNT_DATA_KEYS\]/, 'main composition must inject the broadcast key extension into the unique account-data owner');
assert.match(persistence, /const STORAGE_KEY = 'broadcastJobSchedules'/);
assert.match(migration, /const BACKUP_KEY = 'broadcastLegacyScheduleBackup'/);
assert.match(migration, /const REVIEW_KEY = 'broadcastLegacyScheduleNeedsReview'/);
assert.match(migration, /const MARKER_KEY = 'broadcastScheduleMigrationV2'/);
for (const key of expected) assert.ok(BROADCAST_ACCOUNT_DATA_KEYS.includes(key), `${key} must be writable through the real encrypted account-data store`);

console.log('BROADCAST_ACCOUNT_DATA_KEYS_CONTRACT_OK');