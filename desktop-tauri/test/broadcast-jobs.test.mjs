import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, job } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const control = (ui, jobId, action) => ui.get('broadcast-task-center-overlay').querySelectorAll('button')
  .find((node) => node.dataset.jobId === jobId && node.dataset.action === action);
const scope = (ui, value) => ui.get('broadcast-task-center-overlay').querySelectorAll('button')
  .find((node) => node.dataset.scope === value);
const barAction = (ui, action) => ui.get('broadcast-job-bar').querySelectorAll('button')
  .find((node) => node.dataset.act === action);

test('task bar follows the active account while all-account controls retain explicit job ownership', async (t) => {
  const ui = await fixture({ initialJobs: [job(), job('job-b', 'b', { state: 'paused' })] });
  t.after(() => ui.controller.dispose());
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'job-a');
  await ui.click('broadcast-task-center-button');
  assert.equal(ui.get('broadcast-task-center-overlay').querySelectorAll('.bc-task-row').length, 1);
  await ui.fire(scope(ui, 'all'), 'click');
  const center = ui.get('broadcast-task-center-overlay');
  assert.equal(center.querySelectorAll('.bc-task-row').length, 2);
  assert.match(center.textContent, /Alice account/); assert.match(center.textContent, /Bob account/);
  await ui.fire(control(ui, 'job-b', 'resume'), 'click');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'control').map(([, value]) => value), [{ jobId: 'job-b', action: 'resume' }]);
  assert.equal(ui.shell.activeId, 'a');
  assert.equal(ui.backend.jobs.find((item) => item.id === 'job-a').state, 'running');
  ui.switchAccount('b');
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'job-b');
  await ui.fire(barAction(ui, 'stop'), 'click');
  assert.equal(ui.calls.filter(([name]) => name === 'control').at(-1)[1].jobId, 'job-b');
  assert.equal(ui.backend.jobs.find((item) => item.id === 'job-a').state, 'running');
});

test('failed controls keep the authoritative state and duplicate pending clicks do not retarget on account switch', async (t) => {
  const pending = deferred(); let wait = false;
  const ui = await fixture({ initialJobs: [job(), job('job-b', 'b')],
    before: (name) => name === 'control' && wait ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  ui.failures.add('control');
  await ui.fire(barAction(ui, 'pause'), 'click');
  assert.match(ui.get('broadcast-job-bar').querySelector('.bc-job-title').textContent, /发送中/);
  assert.match(ui.get('broadcast-job-feedback').textContent, /保存/);
  assert.equal(ui.backend.jobs[0].state, 'running');
  ui.failures.clear(); wait = true;
  const pause = barAction(ui, 'pause'); pause.fire('click'); pause.fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'control').length, 2);
  assert.equal(pause.disabled, true);
  ui.switchAccount('b');
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'job-b');
  pending.resolve({ revision: 2, jobs: [job('job-a', 'a', { state: 'paused' }), job('job-b', 'b')] });
  await ui.controller.idle();
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'job-b');
  assert.match(ui.get('broadcast-job-bar').querySelector('.bc-job-title').textContent, /发送中/);
  const calls = ui.calls.filter(([name]) => name === 'control');
  assert.deepEqual(calls.at(-1)[1], { jobId: 'job-a', action: 'pause' });
});

test('restart uncertainty displays all outcome kinds and requires explicit resume without replay creation', async (t) => {
  const interrupted = job('interrupted', 'a', { state: 'paused', current: 3, total: 4, ok: 1, fail: 1, uncertain: 1,
    reviewRequired: true, lastIssue: 'INTERRUPTED_UNCERTAIN', results: [
      { index: 0, at: 1, outcome: { status: 'confirmed', receipt: 'receipt-not-rendered' } },
      { index: 1, at: 2, outcome: { status: 'notSubmitted', code: 'TARGET_CHANGED' } },
      { index: 2, at: 3, outcome: { status: 'uncertain', code: 'RECEIPT_MISSING' } },
    ] });
  const ui = await fixture({ initialJobs: [interrupted] }); t.after(() => ui.controller.dispose());
  await ui.tick();
  assert.equal(ui.calls.some(([name]) => name === 'control' || name === 'create'), false);
  assert.match(ui.get('broadcast-job-bar').textContent, /结果不确定的对象不会重发/);
  await ui.fire(barAction(ui, 'failures'), 'click');
  const evidence = ui.get('broadcast-job-bar').querySelector('.bc-job-failures');
  assert.match(evidence.textContent, /Ann · 已确认发送/);
  assert.match(evidence.textContent, /Ben · 未提交/);
  assert.match(evidence.textContent, /Team · 结果不确定/);
  assert.doesNotMatch(evidence.textContent, /receipt-not-rendered/);
  await ui.click('broadcast-task-center-button');
  assert.match(control(ui, 'interrupted', 'resume').textContent, /剩余未发送对象/);
  await ui.fire(control(ui, 'interrupted', 'resume'), 'click');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'control').map(([, value]) => value), [{ jobId: 'interrupted', action: 'resume' }]);
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
});

test('equal-revision storage failure projections render and older snapshots cannot erase them', async (t) => {
  const ui = await fixture({ initialJobs: [job()] }); t.after(() => ui.controller.dispose());
  ui.publish({ revision: 1, jobs: [job('job-a', 'a', { storageBlocked: true, lastIssue: 'PERSISTENCE_FAILED' })] });
  await ui.tick();
  assert.match(ui.get('broadcast-job-bar').textContent, /存储故障待处理/);
  assert.match(ui.get('broadcast-job-bar').textContent, /已停止自动执行/);
  assert.equal(barAction(ui, 'pause').textContent, '恢复任务');
  assert.equal(ui.calls.some(([name]) => name === 'control'), false);
  ui.publish({ revision: 0, jobs: [job('job-a', 'a', { state: 'completed', current: 3 })] });
  await ui.tick();
  assert.match(ui.get('broadcast-job-bar').textContent, /存储故障待处理/);
  ui.publish({ revision: 1, jobs: [job('job-a', 'a', { storageBlocked: false })] });
  await ui.tick();
  assert.doesNotMatch(ui.get('broadcast-job-bar').textContent, /存储故障待处理/);
  assert.equal(barAction(ui, 'pause').textContent, '暂停');
});

test('queued restart review is resumable and failed-before-first-send jobs remain visible with zero failed recipients', async (t) => {
  const ui = await fixture({ initialJobs: [job('queued', 'a', { state: 'queued', reviewRequired: true, lastIssue: 'INTERRUPTED' }),
    job('failed', 'b', { state: 'failed', lastIssue: 'SCHEDULE_ACCOUNT_UNAVAILABLE', fail: 0 })] });
  t.after(() => ui.controller.dispose());
  assert.equal(barAction(ui, 'pause').classList.contains('hidden'), false);
  assert.match(barAction(ui, 'pause').textContent, /剩余未发送/);
  await ui.fire(barAction(ui, 'pause'), 'click');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'control').at(-1)[1], { jobId: 'queued', action: 'resume' });
  ui.switchAccount('b');
  assert.equal(ui.get('broadcast-job-bar').classList.contains('hidden'), false);
  assert.match(ui.get('broadcast-job-bar').textContent, /账号不可用/);
  await ui.fire(barAction(ui, 'failures'), 'click');
  assert.match(ui.get('broadcast-job-bar').querySelector('.bc-job-failures').textContent, /定时任务到点/);
  await ui.click('broadcast-task-center-button');
  assert.equal(ui.get('broadcast-task-center-overlay').querySelectorAll('.bc-task-row').length, 1);
  await ui.fire(control(ui, 'failed', 'dismiss'), 'click');
  assert.equal(ui.get('broadcast-job-bar').classList.contains('hidden'), true);
  assert.match(ui.get('broadcast-task-center-overlay').textContent, /当前账号暂无群发任务/);
});

test('the bar waits for native layout and asks for a new layout when dismissed', async (t) => {
  const layout = deferred();
  const ui = await fixture({ initialJobs: [job('complete', 'a', { state: 'completed' })], layoutBefore: () => layout.promise });
  t.after(() => ui.controller.dispose());
  const bar = ui.get('broadcast-job-bar');
  assert.equal(ui.layouts, 1);
  assert.equal(bar.classList.contains('bc-layout-pending'), true);
  layout.resolve(); await flush();
  assert.equal(bar.classList.contains('bc-layout-pending'), false);
  await ui.fire(bar.querySelector('.bc-job-close'), 'click'); await flush();
  assert.equal(bar.classList.contains('hidden'), true); assert.equal(ui.layouts, 2);
});

test('disposal ignores a late snapshot and cancels polling without controlling jobs', async () => {
  const request = deferred(); let wait = false;
  const ui = await fixture({ initialJobs: [job()], before: (name) => name === 'snapshot' && wait ? request.promise : undefined });
  wait = true;
  const polling = ui.tick(); await flush();
  ui.controller.dispose();
  request.resolve({ revision: 8, jobs: [] }); await polling;
  assert.equal(ui.get('broadcast-job-bar').classList.contains('hidden'), false);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.calls.some(([name]) => name === 'control' || name === 'create'), false);
});
