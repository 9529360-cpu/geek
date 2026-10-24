import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, catalog } from './helpers/broadcast.mjs';
import { localSchedule } from '../frontend/models/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const radio = (ui, value) => ui.get('broadcast-overlay').querySelectorAll('input')
  .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
async function mode(ui, value) { const node = radio(ui, value); node.checked = true; await ui.fire(node, 'change'); }
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }
function imported(accountId = 'a', ids = ['16665550101@c.us'], overrides = {}) {
  return { accountId, fileName: '客户名单.csv',
    catalog: catalog(accountId, { catalogId: `${accountId}-import-${ids.join(',')}`, chats: [...catalog(accountId).chats,
      ...ids.map((id, index) => ({ id, name: `平台联系人 ${index + 1}`, realName: '', kind: 'contact' }))] }),
    recipientIds: ids, summary: { total: ids.length, accepted: ids.length, duplicates: 0, invalid: 0, unresolved: 0, skipped: 0 },
    ...overrides };
}

test('the original CSV entry uses a native catalog and preserves the separate manual audience', async (t) => {
  const result = imported('a', ['16665550101@c.us', '12223334444@lid'], {
    summary: { total: 12, accepted: 2, duplicates: 3, invalid: 1, unresolved: 2, skipped: 4 },
  });
  const ui = await fixture({ before: (name) => name === 'import' ? result : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-ann'); await mode(ui, 'excel');
  assert.equal(ui.get('bc-sendto-excel').classList.contains('hidden'), false);
  assert.equal(ui.get('bc-sendto-custom').classList.contains('hidden'), true);
  await ui.click('broadcast-import-csv');
  assert.deepEqual(ui.calls.find(([name]) => name === 'import')[1], { accountId: 'a', catalogId: 'a-catalog' });
  assert.equal(ui.get('bc-excel-meta').textContent, '已导入 2 个联系人，重复 3 个，格式无效 1 个，未核验 2 个，已跳过 4 个');
  assert.equal(ui.get('bc-excel-meta').title, '客户名单.csv');
  await mode(ui, 'custom'); assert.equal(ui.get('bc-selected-chips').children.length, 1);
  assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
  await mode(ui, 'excel'); await ui.input('broadcast-message', 'Hi %nc'); await review(ui);
  assert.match(ui.get('broadcast-review-card').textContent, /2 个对象/);
  assert.match(ui.get('broadcast-review-card').textContent, /Hi 平台联系人 1/);
  await ui.click('broadcast-send');
  const payload = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(payload.recipientIds, result.recipientIds); assert.equal(payload.catalogId, result.catalog.catalogId);
  assert.deepEqual(Object.keys(payload).sort(), ['id', 'accountId', 'catalogId', 'recipientIds', 'message', 'vcardIds',
    'attachmentIds', 'tagAll', 'intervalMin', 'intervalMax', 'scheduledAt'].sort());
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), result.recipientIds);
});

test('cancel, native failure, and an empty valid result preserve the prior imported audience and message', async (t) => {
  let response = imported(); let error = null;
  const ui = await fixture({ before: (name) => {
    if (name !== 'import') return;
    if (error) throw error;
    return response;
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await ui.input('broadcast-message', '保留原稿');
  const summary = ui.get('bc-excel-meta').textContent;
  response = null; await ui.click('broadcast-import-csv');
  assert.equal(ui.get('bc-excel-meta').textContent, summary);
  error = 'BROADCAST_IMPORT_INVALID'; await ui.click('broadcast-import-csv');
  assert.match(ui.get('bc-excel-meta').textContent, /格式无效/);
  error = null; response = imported('a', [], { catalog: imported().catalog }); await ui.click('broadcast-import-csv');
  assert.match(ui.get('bc-excel-meta').textContent, /没有可核验.*原选择已保留/);
  assert.equal(ui.get('broadcast-message').value, '保留原稿');
  await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.calls.find(([name]) => name === 'create')[1].recipientIds, ['16665550101@c.us']);
});

test('duplicate imports are coalesced while editing and close remain usable; a closed result is ignored', async (t) => {
  const pending = deferred();
  const ui = await fixture({ before: (name) => name === 'import' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-ann'); await mode(ui, 'excel');
  ui.get('broadcast-import-csv').fire('click'); ui.get('broadcast-import-csv').fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'import').length, 1);
  assert.equal(ui.get('broadcast-import-csv').disabled, true);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('broadcast-message').disabled, false);
  assert.equal(ui.get('broadcast-cancel').disabled, false);
  ui.get('broadcast-message').value = '选择文件时继续编辑'; ui.get('broadcast-message').fire('input');
  ui.get('broadcast-cancel').fire('click'); await flush(); assert.equal(ui.panel, null);
  pending.resolve(imported()); await ui.controller.idle();
  await ui.open(); assert.equal(ui.get('broadcast-message').value, '选择文件时继续编辑');
  assert.equal(radio(ui, 'excel').checked, true);
  assert.equal(ui.get('bc-excel-meta').textContent, '尚未导入联系人');
  await mode(ui, 'custom'); assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
});

test('an A to B to A switch invalidates an import without losing the old file selection', async (t) => {
  const pending = deferred(); let hold = false;
  const ui = await fixture({ before: (name) => name === 'import' ? hold ? pending.promise : imported() : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv'); hold = true;
  ui.get('broadcast-import-csv').fire('click'); await flush();
  ui.switchAccount('b'); ui.switchAccount('a');
  pending.resolve(imported('a', ['16665550202@c.us'])); await ui.controller.idle();
  assert.doesNotMatch(ui.get('bc-excel-meta').textContent, /正在/);
  await ui.input('broadcast-message', 'A retained'); await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.calls.find(([name]) => name === 'create')[1].recipientIds, ['16665550101@c.us']);
});

test('a late import error cannot overwrite another account editor or block its catalog', async (t) => {
  const pending = deferred();
  const ui = await fixture({ before: (name) => name === 'import' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-ann'); await mode(ui, 'excel');
  ui.get('broadcast-import-csv').fire('click'); await flush();
  await ui.hidePanel(); ui.switchAccount('b');
  ui.get('btn-broadcast').fire('click'); await flush(); ui.get('bc-menu-send').fire('click'); await flush();
  assert.equal(ui.get('broadcast-list').querySelectorAll('input')[0].value, 'b-ann');
  ui.get('broadcast-message').value = 'B draft'; ui.get('broadcast-message').fire('input');
  pending.reject('BROADCAST_IMPORT_UNAVAILABLE'); await ui.controller.idle();
  assert.equal(ui.get('broadcast-message').value, 'B draft');
  assert.doesNotMatch(ui.get('bc-excel-meta').textContent, /暂时无法核验/);
  assert.equal(ui.get('broadcast-import-csv').disabled, false);
  await ui.hidePanel(); ui.switchAccount('a'); await ui.open(); await mode(ui, 'custom');
  assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
});

test('wrong owners, out-of-catalog identities, and inconsistent counts never replace an import', async (t) => {
  let response = imported();
  const ui = await fixture({ before: (name) => name === 'import' ? response : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  const invalid = [imported('b'), { ...imported(), recipientIds: ['not-verified'] },
    { ...imported(), summary: { total: 2, accepted: 1, duplicates: 0, invalid: 0, unresolved: 0, skipped: 0 } }];
  for (const value of invalid) {
    response = value; await ui.click('broadcast-import-csv');
    assert.match(ui.get('bc-excel-meta').textContent, /格式无效/);
  }
  await ui.input('broadcast-message', 'Original audience'); await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.calls.find(([name]) => name === 'create')[1].recipientIds, ['16665550101@c.us']);
});

test('reopening retains imported IDs, while a new generation missing them reports stale without dropping them', async (t) => {
  let changed = false;
  const ui = await fixture({ before: (name, value) => {
    if (name === 'import') return imported();
    if (name === 'catalog' && changed) return catalog(value, { catalogId: 'replacement-generation' });
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await ui.input('broadcast-message', 'Retained'); await ui.click('broadcast-cancel'); await ui.open();
  assert.equal(radio(ui, 'excel').checked, true); assert.match(ui.get('bc-excel-meta').textContent, /已导入 1/);
  await ui.click('broadcast-cancel'); changed = true; await ui.open();
  assert.match(ui.get('bc-excel-meta').textContent, /已失效/);
  await review(ui); assert.match(ui.get('broadcast-review-card').textContent, /1 个对象/);
  await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /聊天列表已变化/);
});

test('failed creation keeps the same import and UUID; accepted schedules keep independent frozen audiences', async (t) => {
  let response = imported();
  const ui = await fixture({ before: (name) => name === 'import' ? response : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await ui.input('broadcast-message', 'First'); await ui.input('broadcast-schedule-toggle', true, 'change');
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  ui.failures.add('create'); await ui.click('broadcast-add-schedule');
  const first = ui.calls.filter(([name]) => name === 'create').at(-1)[1];
  assert.equal(ui.get('broadcast-message').value, 'First'); assert.match(ui.get('bc-excel-meta').textContent, /已导入 1/);
  ui.failures.clear(); await ui.click('broadcast-add-schedule');
  assert.equal(ui.calls.filter(([name]) => name === 'create').at(-1)[1].id, first.id);
  assert.equal(ui.get('broadcast-message').value, ''); assert.equal(radio(ui, 'excel').checked, true);
  response = imported('a', ['16665550202@c.us']); await ui.click('broadcast-import-csv');
  await ui.input('broadcast-message', 'Second'); await ui.click('broadcast-add-schedule');
  assert.deepEqual(ui.backend.jobs.map((job) => job.targets.map((target) => target.id)), [['16665550101@c.us'], ['16665550202@c.us']]);
});

test('imported IDs and file names never become fallback values for missing platform names', async (t) => {
  const result = imported(); result.catalog.chats.at(-1).name = ''; result.fileName = '名叫张三的客户.csv';
  const ui = await fixture({ before: (name) => name === 'import' ? result : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await ui.input('broadcast-message', 'Hi %nc'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /没有可用姓名/);
  assert.doesNotMatch(ui.get('broadcast-review-card').textContent, /Hi 1666555|Hi 名叫张三/);
});
