'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const launch = require('../ui/broadcast-launch-check.js');

function baseSnapshot(patch = {}) {
  return {
    accountId: 'account-a',
    audience: {
      mode: 'custom',
      count: 10,
      countKnown: true,
      finalExact: true,
      selectionReady: true,
    },
    contentPresent: true,
    scheduleEnabled: false,
    scheduleValid: true,
    schedulePersistenceReady: true,
    intervalMin: 5,
    intervalMax: 10,
    activeJob: false,
    pendingJobs: 0,
    contactsReady: true,
    importedAudience: false,
    usesNameVariable: false,
    fileCount: 0,
    ...patch,
  };
}

assert.deepEqual(launch.estimateWaitWindow(1, 5, 10), {
  gaps: 0,
  intervalMin: 5,
  intervalMax: 10,
  minSeconds: 0,
  maxSeconds: 0,
});
assert.deepEqual(launch.estimateWaitWindow(10, 5, 10), {
  gaps: 9,
  intervalMin: 5,
  intervalMax: 10,
  minSeconds: 45,
  maxSeconds: 90,
});
assert.deepEqual(launch.estimateWaitWindow(3, 1, 2), {
  gaps: 2,
  intervalMin: 5,
  intervalMax: 5,
  minSeconds: 10,
  maxSeconds: 10,
}, 'preflight must mirror the runtime five-second minimum interval');
assert.equal(launch.formatDuration(0), '0 秒');
assert.equal(launch.formatDuration(90), '1 分 30 秒');
assert.equal(launch.formatDuration(3600), '1 小时');

let plan = launch.assessLaunchPlan(baseSnapshot());
assert.equal(plan.state, 'ready');
assert.equal(plan.blockers.length, 0);
assert.equal(plan.warnings.length, 0);
assert.equal(plan.wait.minSeconds, 45);
assert.equal(plan.wait.maxSeconds, 90);
assert.ok(plan.notices.some(item => item.code === 'COMPLIANCE'));

plan = launch.assessLaunchPlan(baseSnapshot({ activeJob: true }));
assert.equal(plan.state, 'block');
assert.ok(plan.blockers.some(item => item.code === 'ACCOUNT_BUSY'), 'an immediate send must not compete with the current account executor');

plan = launch.assessLaunchPlan(baseSnapshot({
  scheduleEnabled: true,
  scheduleValid: true,
  schedulePersistenceReady: true,
  activeJob: true,
  pendingJobs: 2,
}));
assert.equal(plan.state, 'warn', 'a future schedule may coexist with the current account task and queue later');
assert.equal(plan.blockers.some(item => item.code === 'ACCOUNT_BUSY'), false, 'scheduled work must not reintroduce a global/current-account send lock');
assert.ok(plan.warnings.some(item => item.code === 'SCHEDULE_MAY_QUEUE'));
assert.ok(plan.warnings.some(item => item.code === 'SCHEDULE_QUEUE_PRESSURE'));
assert.ok(plan.notices.some(item => item.code === 'FIXED_AUDIENCE'));

plan = launch.assessLaunchPlan(baseSnapshot({
  scheduleEnabled: true,
  scheduleValid: false,
}));
assert.equal(plan.state, 'block');
assert.ok(plan.blockers.some(item => item.code === 'SCHEDULE_INVALID'));
assert.match(plan.blockers.find(item => item.code === 'SCHEDULE_INVALID').text, /不会自动改成立即发送/);

plan = launch.assessLaunchPlan(baseSnapshot({
  scheduleEnabled: true,
  scheduleValid: true,
  schedulePersistenceReady: false,
}));
assert.equal(plan.state, 'block');
assert.ok(plan.blockers.some(item => item.code === 'SCHEDULE_PERSISTENCE_NOT_READY'));

plan = launch.assessLaunchPlan(baseSnapshot({ contentPresent: false }));
assert.equal(plan.state, 'block');
assert.ok(plan.blockers.some(item => item.code === 'CONTENT_REQUIRED'));

plan = launch.assessLaunchPlan(baseSnapshot({
  audience: { mode: 'label', countKnown: false, finalExact: false, selectionReady: true, estimateNote: '标签对象发送时解析。' },
}));
assert.equal(plan.state, 'ready', 'selected dynamic modes must not be falsely blocked merely because the exact count is not known yet');
assert.equal(plan.wait, null);
assert.ok(plan.notices.some(item => item.code === 'AUDIENCE_RESOLVED_AT_SEND'));

plan = launch.assessLaunchPlan(baseSnapshot({
  audience: { mode: 'label', countKnown: false, finalExact: false, selectionReady: false, blockerText: '请先选择标签。' },
}));
assert.equal(plan.state, 'block');
assert.ok(plan.blockers.some(item => item.code === 'AUDIENCE_REQUIRED'));

plan = launch.assessLaunchPlan(baseSnapshot({
  audience: { mode: 'paste', count: 500, countKnown: true, finalExact: false, selectionReady: true, estimateNote: '候选号码。' },
  intervalMin: 5,
  intervalMax: 10,
  importedAudience: true,
  usesNameVariable: true,
}));
assert.equal(plan.state, 'warn');
assert.ok(plan.warnings.some(item => item.code === 'LONG_RANDOM_WAIT'));
assert.ok(plan.warnings.some(item => item.code === 'IMPORTED_NAME_VARIABLE'));
assert.equal(plan.wait.maxSeconds, 4990);

plan = launch.assessLaunchPlan(baseSnapshot({
  scheduleEnabled: true,
  scheduleValid: true,
  fileCount: 2,
}));
assert.ok(plan.notices.some(item => item.code === 'SCHEDULED_FILE_RECHECK'));

const launchSource = fs.readFileSync(path.join(__dirname, '../ui/broadcast-launch-check.js'), 'utf8');
const safetySource = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
assert.match(launchSource, /发送前检查/);
assert.match(launchSource, /随机等待/);
assert.match(launchSource, /不含平台耗时|实际完成时间还会更长/);
assert.match(launchSource, /GeekBroadcastJobs/);
assert.doesNotMatch(launchSource, /风险分|riskScore|score\s*[:=]/i, 'preflight must not fabricate an opaque risk score');
assert.doesNotMatch(launchSource, /manager\.(?:start|register|transition|update|invoke)\(/, 'launch check must remain a projection and never mutate Broadcast Jobs');

const workbenchLoad = safetySource.indexOf("loadScript('./broadcast-workbench.js'");
const launchLoad = safetySource.indexOf("loadScript('./broadcast-launch-check.js'");
const audienceLoad = safetySource.indexOf("loadScript('./broadcast-audience-ux.js'");
assert.ok(workbenchLoad >= 0 && launchLoad > workbenchLoad && audienceLoad > launchLoad, 'launch check must augment the canonical Workbench before later UX decorators install');
assert.match(safetySource, /请选择未来的发送时间，避免定时任务被误当成立即发送/);

console.log('BROADCAST_LAUNCH_CHECK_CONTRACT_OK');
