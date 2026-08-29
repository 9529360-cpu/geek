'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/advanced-tools-workbench.js');
const { BROADCAST_ACCOUNT_DATA_KEYS } = require('../src/broadcast-account-data-keys.cjs');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/advanced-tools-workbench.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'ui/broadcast-safety.js'), 'utf8');
const groupCss = fs.readFileSync(path.join(root, 'ui/group-tools-original.css'), 'utf8');

assert.equal(api.BACKUP_SCHEMA, 'geek-account-settings');
assert.equal(api.BACKUP_VERSION, 2);
const backup = api.buildBackupRecord({
  savedMessages: JSON.stringify([{ name: 'hello', message: 'world' }]),
  savedLists: JSON.stringify([{ name: 'VIP', ids: ['1'] }]),
  broadcastGroups: JSON.stringify([{ id: 'g1', name: 'Group', chatIds: ['2'] }]),
  scheduleTasks: JSON.stringify([{ id: 'old-executable' }]),
  broadcastJobSchedules: JSON.stringify([{ id: 'new-executable' }]),
  sendHistory: JSON.stringify([{ t: 1 }]),
}, { name: 'A', type: 'whatsapp' }, 0);
assert.deepEqual(Object.keys(backup.data).sort(), ['broadcastGroups', 'savedLists', 'savedMessages']);
assert.ok(backup.excludes.includes('scheduleTasks'));
assert.ok(backup.excludes.includes('broadcastJobSchedules'));
assert.ok(backup.excludes.includes('sendHistory'));

const legacy = api.normalizeBackupRecord({
  savedLists: [{ name: 'Reusable', ids: ['x'] }],
  scheduleTasks: [{ id: 'must-not-restore' }],
  broadcastJobSchedules: [{ id: 'must-not-restore-either' }],
});
assert.deepEqual(legacy.entries.map(([key]) => key), ['savedLists']);
assert.deepEqual(legacy.ignoredExecutionKeys.sort(), ['broadcastJobSchedules', 'scheduleTasks']);
assert.equal(api.csvCell('a,b'), '"a,b"');
assert.equal(api.csvCell('a"b'), '"a""b"');
assert.equal(api.csvCell('plain'), 'plain');
assert.deepEqual(api.summarizeHistory('[{"t":1,"total":3,"ok":2,"fail":1,"files":2},{"t":2,"total":4,"ok":4,"fail":0,"files":0}]'), {
  jobs: 2, total: 7, ok: 6, fail: 1, files: 2,
});
assert.equal(api.isGroupChat({ isGroup: true }), true);
assert.equal(api.isGroupChat({ type: 'group' }), true);
assert.equal(api.isGroupChat({ type: 'contact' }), false);

for (const key of ['broadcastJobSchedules', 'broadcastLegacyScheduleBackup', 'broadcastLegacyScheduleNeedsReview', 'broadcastScheduleMigrationV2']) {
  assert.ok(BROADCAST_ACCOUNT_DATA_KEYS.includes(key), `broadcast account-data extension must allow ${key}`);
}
assert.match(source, /GeekPlatformTransports\?\.forAccount/, 'contact export must reuse the canonical platform transport abstraction');
assert.match(source, /window\.api\.accountData\.getAll/, 'backup/report must read account-scoped durable data');
assert.match(source, /LEGACY_EXECUTION_KEYS/, 'backups must explicitly separate executable schedule state');
assert.doesNotMatch(source, /document\.cookie|localStorage\.getItem\(['"](?:token|cookie)|ipcRenderer/, 'workbench must not read secrets or bypass preload boundaries');
assert.ok(loader.includes("'./advanced-tools-workbench.js'"), 'advanced tools workbench must be loaded by the bounded UI loader');
assert.doesNotMatch(groupCss, /#3051d3|background:#fff|color:#303133/, 'group tools must use current theme variables instead of the old hard-coded palette');
assert.match(groupCss, /var\(--accent\)/, 'group tools must follow the current Geek accent color');
assert.match(groupCss, /border-radius:14px/, 'group tools dialog must use the modern rounded workbench shell');

console.log('ADVANCED_TOOLS_WORKBENCH_CONTRACT_OK');
