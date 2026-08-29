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
const csv = api.failureCsv({ failed: [{ name: 'A, "客户"', targetId: 'chat-1', reason: 'line 1\nline 2' }] });
assert.equal(csv.startsWith('\uFEFF联系人,聊天ID,失败原因\n'), true, 'failure CSV must carry a BOM and stable columns');
assert.match(csv, /"A, ""客户""","chat-1","line 1 line 2"/, 'failure CSV must escape commas, quotes, and newlines');
assert.equal(api.sendSummaryText('label', 0, true), '发送到所选标签');
assert.equal(api.sendSummaryText('group-members', 0, false), '请选择群组');
assert.equal(api.sendSummaryText('all', 12, true), '发送给 12 个聊天');

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
assert.match(source, /data-act="export-failures"/, 'terminal Job failures need a first-class CSV export action');
assert.match(source, /setTextIfChanged\(send,/, 'summary copy writes must be idempotent');
assert.match(source, /__geekBroadcastAudienceEstimate/, 'all and exclusion modes must show their resolved audience estimate');
assert.match(source, /getElementById\('broadcast-overlay'\)/, 'summary observer must stay scoped to the broadcast editor');
assert.match(source, /getElementById\('nav-accounts'\)/, 'account visibility observer must stay scoped to the account list');
assert.doesNotMatch(source, /observe\(document\.body/, 'controller must never observe the full document body because its own renders mutate DOM');

assert.doesNotMatch(source, /parseCompletion\s*\(/, 'task state must not be parsed from legacy completion text');
assert.doesNotMatch(source, /parseProgress\s*\(/, 'task progress must not be parsed from legacy progress DOM');
assert.doesNotMatch(source, /reconcileHistoryOwner/, 'history owner repair must not remain in the presentation layer');
assert.doesNotMatch(source, /installLegacyBridge/, 'legacy single-loop bridge must be removed');
assert.doesNotMatch(source, /broadcast-progress-text/, 'task bar must not inspect the legacy sending page');
assert.doesNotMatch(source, /broadcast-pause[^\n]*click/, 'task bar must not fall back to legacy pause controls');
assert.doesNotMatch(source, /broadcast-stop[^\n]*click/, 'task bar must not fall back to legacy stop controls');
assert.doesNotMatch(source, /window\.__lastFailDetail/, 'failure details must come from the Job state');
assert.doesNotMatch(source, /sendHistory/, 'presentation controller must not rewrite send history');
assert.doesNotMatch(source, /window\.alert\s*=/, 'the broadcast controller must never replace the application-wide alert function');
assert.doesNotMatch(source, /installAlertFilter/, 'save and completion feedback must not be silently filtered');

console.log('BROADCAST_JOB_CONTROLLER_CONTRACT_OK');
