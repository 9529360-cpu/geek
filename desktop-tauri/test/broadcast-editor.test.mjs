import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, catalog } from './helpers/broadcast.mjs';
import { localSchedule } from '../frontend/models/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }

test('the original four steps wire selection, variables, intervals, and one immutable create', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open();
  assert.equal(ui.panel, 'broadcast-overlay');
  assert.equal(ui.get('broadcast-add-file').disabled, true);
  assert.match(ui.get('broadcast-add-file').title, /尚未迁移/);
  assert.equal(ui.get('broadcast-import-csv').disabled, true);
  assert.equal(ui.get('broadcast-workbench-nav').children.length, 4);
  assert.equal(ui.get('broadcast-send').classList.contains('hidden'), true);
  await ui.input('broadcast-message', 'Hi ');
  await ui.click('broadcast-insert-var');
  await ui.click('broadcast-workbench-next');
  await ui.input('broadcast-search', 'ann');
  await ui.click('broadcast-select-all');
  assert.equal(ui.get('bc-selected-chips').children.length, 1);
  await ui.input('broadcast-search', '');
  await ui.click('broadcast-select-groups');
  await ui.click('broadcast-workbench-next');
  await ui.input('bc-range-min', '12');
  await ui.input('bc-range-max', '18');
  await ui.click('broadcast-workbench-next');
  assert.equal(ui.get('broadcast-send').classList.contains('hidden'), false);
  assert.match(ui.get('broadcast-review-card').textContent, /Alice account/);
  assert.match(ui.get('broadcast-review-card').textContent, /Hi Ann/);
  await ui.click('broadcast-send');
  const creates = ui.calls.filter(([name]) => name === 'create');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1], { id: '00000000-0000-4000-8000-000000000001', accountId: 'a', catalogId: 'a-catalog',
    recipientIds: ['a-ann', 'a-team'], message: 'Hi %nc', vcardIds: [], tagAll: false,
    intervalMin: 12, intervalMax: 18, scheduledAt: null });
  assert.equal(ui.panel, null);
  assert.equal(ui.get('broadcast-job-bar').classList.contains('hidden'), false);
  assert.equal(ui.shell.activeId, 'a');
});

test('duplicate creation is coalesced and failed retries preserve the draft and UUID', async (t) => {
  const request = deferred(); let wait = true;
  const ui = await fixture({ before: (name) => name === 'create' && wait ? request.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'Draft %nc'); await ui.select('a-ann'); await review(ui);
  ui.get('broadcast-send').fire('click'); ui.get('broadcast-send').fire('click');
  await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(ui.get('broadcast-send').disabled, true);
  request.reject('STORE_IO'); await ui.controller.idle(); wait = false;
  assert.equal(ui.get('broadcast-message').value, 'Draft %nc');
  assert.equal(ui.get('bc-selected-chips').children.length, 1);
  assert.equal(ui.panel, 'broadcast-overlay');
  assert.equal(ui.get('broadcast-job-bar').classList.contains('hidden'), true);
  ui.failures.add('create'); await ui.click('broadcast-send');
  const failed = ui.calls.filter(([name]) => name === 'create');
  assert.equal(failed[0][1].id, failed[1][1].id);
  await ui.input('broadcast-message', 'Changed %nc'); ui.failures.clear(); await ui.click('broadcast-send');
  const accepted = ui.calls.filter(([name]) => name === 'create').at(-1)[1];
  assert.notEqual(accepted.id, failed[0][1].id);
  assert.equal(ui.backend.jobs.length, 1);
});

test('a slow catalog permits message editing and cannot overwrite a later account editor', async (t) => {
  const first = deferred();
  const ui = await fixture({ before: (name, value) => name === 'catalog' && value === 'a' ? first.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.click('btn-broadcast'); ui.get('bc-menu-send').fire('click'); await flush();
  assert.equal(ui.get('broadcast-message').disabled, false);
  ui.get('broadcast-message').value = 'A unsent draft'; ui.get('broadcast-message').fire('input');
  await ui.hidePanel(); ui.switchAccount('b');
  ui.get('btn-broadcast').fire('click'); await flush(); ui.get('bc-menu-send').fire('click'); await flush();
  assert.equal(ui.get('broadcast-message').value, '');
  assert.equal(ui.get('broadcast-list').querySelectorAll('input')[0].value, 'b-ann');
  first.resolve(catalog('a')); await ui.controller.idle();
  assert.equal(ui.get('broadcast-list').querySelectorAll('input')[0].value, 'b-ann');
  await ui.hidePanel(); ui.switchAccount('a'); await ui.open();
  assert.equal(ui.get('broadcast-message').value, 'A unsent draft');
});

test('switching the active account never retargets an open draft', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'A draft'); await ui.select('a-ann'); await review(ui);
  ui.switchAccount('b'); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.equal(ui.get('broadcast-message').value, 'A draft');
  assert.match(ui.get('broadcast-workbench-status').textContent, /发送账号已切换/);
  assert.equal(ui.get('broadcast-send').disabled, true);
});

test('invalid scheduled time stays a draft; durable scheduling can add a second independent task', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'First'); await ui.select('a-ann');
  await ui.input('broadcast-schedule-toggle', true, 'change'); await ui.input('broadcast-schedule-time', '');
  await ui.click('broadcast-add-schedule');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /未来/);
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  await ui.click('broadcast-add-schedule');
  assert.equal(ui.panel, 'broadcast-overlay');
  assert.equal(ui.get('broadcast-message').value, '');
  assert.equal(ui.get('bc-selected-chips').children.length, 1);
  assert.match(ui.get('broadcast-schedule-list').textContent, /待发送 1 条/);
  await ui.input('broadcast-message', 'Second'); ui.failures.add('create');
  await ui.click('broadcast-add-schedule');
  assert.equal(ui.get('broadcast-message').value, 'Second');
  assert.equal(ui.backend.jobs.length, 1);
  const retryId = ui.calls.filter(([name]) => name === 'create').at(-1)[1].id;
  ui.failures.clear(); await ui.click('broadcast-add-schedule');
  assert.equal(ui.calls.filter(([name]) => name === 'create').at(-1)[1].id, retryId);
  assert.equal(ui.backend.jobs.length, 2);
  assert.equal(ui.get('broadcast-message').value, '');
  assert.match(ui.get('broadcast-schedule-list').textContent, /待发送 2 条/);
});

test('vCards are selected from the bound catalog and pure vCard mentions are rejected', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-team');
  await ui.input('broadcast-add-vcard', true, 'change');
  const card = ui.get('bc-vcard-list').querySelectorAll('input').find((node) => node.value === 'a-ann');
  card.checked = true; await ui.fire(card, 'change');
  await ui.input('broadcast-tagall', true, 'change'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /需要文本/);
  await ui.input('broadcast-message', 'Hello team'); await review(ui); await ui.click('broadcast-send');
  const payload = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(payload.vcardIds, ['a-ann']); assert.equal(payload.tagAll, true);
});

test('unsupported account and capability controls remain explicitly unavailable', async (t) => {
  const ui = await fixture({ accountCatalogs: { a: { capabilities: { text: true, scheduled: true, vcards: false, tagAll: false } } } });
  t.after(() => ui.controller.dispose());
  await ui.open();
  assert.equal(ui.get('broadcast-add-vcard').disabled, true); assert.equal(ui.get('broadcast-tagall').disabled, true);
  await ui.hidePanel(); ui.switchAccount('tg');
  assert.equal(ui.get('btn-broadcast').disabled, true);
  assert.match(ui.get('btn-broadcast').title, /尚未迁移/);
  assert.equal(ui.get('broadcast-task-center-button').disabled, false);
});

test('a retired request stays a draft and never silently creates a replacement task', async (t) => {
  const ui = await fixture({ before: (name) => { if (name === 'create') throw 'BROADCAST_RETIRED'; } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'Closed request'); await ui.select('a-ann'); await review(ui);
  await ui.click('broadcast-send'); await ui.tick();
  assert.equal(ui.calls.filter(([name]) => name === 'create').length, 1);
  assert.match(ui.get('broadcast-workbench-status').textContent, /任务记录已关闭，请新建任务/);
  assert.equal(ui.get('broadcast-message').value, 'Closed request');
  await ui.click('broadcast-send');
  const requests = ui.calls.filter(([name]) => name === 'create');
  assert.equal(requests[0][1].id, requests[1][1].id);
  assert.equal(ui.backend.jobs.length, 0);
});
