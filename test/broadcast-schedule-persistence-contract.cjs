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
assert.equal(api.MAX_RESTORE_ATTEMPTS, 20);
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
assert.match(source, /event\.type === 'created'[\s\S]*job\.state === 'scheduled'[\s\S]*trackScheduledCreation\(job\)/, 'new scheduled jobs must start a durable creation write synchronously from the created event');
assert.match(source, /awaitScheduledDurable/, 'schedule execution must expose an awaited creation durability gate');
assert.match(source, /await dearmUnlocked\(current\)[\s\S]*manager\.transition\(current\.id, 'starting'\)/, 'a due job must durably de-arm before it becomes executable');
assert.ok(source.indexOf('await dearmUnlocked(current)') < source.indexOf("manager.transition(current.id, 'starting')"), 'durable de-arm must precede starting state');
assert.ok(source.indexOf("manager.transition(current.id, 'starting')") < source.indexOf('runtime.runJob(claimed.id)'), 'runtime send must start only after the de-arm boundary');
assert.match(source, /cancelPendingDurably[\s\S]*await dearmUnlocked\(current\)[\s\S]*cancelTimers\(\)/, 'pending cancellation must durably de-arm before timer cancellation/terminal UI state');
assert.match(source, /attachControls\(job\.id,[\s\S]*stop: pendingJob => cancelPendingDurably\(pendingJob\)/, 'scheduled and queued jobs need an awaited durable cancel control');
assert.match(source, /restoringJob = true[\s\S]*manager\.register[\s\S]*armRestored\(job\)[\s\S]*restoringJob = false/, 'restored disk records must not be mistaken for new schedule creation writes');
assert.match(source, /markRestoredDurable\(job\)/, 'restored scheduled and queued jobs must carry explicit durable provenance');
assert.match(source, /accountData\.getAll\(account\.id\)/, 'restore must read each account sandbox explicitly');
assert.match(source, /accountId: String\(account\.id\)/, 'restored job owner must come from the account being restored');
assert.match(source, /state: scheduledAt <= Date\.now\(\) \? 'queued' : 'scheduled'/, 'overdue restored schedules must become queued, not disappear');
assert.match(source, /try \{ await persistAccount\(account\.id\); \} catch \(_\) \{\}/, 'one account persistence failure must not abort restoration of other accounts');
assert.match(source, /attempts > MAX_RESTORE_ATTEMPTS/, 'restored due jobs must not retry forever');
assert.match(source, /manager\.markFailed\(due\.id, error\)/, 'retry exhaustion must become a visible terminal failure');
assert.match(source, /BROADCAST_SCHEDULE_ACCOUNT_UNAVAILABLE/, 'retry exhaustion needs a stable failure code');
assert.match(source, /BROADCAST_SCHEDULE_PERSIST_FAILED/, 'new schedule persistence failure needs a stable visible failure code');
assert.ok(loader.indexOf("'./broadcast-schedule-persistence.js'") < loader.indexOf("'./broadcast-job-controller.js'"), 'schedule recovery must load before presentation');

console.log('BROADCAST_SCHEDULE_PERSISTENCE_CONTRACT_OK');
