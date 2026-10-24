import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, turn, history } from './helpers/advanced-tools.mjs';

const commands = (ui, name) => ui.calls.filter(([command]) => command === name);

test('contacts export uses the named native boundary only after the original button, with duplicate-click protection', async () => {
  const gate = deferred();
  const ui = await fixture({ before: async (command) => {
    if (command === 'broadcast_export_contacts') await gate.promise;
  } });
  await ui.click('bc-menu-export');
  assert.equal(commands(ui, 'broadcast_export_contacts').length, 0);
  assert.equal(ui.get('advanced-tools-overlay').classList.contains('hidden'), false);
  assert.match(ui.get('at-subtitle').textContent, /客服甲/);
  assert.equal(commands(ui, 'desktop_layout').at(-1)[1].viewport.visible, false);
  ui.get('at-export-contacts').fire('click'); ui.get('at-export-contacts').fire('click');
  await turn();
  assert.deepEqual(commands(ui, 'broadcast_export_contacts'), [['broadcast_export_contacts', { accountId: 'a' }]]);
  assert.equal(ui.get('at-export-contacts').disabled, true);
  assert.match(ui.get('at-status-contacts').textContent, /正在读取/);
  gate.resolve(); await ui.idle();
  assert.match(ui.get('at-status-contacts').textContent, /已导出 3 个/);
  assert.equal(ui.get('at-export-contacts').disabled, false);
  await ui.click('at-close');
  assert.equal(commands(ui, 'desktop_layout').at(-1)[1].viewport.visible, true);
});

test('contacts cancellation, empty export and native errors remain accurate and retryable without leaking paths', async () => {
  let result = { accountId: 'a', revision: null, rowCount: 0, saved: false };
  const ui = await fixture({ before: (command) => command === 'broadcast_export_contacts' ? result : undefined });
  await ui.click('bc-menu-export'); await ui.click('at-export-contacts');
  assert.equal(ui.get('at-status-contacts').textContent, '已取消导出。');
  result = { ...result, saved: true }; await ui.click('at-export-contacts');
  assert.equal(ui.get('at-status-contacts').textContent, '已导出 0 个联系人。');
  result = undefined; ui.failures.set('broadcast_export_contacts', 'BROADCAST_UNSUPPORTED');
  await ui.click('at-export-contacts'); assert.match(ui.get('at-status-contacts').textContent, /当前平台暂不支持读取联系人/);
  ui.failures.set('broadcast_export_contacts', new Error('C:\\private\\profile\\secret.csv'));
  await ui.click('at-export-contacts'); assert.doesNotMatch(ui.get('at-status-contacts').textContent, /private|secret/);
  ui.failures.clear(); await ui.click('at-export-contacts');
  assert.equal(ui.get('at-status-contacts').dataset.state, 'success');
});

test('report separates uncertain and pending from failures, retains all task states and exports its exact revision', async () => {
  const ui = await fixture();
  ui.histories.get('a').rows[0].message = 'SECRET SYNTHETIC BODY';
  await ui.click('bc-menu-report');
  assert.deepEqual(ui.document.querySelectorAll('.at-stat').map((node) => node.textContent), ['群发任务2', '发送对象12', '成功4', '失败2']);
  assert.match(ui.get('at-body').textContent, /结果不确定 1，未处理 5/);
  assert.deepEqual(ui.document.querySelectorAll('th').map((node) => node.textContent),
    ['时间', '对象', '成功', '失败', '结果不确定', '未处理', '附件', '状态']);
  assert.match(ui.get('at-body').textContent, /任务记录/);
  assert.match(ui.get('at-body').textContent, /已定时/);
  assert.match(ui.get('at-body').textContent, /已暂停/);
  assert.doesNotMatch(ui.get('at-body').textContent, /SECRET SYNTHETIC BODY/);
  await ui.click('at-export-report');
  assert.deepEqual(commands(ui, 'broadcast_export_history').at(-1), ['broadcast_export_history', { accountId: 'a', expectedRevision: 7 }]);
  assert.equal(ui.get('at-status-report').textContent, '已导出 2 条任务记录。');
  ui.histories.set('a', history('a', 8));
  await ui.click('at-export-report');
  assert.match(ui.get('at-status-report').textContent, /重新读取后导出/);
  await ui.click('at-refresh-report'); await ui.click('at-export-report');
  assert.equal(commands(ui, 'broadcast_export_history').at(-1)[1].expectedRevision, 8);
});

test('report loading failure and empty data have a usable retry without enabling empty CSV export', async () => {
  const ui = await fixture();
  ui.failures.set('broadcast_history', 'STATE_UNAVAILABLE');
  await ui.click('bc-menu-report');
  assert.equal(ui.get('at-status-report').dataset.state, 'error');
  assert.match(ui.get('at-body').textContent, /请重新读取/);
  assert.equal(ui.get('at-export-report').disabled, true);
  ui.failures.clear();
  ui.histories.set('a', { accountId: 'a', revision: 0, summary: { jobs: 0, total: 0, ok: 0, fail: 0, uncertain: 0, pending: 0 }, rows: [] });
  await ui.click('at-refresh-report');
  assert.match(ui.get('at-body').textContent, /没有保留的群发任务/);
  assert.equal(ui.get('at-export-report').disabled, true);
  assert.equal(ui.get('at-refresh-report').disabled, false);
  assert.equal(commands(ui, 'broadcast_export_history').length, 0);
});

test('A to B to A and closing invalidate delayed contacts and report replies', async () => {
  const gate = deferred();
  let delay = true;
  const ui = await fixture({ before: async (command) => {
    if (command === 'broadcast_export_contacts' && delay) await gate.promise;
  } });
  await ui.click('bc-menu-export'); ui.get('at-export-contacts').fire('click'); await turn();
  ui.select('b'); ui.select('a');
  gate.resolve(); await ui.idle();
  assert.match(ui.get('at-status-contacts').textContent, /账号已切换/);
  assert.equal(ui.get('at-export-contacts').disabled, true);
  await ui.click('at-close'); delay = false;
  await ui.click('bc-menu-export'); await ui.click('at-export-contacts');
  assert.match(ui.get('at-status-contacts').textContent, /已导出/);

  const reportGate = deferred(); let wait = true;
  const second = await fixture({ before: async (command, args) => {
    if (command === 'broadcast_history' && wait) { await reportGate.promise; return history(args.accountId, 99); }
  } });
  second.get('bc-menu-report').fire('click'); await turn();
  second.get('at-close').fire('click'); await turn(); wait = false;
  second.get('bc-menu-report').fire('click'); await turn();
  reportGate.resolve(); await second.idle(); await second.click('at-export-report');
  assert.equal(commands(second, 'broadcast_export_history').at(-1)[1].expectedRevision, 7);
});

test('native hide failure or an account switch while opening cannot expose a stale modal or start a read', async () => {
  const gate = deferred(); let hold = true;
  const ui = await fixture({ layoutBefore: async (viewport) => { if (hold && !viewport.visible) await gate.promise; } });
  ui.get('bc-menu-report').fire('click'); await turn();
  assert.equal(ui.get('advanced-tools-overlay').classList.contains('hidden'), true);
  ui.select('b'); gate.resolve(); await ui.idle();
  assert.equal(ui.get('advanced-tools-overlay').classList.contains('hidden'), true);
  assert.equal(commands(ui, 'broadcast_history').length, 0);
  hold = false; ui.failures.set('desktop_layout', 'WEBVIEW_FAILED');
  await ui.click('bc-menu-export');
  assert.equal(ui.get('advanced-tools-overlay').classList.contains('hidden'), true);
  assert.match(ui.errors.at(-1), /WebView2/);
  ui.failures.clear(); await ui.click('bc-menu-export');
  assert.match(ui.get('at-subtitle').textContent, /客服乙/);
});

test('the actual shell exposes advanced tools for a valid unsupported-send account and keeps window controls independent', async () => {
  const gate = deferred();
  const ui = await fixture({ fullShell: true, before: async (command) => {
    if (command === 'account_export_backup') await gate.promise;
  } });
  ui.select('other'); await ui.idle();
  assert.equal(ui.get('btn-broadcast').disabled, false);
  await ui.click('btn-broadcast');
  assert.equal(ui.get('bc-menu-send').disabled, true);
  assert.equal(ui.get('bc-menu-backup').disabled, false);
  await ui.click('bc-menu-backup');
  ui.get('at-export-backup').fire('click'); await turn();
  ui.get('btn-win-min').fire('click'); await turn();
  assert.deepEqual(commands(ui, 'desktop_window').at(-1), ['desktop_window', { action: 'minimize' }]);
  assert.equal(ui.get('at-export-backup').disabled, true);
  gate.resolve(); await ui.idle();
  assert.deepEqual(commands(ui, 'account_export_backup').at(-1), ['account_export_backup', { accountId: 'other' }]);
});

test('missing native tool APIs keep original entries unavailable without starting background operations', async () => {
  const ui = await fixture({ missing: ['broadcastExportContacts', 'broadcastHistory', 'broadcastExportHistory',
    'accountExportBackup', 'accountPickBackup', 'accountRestoreBackup'] });
  for (const id of ['bc-menu-export', 'bc-menu-report', 'bc-menu-backup']) assert.equal(ui.get(id).disabled, true);
  assert.deepEqual(ui.calls, []);
});
