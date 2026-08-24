'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/broadcast-job-controller.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const api = require(controllerPath);

const running = { accountId: 'account-a', state: 'running', dismissed: false };
assert.equal(api.visibleFor(running, 'account-a'), true, 'task bar must be visible on owner account');
assert.equal(api.visibleFor(running, 'account-b'), false, 'task bar must not follow user to another account');
assert.equal(api.visibleFor({ ...running, dismissed: true }, 'account-a'), false, 'dismissed terminal task must stay hidden');
assert.equal(typeof api.formatScheduledAt(Date.now()), 'string');

assert.match(source, /String\(job\.accountId\) === String\(activeAccountId/, 'task visibility must remain account-scoped');
assert.match(source, /manager\?*\.getCurrent\(activeAccountId\(\)\)/, 'task bar must read the current account job from BroadcastJobManager');
assert.match(source, /manager\.invoke\(job\.id, job\.state === 'paused' \? 'resume' : 'pause'\)/, 'pause/resume must target the explicit job');
assert.match(source, /manager\.invoke\(job\.id, 'stop'\)/, 'stop/cancel must target the explicit job');
assert.match(source, /群发排队中/, 'queued jobs need dedicated task copy');
assert.match(source, /已固定 \$\{total\} 个发送对象/, 'scheduled jobs must communicate fixed audience semantics');
assert.match(source, /取消定时/, 'scheduled jobs need a cancel action');
assert.match(source, /取消排队/, 'queued jobs need a cancel action');
assert.match(source, /添加附件 · 最多10个，单个512 MiB/, 'attachment copy must match the active file boundary');
assert.match(source, /添加电子名片/, 'vCard entry must use action semantics rather than a persistent switch concept');

assert.doesNotMatch(source, /parseCompletion\s*\(/, 'task state must not be parsed from legacy completion text');
assert.doesNotMatch(source, /parseProgress\s*\(/, 'task progress must not be parsed from legacy progress DOM');
assert.doesNotMatch(source, /reconcileHistoryOwner/, 'history owner repair must not remain in the presentation layer');
assert.doesNotMatch(source, /installLegacyBridge/, 'legacy single-loop bridge must be removed');
assert.doesNotMatch(source, /broadcast-progress-text/, 'task bar must not inspect the legacy sending page');
assert.doesNotMatch(source, /broadcast-pause[^\n]*click/, 'task bar must not fall back to legacy pause controls');
assert.doesNotMatch(source, /broadcast-stop[^\n]*click/, 'task bar must not fall back to legacy stop controls');
assert.doesNotMatch(source, /window\.__lastFailDetail/, 'failure details must come from the Job state');
assert.doesNotMatch(source, /sendHistory/, 'presentation controller must not rewrite send history');

console.log('BROADCAST_JOB_CONTROLLER_CONTRACT_OK');
