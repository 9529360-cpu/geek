import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { fixture, deferred, catalog } from './helpers/broadcast.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const radio = (ui, value) => ui.get('broadcast-overlay').querySelectorAll('input')
  .find((node) => node.value === value && node.getAttribute('name') === 'bc-sendto');
async function mode(ui, value) { const node = radio(ui, value); node.checked = true; await ui.fire(node, 'change'); }
async function review(ui) { for (let i = 0; i < 3; i++) await ui.click('broadcast-workbench-next'); }
function resolved(accountId = 'a', ids = ['16665550101@c.us'], overrides = {}) {
  return { accountId, catalog: catalog(accountId, { catalogId: `${accountId}-resolve-${ids.join(',')}`,
    chats: [...catalog(accountId).chats, ...ids.map((id, index) => ({ id, name: `平台联系人 ${index + 1}`, realName: '', kind: 'contact' }))] }),
    recipientIds: ids, summary: { total: ids.length, accepted: ids.length, duplicates: 0, invalid: 0, unresolved: 0, skipped: 0 },
    ...overrides };
}

test('the named gateway forwards the frozen account, catalog and unparsed text once', async () => {
  const calls = [];
  const result = resolved();
  const api = connectDesktop(async (command, args) => { calls.push([command, args]); return result; });
  const text = '+16665550101\n+12223334444';
  assert.equal(await api.broadcastResolveRecipients('a', 'a-catalog', text), result);
  assert.deepEqual(calls, [['broadcast_resolve_recipients', { accountId: 'a', catalogId: 'a-catalog', text }]]);
  assert.equal(Object.hasOwn(api, 'invoke'), false);
});

test('the original paste entry verifies native identities before review and preserves manual and file audiences', async (t) => {
  const result = resolved('a', ['16665550101@c.us', '12223334444@lid'], {
    summary: { total: 5, accepted: 2, duplicates: 1, invalid: 1, unresolved: 1, skipped: 0 },
  });
  const file = { ...resolved('a', ['16665550202@c.us']), fileName: '客户.csv' };
  result.catalog.chats.push(file.catalog.chats.at(-1));
  const ui = await fixture({ before: (name) => name === 'resolve' ? result : name === 'import' ? file : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.select('a-ann'); await mode(ui, 'excel'); await ui.click('broadcast-import-csv');
  await mode(ui, 'paste');
  assert.equal(ui.get('bc-paste-numbers').disabled, false);
  assert.equal(ui.get('broadcast-verify-numbers').parentElement.classList.contains('bc-total'), true);
  assert.equal(ui.get('bc-sendto-paste').classList.contains('hidden'), false);
  assert.equal(ui.get('bc-sendto-custom').classList.contains('hidden'), true);
  const text = '+16665550101\r\n+12223334444\n+16665550101\ninvalid\n+17775550101';
  await ui.input('bc-paste-numbers', text); await ui.input('broadcast-message', 'Hello %nc');
  await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /先核验/);
  await ui.click('broadcast-verify-numbers');
  assert.deepEqual(ui.calls.find(([name]) => name === 'resolve')[1], { accountId: 'a', catalogId: file.catalog.catalogId, text });
  assert.equal(ui.get('bc-paste-total').textContent, '5');
  assert.match(ui.get('bc-paste-meta').textContent, /已核验 2.*重复 1.*格式无效 1.*未核验 1/);
  await mode(ui, 'custom'); assert.match(ui.get('bc-selected-chips').textContent, /Ann/);
  await mode(ui, 'excel'); assert.match(ui.get('bc-excel-meta').textContent, /已导入 1/);
  await mode(ui, 'paste'); assert.equal(ui.get('bc-paste-numbers').value, text);
  await review(ui); assert.match(ui.get('broadcast-review-card').textContent, /Hello 平台联系人 1/);
  await ui.click('broadcast-send');
  const payload = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(payload.recipientIds, result.recipientIds);
  assert.equal(payload.catalogId, result.catalog.catalogId);
  assert.equal(Object.hasOwn(payload, 'pasteText'), false);
  assert.equal(Object.hasOwn(payload, 'summary'), false);
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), result.recipientIds);
});

test('editing a verified input immediately invalidates its audience, including text A to B to A while verification is pending', async (t) => {
  const pending = deferred(); let hold = false;
  const ui = await fixture({ before: (name) => name === 'resolve' ? hold ? pending.promise : resolved() : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'paste'); await ui.input('bc-paste-numbers', '+16665550101');
  await ui.click('broadcast-verify-numbers'); await ui.input('broadcast-message', 'Preserved'); hold = true;
  ui.get('broadcast-verify-numbers').fire('click'); ui.get('broadcast-verify-numbers').fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'resolve').length, 2);
  assert.equal(ui.get('broadcast-verify-numbers').disabled, true);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('bc-paste-numbers').disabled, false);
  ui.get('bc-paste-numbers').value = '+16665550202'; ui.get('bc-paste-numbers').fire('input');
  ui.get('bc-paste-numbers').value = '+16665550101'; ui.get('bc-paste-numbers').fire('input');
  assert.match(ui.get('bc-paste-meta').textContent, /先核验/);
  pending.resolve(resolved()); await ui.controller.idle();
  await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.equal(ui.get('broadcast-message').value, 'Preserved');
  assert.match(ui.get('broadcast-workbench-status').textContent, /先核验/);
  hold = false; await ui.click('broadcast-verify-numbers'); await review(ui); await ui.click('broadcast-send');
  assert.equal(ui.backend.jobs[0].total, 1);
});

test('failed or invalid verification retains an unchanged prior audience and uses paste-specific error copy', async (t) => {
  let result = resolved(); let error = null;
  const ui = await fixture({ before: (name) => {
    if (name !== 'resolve') return;
    if (error) throw error;
    return result;
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'paste'); await ui.input('bc-paste-numbers', '+16665550101');
  await ui.click('broadcast-verify-numbers'); await ui.input('broadcast-message', 'Unchanged');
  error = 'BROADCAST_IMPORT_LIMIT'; await ui.click('broadcast-verify-numbers');
  assert.match(ui.get('bc-paste-meta').textContent, /128 KiB.*2000/);
  assert.doesNotMatch(ui.get('bc-paste-meta').textContent, /5 MiB|文件/);
  error = null;
  for (const invalid of [resolved('b'), { ...resolved(), recipientIds: ['unknown'] },
    resolved('a', [], { catalog: resolved().catalog })]) {
    result = invalid; await ui.click('broadcast-verify-numbers');
    assert.equal(ui.get('bc-paste-numbers').value, '+16665550101');
  }
  await review(ui); await ui.click('broadcast-send');
  assert.deepEqual(ui.backend.jobs[0].targets.map((target) => target.id), ['16665550101@c.us']);
});

for (const change of ['close', 'account-roundtrip', 'catalog']) {
  test(`a late paste verification cannot apply after ${change}`, async (t) => {
    const pending = deferred(); let reload = false;
    const ui = await fixture({ accountCatalogs: change === 'catalog' ? { a: { chats: [] } } : {}, before: (name, accountId) => {
      if (name === 'resolve') return pending.promise;
      if (name === 'catalog' && reload) return catalog(accountId, { catalogId: `${accountId}-new-catalog` });
    } });
    t.after(() => ui.controller.dispose());
    await ui.open(); if (change !== 'catalog') await ui.select('a-ann'); await mode(ui, 'paste');
    await ui.input('bc-paste-numbers', '+16665550101'); await ui.input('broadcast-message', 'Draft A');
    ui.get('broadcast-verify-numbers').fire('click'); await flush();
    if (change === 'close') { ui.get('broadcast-cancel').fire('click'); await flush(); }
    if (change === 'account-roundtrip') { ui.switchAccount('b'); ui.switchAccount('a'); }
    if (change === 'catalog') {
      reload = true;
      assert.equal(ui.get('broadcast-reload-chats').disabled, false);
      assert.equal(ui.get('broadcast-reload-chats').classList.contains('hidden'), false);
      ui.get('broadcast-reload-chats').fire('click'); await flush();
    }
    pending.resolve(resolved()); await ui.controller.idle();
    if (change === 'close') await ui.open();
    assert.equal(ui.get('bc-paste-numbers').value, '+16665550101');
    assert.equal(ui.get('broadcast-message').value, 'Draft A');
    assert.match(ui.get('bc-paste-meta').textContent, /先核验/);
    await review(ui); await ui.click('broadcast-send');
    assert.equal(ui.calls.some(([name]) => name === 'create'), false);
    if (change !== 'catalog') { await mode(ui, 'custom'); assert.match(ui.get('bc-selected-chips').textContent, /Ann/); }
  });
}

test('an oversized UTF-8 paste is rejected before IPC without truncating the draft', async (t) => {
  const ui = await fixture(); t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'paste');
  const text = '号'.repeat(44_000);
  await ui.input('bc-paste-numbers', text); await ui.click('broadcast-verify-numbers');
  assert.equal(ui.calls.some(([name]) => name === 'resolve'), false);
  assert.equal(ui.get('bc-paste-numbers').value, text);
  assert.match(ui.get('bc-paste-meta').textContent, /128 KiB/);
});

test('failed create keeps the verified paste and UUID, and platform name validation still applies', async (t) => {
  const result = resolved(); result.catalog.chats.at(-1).name = '';
  const ui = await fixture({ before: (name) => name === 'resolve' ? result : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await mode(ui, 'paste'); await ui.input('bc-paste-numbers', '+16665550101');
  await ui.click('broadcast-verify-numbers'); await ui.input('broadcast-message', 'Hello %nc'); await review(ui);
  await ui.click('broadcast-send'); assert.equal(ui.calls.some(([name]) => name === 'create'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /没有可用姓名/);
  await ui.input('broadcast-message', 'Hello'); ui.failures.add('create'); await review(ui); await ui.click('broadcast-send');
  const first = ui.calls.find(([name]) => name === 'create')[1];
  assert.match(ui.get('bc-paste-meta').textContent, /已核验 1/);
  assert.equal(ui.get('bc-paste-numbers').value, '+16665550101');
  ui.failures.clear(); await ui.click('broadcast-send');
  assert.equal(ui.calls.filter(([name]) => name === 'create').at(-1)[1].id, first.id);
  assert.equal(ui.backend.jobs.length, 1);
});
