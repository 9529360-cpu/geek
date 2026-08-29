'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../ui/broadcast-product-closure.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/broadcast-product-closure.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'ui/broadcast-safety.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'ui/broadcast-legacy-schedule-migration.js'), 'utf8');
const broadcastKeys = fs.readFileSync(path.join(root, 'src/broadcast-account-data-keys.cjs'), 'utf8');

assert.deepEqual(api.parseList('not-json'), []);
assert.deepEqual(api.appendRecipientPreset('[{"name":"A","ids":["1"]}]', { name: ' B ', ids: ['2', '2', ''] }), [
  { name: 'A', ids: ['1'] },
  { name: 'B', ids: ['2'] },
]);
assert.throws(() => api.appendRecipientPreset([], { name: '', ids: ['1'] }), /requires name and ids/);
assert.deepEqual(api.pendingJobsFor({ list: () => [
  { id: 'running', state: 'running', scheduledAt: 1 },
  { id: 'late', state: 'queued', scheduledAt: 30 },
  { id: 'early', state: 'scheduled', scheduledAt: 20 },
] }, 'account').map(job => job.id), ['early', 'late']);

const many = Array.from({ length: 30 }, (_, index) => ({
  id: `job-${index}`,
  state: index % 2 ? 'scheduled' : 'queued',
  scheduledAt: 1000 + (29 - index),
}));
assert.equal(api.pendingJobsFor({ list: () => many }, 'account').length, 30, 'the canonical pending model must keep dozens of independent tasks');
assert.equal(api.pendingJobsFor({ list: () => many }, 'account')[0].scheduledAt, 1000, 'dozens of tasks must remain time-sorted');

assert.match(source, /accountData\.set\(accountId, 'savedLists'/, 'recipient presets must be written through account-scoped durable storage');
assert.ok(source.indexOf("accountData.set(accountId, 'savedLists'") < source.indexOf("button.onclick.call(button)"), 'durable preset write must complete before the legacy in-memory UI is allowed to commit');
assert.match(source, /下次进入群发可直接选择复用/, 'successful save must communicate cross-session reuse');
assert.match(source, /GeekBroadcastRuntimeInstance/, 'multi-message scheduling must reuse the canonical broadcast runtime');
assert.match(source, /runtime\.startFromEditor\(\)/, 'each added message must create a normal account-scoped Broadcast Job');
assert.match(source, /awaitScheduledDurable\(job\.id\)/, 'the add-another flow must wait for durable schedule persistence');
assert.match(source, /overlay\?\.classList\.remove\('hidden'\)/, 'the editor must continue in-place after one scheduled Job is safely created');
assert.match(source, /message\.value = ''/, 'the next scheduled message should start with an empty message field');
assert.match(source, /max-height:230px;overflow:auto/, 'dozens of pending schedules must scroll instead of expanding the whole editor');
assert.match(source, /待发送 \$\{jobs\.length\} 条/, 'the pending list must tell users how many independent tasks are configured');
assert.doesNotMatch(source, /scheduleTasks/, 'new multi-message scheduling must not revive legacy scheduleTasks execution');
assert.doesNotMatch(source, /setTimeout\([^\n]*send|fireScheduledTask/, 'new multi-message scheduling must not introduce a parallel timer/send engine');
assert.doesNotMatch(source, /job\.message[^\n]*textContent|textContent[^\n]*job\.message/, 'scheduled task list must not render message bodies');

assert.match(legacy, /#broadcast-add-schedule,#broadcast-schedule-list\{display:none!important\}/, 'legacy migration must continue disabling its deprecated UI by default');
assert.match(legacy, /addLegacy && !window\.GeekBroadcastProductClosureInstance/, 'legacy capture guard must yield the reclaimed button once the safe product closure owns it');
assert.match(source, /#broadcast-add-schedule\{display:inline-flex!important\}/, 'the new closure module must explicitly reclaim the existing add-task affordance after legacy retirement');
assert.match(broadcastKeys, /'broadcastJobSchedules'/, 'broadcast account-data extension must allow canonical scheduled jobs');
assert.match(broadcastKeys, /'broadcastLegacyScheduleBackup'/, 'legacy migration safety backup must be writable');
assert.match(broadcastKeys, /'broadcastLegacyScheduleNeedsReview'/, 'legacy migration review state must be writable');
assert.match(broadcastKeys, /'broadcastScheduleMigrationV2'/, 'legacy migration completion marker must be writable');
assert.ok(loader.indexOf("'./broadcast-audience-ux.js'") < loader.indexOf("'./broadcast-product-closure.js'"), 'product closure must load after legacy audience relabel/retirement');
assert.ok(loader.indexOf("'./broadcast-product-closure.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'product closure must be installed inside the bounded broadcast dependency chain');

console.log('BROADCAST_PRODUCT_CLOSURE_CONTRACT_OK');
