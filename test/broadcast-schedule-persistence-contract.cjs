'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const persistencePath = path.join(__dirname, '../ui/broadcast-schedule-persistence.js');
const loaderPath = path.join(__dirname, '../ui/broadcast-safety.js');
const source = fs.readFileSync(persistencePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const api = require(persistencePath);

assert.equal(api.STORAGE_KEY, 'broadcastJobSchedules');
const frozen = api.serializableJob({
  id: 'job-a', accountId: 'A', accountName: 'A', partition: 'persist:a', platformFamily: 'whatsapp',
  targets: [{ id: '1', name: 'Alice' }], message: 'hello', files: [],
  attachmentRefs: [{ ref: 'opaque-ref-a', name: 'a.pdf', size: 4, mime: 'application/pdf' }],
  vcards: [], tagAll: false, intervalMin: 5, intervalMax: 10, scheduledAt: 5000, createdAt: 1000,
});
assert.equal(frozen.accountId, 'A');
assert.deepEqual(frozen.targets, [{ id: '1', name: 'Alice' }]);
assert.deepEqual(frozen.attachmentRefs, [{ ref: 'opaque-ref-a', name: 'a.pdf', size: 4, mime: 'application/pdf' }]);
assert.equal('files' in frozen, false, 'temporary attachment tokens must never be persisted as durable schedule data');
assert.equal('filePath' in JSON.parse(JSON.stringify(frozen)), false, 'schedule records must not persist renderer file-token compatibility fields');
assert.equal(JSON.stringify(frozen).includes('canonicalPath'), false, 'schedule records must never contain main-process canonical paths');

assert.match(source, /attachmentRefs:/, 'durable attachment refs must be serialized with pending jobs');
assert.match(source, /files: \[\],[\s\S]*attachmentRefs: refs/, 'restored jobs must keep execution tokens empty and restore only durable refs');
assert.match(source, /accountData\.set\(String\(accountId\), STORAGE_KEY/, 'pending schedules must persist under an explicit account owner');
assert.match(source, /accountData\.getAll\(account\.id\)/, 'restore must read each account sandbox explicitly');
assert.match(source, /accountId: String\(account\.id\)/, 'restored job owner must come from the account being restored');
assert.match(source, /state: scheduledAt <= Date\.now\(\) \? 'queued' : 'scheduled'/, 'overdue restored schedules must become queued, not silently disappear');
assert.match(source, /manager\.hasActive\(current\.accountId\)/, 'schedule collision must be scoped to the same account');
assert.match(source, /manager\.transition\(current\.id, 'queued'\)/, 'same-account collision must queue the job');
assert.match(source, /runtime\.runJob\(due\.id\)/, 'restored due job must execute through the shared account-scoped runtime');
assert.ok(loader.indexOf("'./broadcast-schedule-persistence.js'") < loader.indexOf("'./broadcast-job-controller.js'"), 'schedule recovery must load before presentation');

console.log('BROADCAST_SCHEDULE_PERSISTENCE_CONTRACT_OK');
