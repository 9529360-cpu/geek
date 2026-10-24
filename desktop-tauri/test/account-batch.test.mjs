import test from 'node:test';
import assert from 'node:assert/strict';
import { batchCount } from '../frontend/models/creation.mjs';
import { errorMessage } from '../frontend/model.mjs';
import { fixture } from './helpers/shell.mjs';

async function draft(ui, count = '3') {
  await ui.click('btn-app-center');
  ui.get('add-platforms').children.find((e) => e.dataset.type === 'whatsapp').fire('click');
  ui.get('add-name').value = 'Team';
  ui.get('add-count').value = count;
}

test('batch counts are bounded integers, not silently truncated or defaulted', () => {
  for (const value of ['', '0', '11', '-1', '1.5', '1e1', '2abc', 'Infinity', null, true]) {
    assert.throws(() => batchCount(value), (error) => error === 'BATCH_INVALID');
  }
  for (let count = 1; count <= 10; count++) assert.equal(batchCount(` ${count} `), count);
});

test('original count input creates one batch with the selected proxy and opens only its first ID', async () => {
  const ui = await fixture();
  await draft(ui);
  assert.equal(ui.get('add-count').disabled, false);
  ui.get('create-proxy-mode').value = 'socks5';
  ui.get('create-proxy-mode').fire('change');
  ui.get('create-proxy-host').value = '127.0.0.1';
  ui.get('create-proxy-port').value = '1080';
  ui.get('add-confirm').fire('click');
  ui.get('add-confirm').fire('click'); // A rapid double click cannot submit twice.
  await ui.shell.idle();
  assert.equal(ui.state.accounts.length, 5);
  assert.deepEqual(ui.state.accounts.slice(2).map((a) => a.name), ['Team 1', 'Team 2', 'Team 3']);
  assert.deepEqual(ui.calls.filter(([n]) => n === 'account_create_batch').map(([, args]) => args), [{
    name: 'Team', count: 3, platformId: 'whatsapp', websiteUrl: null,
    proxy: { mode: 'socks5', host: '127.0.0.1', port: 1080 },
  }]);
  assert.deepEqual(ui.calls.filter(([n]) => n === 'account_activate'), [['account_activate', { id: 'new-2' }]]);
  assert.equal(ui.state.activeId, 'new-2');
  assert.equal(ui.state.openedIds.includes('new-3'), false);
  assert.equal(ui.state.openedIds.includes('new-4'), false);
  assert.equal(ui.calls.some(([n]) => n === 'account_create'), false);
  await ui.click('btn-app-center');
  assert.equal(ui.get('add-count').value, '1');
});

test('failed batch persistence retains the draft and never activates or automatically retries', async () => {
  const ui = await fixture();
  await draft(ui);
  ui.failures.add('account_create_batch');
  await ui.click('add-confirm');
  assert.equal(ui.state.accounts.length, 2);
  assert.equal(ui.state.activeId, 'a');
  assert.equal(ui.get('add-name').value, 'Team');
  assert.equal(ui.get('add-count').value, '3');
  assert.equal(ui.get('add-overlay').classList.contains('hidden'), false);
  assert.equal(ui.calls.some(([n]) => n === 'account_activate'), false);
  assert.equal(ui.calls.filter(([n]) => n === 'account_create_batch').length, 1);
  ui.failures.clear();
  await ui.click('add-confirm');
  assert.equal(ui.state.accounts.length, 5);
});

test('invalid form counts never reach creation IPC and leave the dialog open', async () => {
  const ui = await fixture();
  await draft(ui, '2.5');
  await ui.click('add-confirm');
  assert.equal(ui.state.accounts.length, 2);
  assert.equal(ui.calls.some(([n]) => n === 'account_create_batch'), false);
  assert.equal(ui.get('add-overlay').classList.contains('hidden'), false);
  assert.equal(ui.get('add-status').textContent, errorMessage('BATCH_INVALID'));
});

test('failure to open a saved batch is reported separately and cannot replay creation', async () => {
  const ui = await fixture();
  await draft(ui);
  ui.failures.add('account_activate');
  await ui.click('add-confirm');
  assert.equal(ui.state.accounts.length, 5);
  assert.equal(ui.state.activeId, 'a');
  assert.equal(ui.get('add-overlay').classList.contains('hidden'), true);
  assert.equal(ui.get('runtime-status-message').textContent, errorMessage('ACCOUNTS_CREATED_OPEN_FAILED'));
  assert.equal(ui.calls.filter(([n]) => n === 'account_create_batch').length, 1);
  ui.failures.clear();
  ui.get('nav-accounts').children.find((e) => e.dataset.id === 'new-2').fire('click');
  await ui.shell.idle();
  assert.equal(ui.state.activeId, 'new-2');
  assert.equal(ui.state.accounts.length, 5);
  assert.equal(ui.calls.filter(([n]) => n === 'account_create_batch').length, 1);
});

test('blank names are submitted to Rust for authoritative platform numbering', async () => {
  const ui = await fixture();
  await draft(ui, '2');
  ui.get('add-name').value = '   ';
  await ui.click('add-confirm');
  const request = ui.calls.find(([n]) => n === 'account_create_batch')[1];
  assert.equal(request.name, '');
  assert.equal(request.count, 2);
  assert.deepEqual(ui.state.accounts.slice(2).map((a) => a.name), ['WhatsApp 3', 'WhatsApp 4']);
});
