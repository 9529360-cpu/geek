import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, job } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const barExport = (ui) => ui.get('broadcast-job-bar').querySelectorAll('button')
  .find((node) => node.dataset.act === 'export-failures');
const exportRow = (ui, id) => ui.get('broadcast-task-center-overlay').querySelectorAll('button')
  .find((node) => node.dataset.jobId === id && node.dataset.action === 'export');
const issueJob = (id = 'job-a', accountId = 'a', overrides = {}) => job(id, accountId, { state: 'paused', uncertain: 1,
  results: [{ index: 0, at: 2, outcome: { status: 'uncertain', code: 'RECEIPT_MISSING' } }], ...overrides });

test('the original export action works for paused uncertainty and sends only the captured account and job', async (t) => {
  const initial = issueJob();
  const ui = await fixture({ initialJobs: [initial] }); t.after(() => ui.controller.dispose());
  assert.equal(barExport(ui).textContent, '导出异常 CSV');
  assert.equal(barExport(ui).classList.contains('hidden'), false); assert.equal(barExport(ui).disabled, false);
  await ui.fire(barExport(ui), 'click');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'export').map(([, args]) => args), [{ accountId: 'a', jobId: 'job-a' }]);
  assert.equal(ui.get('broadcast-job-feedback').textContent, '已导出 1 条异常记录');
  assert.deepEqual(ui.backend.jobs, [initial]);
  assert.equal(ui.calls.some(([name]) => name === 'create' || name === 'control'), false);
});

test('only actual exceptions are exportable; storage and task issues do not need a failed-recipient count', async (t) => {
  for (const [overrides, visible] of [
    [{ results: [{ index: 0, outcome: { status: 'confirmed', receipt: 'receipt' } }], state: 'completed' }, false],
    [{ results: [{ index: 0, outcome: { status: 'notSubmitted', code: 'TARGET_CHANGED' } }] }, true],
    [{ storageBlocked: true, fail: 0 }, true],
    [{ state: 'failed', lastIssue: 'ACCOUNT_UNAVAILABLE', fail: 0 }, true],
  ]) {
    const ui = await fixture({ initialJobs: [job('job-a', 'a', overrides)] }); t.after(() => ui.controller.dispose());
    assert.equal(barExport(ui).classList.contains('hidden'), !visible);
    if (visible) { await ui.fire(barExport(ui), 'click'); assert.equal(ui.calls.filter(([name]) => name === 'export').length, 1); }
  }
});

test('all-account task rows export the clicked job without changing the active account', async (t) => {
  const ui = await fixture({ initialJobs: [issueJob(), issueJob('job-b', 'b')] }); t.after(() => ui.controller.dispose());
  await ui.click('broadcast-task-center-button');
  const all = ui.get('broadcast-task-center-overlay').querySelectorAll('button').find((node) => node.dataset.scope === 'all');
  await ui.fire(all, 'click'); await ui.fire(exportRow(ui, 'job-b'), 'click');
  assert.deepEqual(ui.calls.find(([name]) => name === 'export')[1], { accountId: 'b', jobId: 'job-b' });
  assert.equal(ui.shell.activeId, 'a'); assert.equal(ui.get('broadcast-job-feedback').textContent, '');
  const rows = ui.get('broadcast-task-center-overlay').querySelectorAll('.bc-task-row');
  assert.match(rows.find((row) => row.dataset.jobId === 'job-b').textContent, /已导出 1 条/);
  assert.doesNotMatch(rows.find((row) => row.dataset.jobId === 'job-a').textContent, /已导出/);
});

test('duplicate export clicks coalesce and late success cannot become another account job feedback', async (t) => {
  const pending = deferred();
  const ui = await fixture({ initialJobs: [issueJob(), issueJob('job-b', 'b')],
    before: (name) => name === 'export' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  barExport(ui).fire('click'); barExport(ui).fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'export').length, 1); assert.equal(barExport(ui).disabled, true);
  assert.equal(ui.get('broadcast-task-center-button').disabled, false);
  ui.switchAccount('b'); assert.equal(ui.get('broadcast-job-feedback').textContent, ''); assert.equal(barExport(ui).disabled, false);
  pending.resolve({ accountId: 'a', jobId: 'job-a', revision: 1, rowCount: 2, saved: true }); await ui.controller.idle();
  assert.equal(ui.get('broadcast-job-feedback').textContent, '');
  ui.switchAccount('a'); assert.equal(ui.get('broadcast-job-feedback').textContent, '已导出 2 条异常记录');
});

test('cancel and failure keep the job unchanged and permit an explicit retry', async (t) => {
  let fail = false;
  const initial = issueJob();
  const ui = await fixture({ initialJobs: [initial], before: (name, args) => {
    if (name !== 'export') return;
    if (fail) throw 'BROADCAST_EXPORT_FAILED';
    return { ...args, revision: 1, rowCount: 1, saved: false };
  } });
  t.after(() => ui.controller.dispose());
  await ui.fire(barExport(ui), 'click');
  assert.equal(ui.get('broadcast-job-feedback').textContent, '已取消导出');
  assert.equal(ui.get('broadcast-job-feedback').dataset.state, 'ready');
  fail = true; await ui.fire(barExport(ui), 'click');
  assert.match(ui.get('broadcast-job-feedback').textContent, /未能导出/);
  assert.equal(ui.get('broadcast-job-feedback').dataset.state, 'error'); assert.equal(barExport(ui).disabled, false);
  assert.deepEqual(ui.backend.jobs, [initial]);
});

test('an export response for another job is rejected without applying its revision or result', async (t) => {
  const ui = await fixture({ initialJobs: [issueJob()], before: (name) => name === 'export'
    ? { accountId: 'a', jobId: 'other-job', revision: 99, rowCount: 1, saved: true } : undefined });
  t.after(() => ui.controller.dispose());
  await ui.fire(barExport(ui), 'click');
  assert.match(ui.get('broadcast-job-feedback').textContent, /未能导出/);
  assert.equal(ui.backend.revision, 1); assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'job-a');
});

test('closing a record during export does not revive it when the save dialog completes', async (t) => {
  const pending = deferred();
  const ui = await fixture({ initialJobs: [issueJob('job-a', 'a', { state: 'completed' }), issueJob('older', 'a', { state: 'completed', createdAt: 0 })],
    before: (name) => name === 'export' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  barExport(ui).fire('click'); await flush();
  ui.get('broadcast-job-bar').querySelector('.bc-job-close').fire('click'); await flush();
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'older');
  pending.resolve({ accountId: 'a', jobId: 'job-a', revision: 1, rowCount: 1, saved: true }); await ui.controller.idle();
  assert.equal(ui.get('broadcast-job-bar').dataset.jobId, 'older');
  assert.equal(ui.get('broadcast-job-feedback').textContent, ''); assert.equal(ui.backend.jobs[0].dismissed, true);
});

test('disposal ignores the late native export completion', async () => {
  const pending = deferred();
  const ui = await fixture({ initialJobs: [issueJob()], before: (name) => name === 'export' ? pending.promise : undefined });
  barExport(ui).fire('click'); await flush();
  const feedback = ui.get('broadcast-job-feedback').textContent;
  ui.controller.dispose();
  pending.resolve({ accountId: 'a', jobId: 'job-a', revision: 1, rowCount: 1, saved: true }); await ui.controller.idle();
  assert.equal(ui.get('broadcast-job-feedback').textContent, feedback);
});
