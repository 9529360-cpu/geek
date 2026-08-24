'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const safetyPath = path.join(__dirname, '../ui/broadcast-safety.js');
const preloadPath = path.join(__dirname, '../src/preload.cjs');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const loader = fs.readFileSync(safetyPath, 'utf8');
const preload = fs.readFileSync(preloadPath, 'utf8');
const api = require(runtimePath);

assert.equal(api.personalize('Hi %nc / %nr', { name: 'Alice', realName: 'A' }).includes('Alice / A'), true);
assert.match(runtime, /addEventListener\('click',[\s\S]*true\);/, 'runtime send interception must use capture phase before legacy element handlers');
assert.match(runtime, /closest\?\.\('#broadcast-send'\)/, 'runtime must own the broadcast send button');
assert.match(runtime, /event\.stopImmediatePropagation\(\)/, 'new runtime must stop the legacy window-global sender from running');
assert.match(runtime, /window\.GeekBroadcastJobs\.get\(jobId\)/, 'executor must resolve an explicit job rather than the current active account');
assert.match(runtime, /contextForAccount\(job\.accountId\)/, 'transport context must be resolved from the immutable job owner');
assert.match(runtime, /accountData\.set\(job\.accountId, 'sendHistory'/, 'history must be written directly to the job owner account');
assert.doesNotMatch(runtime, /broadcastRunning|broadcastPaused|broadcastStop|broadcastCurrent|broadcastOkCount/, 'new runtime must not depend on legacy window-global broadcast state');
assert.match(runtime, /GeekBroadcastSafety\.authorizeSend/, 'new runtime must preserve chat/composer authorization');
assert.match(runtime, /GeekPlatformTransports\?\.forAccount/, 'new runtime must reuse the existing platform transport rather than fork WA\/TG\/LINE adapters');
assert.match(runtime, /window\.api\.file\.pick\(\{ multiple: true \}\)/, 'runtime attachment selection must keep using the existing main-process picker');
assert.match(runtime, /currentDraftFiles\(accountId\)/, 'attachment drafts must be account-scoped before the Job snapshot is created');
assert.match(runtime, /isFuture && files\.length/, 'scheduled attachments must fail closed until persistent attachment references exist');
assert.match(runtime, /manager\.hasActive\(job\.accountId\)/, 'scheduled jobs must queue only when their own account is executing');
assert.match(runtime, /manager\.transition\(job\.id, 'queued'\)/, 'same-account schedule collision must become queued instead of disappearing');
assert.match(runtime, /drainQueued\(event\.job\.accountId\)/, 'terminal jobs must trigger a queue drain for the same account only');

assert.ok(loader.indexOf("'./broadcast-runtime.js'") < loader.indexOf("'./broadcast-job-controller.js'"), 'runtime must load before presentation compatibility hooks');
assert.match(preload, /filePath: file\.token/, 'renderer compatibility filePath must remain an opaque token');
assert.match(preload, /delete result\.filePath/, 'main-process send payload must translate the compatibility field back to fileToken');

console.log('BROADCAST_RUNTIME_CONTRACT_OK');
