'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '../ui/broadcast-runtime.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '../ui/broadcast-job-controller.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');

assert.ok(index.indexOf('<script src="broadcast-ui-model.js"></script>') < index.indexOf('<script src="app.js"></script>'), 'the UI model must load before app handlers use it');
assert.match(app, /accountData\.set\(accountId, key, raw\)\.then\(\(\) => true\)/, 'account writes must report confirmed success');
assert.match(app, /accountSandboxWriteSequence\.get\(writeKey\) === sequence/, 'a stale failed write must not roll back a newer account-scoped value');
assert.match(app, /persistBeforeCommit\(next,[\s\S]*accountStorageSetItem\('savedMessages'/, 'message templates must persist before UI commit');
assert.match(app, /persistBeforeCommit\(next,[\s\S]*accountStorageSetItem\('broadcastGroups'/, 'group tags must persist before UI commit');
assert.match(app, /savedMessageMutationPending/, 'message template mutations need a single-flight guard');
assert.match(app, /groupTagMutationPending/, 'group tag mutations need a single-flight guard');

const clearFilter = app.match(/function clearBroadcastGroupTagFilter\(\) \{([\s\S]*?)\n  \}/);
assert.ok(clearFilter, 'group tag clear-filter boundary must exist');
assert.doesNotMatch(clearFilter[1], /broadcastSelected\.clear/, 'clearing a filter must preserve the current recipient selection');

assert.match(runtime, /\['all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups'\][\s\S]*resolveAudience/, 'all/exclusion modes must bypass stale selected chips');
assert.match(controller, /export-failures/, 'new Job failures must expose CSV export in the task bar');
assert.doesNotMatch(controller, /window\.alert\s*=/, 'broadcast UI must not replace the application-wide alert function');

console.log('BROADCAST_UI_INTEGRATION_CONTRACT_OK');
