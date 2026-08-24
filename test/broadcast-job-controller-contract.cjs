'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/broadcast-job-controller.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const api = require(controllerPath);

const job = api.createJob('account-a', { total: 52 });
assert.equal(job.accountId, 'account-a');
assert.equal(job.total, 52);
assert.equal(api.visibleFor(job, 'account-a'), true, 'task bar must be visible on owner account');
assert.equal(api.visibleFor(job, 'account-b'), false, 'task bar must not follow user to another account');
job.dismissed = true;
assert.equal(api.visibleFor(job, 'account-a'), false, 'dismissed terminal task must stay hidden');

assert.deepEqual(api.parseProgress('18 / 52 (34.62%)'), { current: 18, total: 52 });
assert.deepEqual(api.parseCompletion('完成：成功 49，失败 3'), { ok: 49, fail: 3, stopped: false });
assert.deepEqual(api.parseCompletion('完成：成功 18，失败 0（已停止）'), { ok: 18, fail: 0, stopped: true });

const completed = api.createJob('account-a', { total: 52, ok: 49, fail: 3, createdAt: 10000 });
const misplaced = { t: 12000, total: 52, ok: 49, fail: 3, files: 0, msgLen: 12 };
const patches = api.reconcileHistoryOwner(
  completed,
  { 'account-a': '[]', 'account-b': '[]' },
  { 'account-a': '[]', 'account-b': JSON.stringify([misplaced]) },
);
assert.equal(patches.length, 2, 'one unambiguous misplaced history entry should be repaired');
assert.equal(patches[0].accountId, 'account-b');
assert.deepEqual(JSON.parse(patches[0].value), []);
assert.equal(patches[1].accountId, 'account-a');
assert.deepEqual(JSON.parse(patches[1].value), [misplaced]);
assert.deepEqual(
  api.reconcileHistoryOwner(completed, { 'account-a': '[]', 'account-b': '[]' }, { 'account-a': JSON.stringify([misplaced]), 'account-b': '[]' }),
  [],
  'already-correct owner history must not be moved',
);
assert.deepEqual(
  api.reconcileHistoryOwner(completed, { 'account-a': '[]', 'account-b': '[]', 'account-c': '[]' }, { 'account-a': '[]', 'account-b': JSON.stringify([misplaced]), 'account-c': JSON.stringify([misplaced]) }),
  [],
  'ambiguous cross-account history must fail closed',
);

assert.match(source, /String\(job\.accountId\) === String\(activeAccountId/, 'task visibility must be account-scoped');
assert.match(source, /broadcast-overlay[^\n]*classList\.add\('hidden'\)/, 'started task must restore the account page');
assert.match(source, /#bc-menu-send,#broadcast-send/, 'running task must guard repeat broadcast opens/starts');
assert.match(source, /添加附件 · 最多10个，单个512 MiB/, 'attachment copy must match the active file boundary');
assert.match(source, /添加电子名片/, 'vCard entry must use action semantics rather than a persistent switch concept');
assert.match(source, /群发完成：/, 'legacy completion alert must be filtered from the normal completion path');
assert.match(source, /window\.__lastFailDetail/, 'failure details must remain available without reopening a full-screen completion page');
assert.match(source, /accountData\.set\(patch\.accountId, 'sendHistory'/, 'transition history repair must write an explicit account owner');

console.log('BROADCAST_JOB_CONTROLLER_CONTRACT_OK');
