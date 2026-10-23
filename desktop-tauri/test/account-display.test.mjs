import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';
import { accountDisplay, displayFromFields } from '../frontend/models/account-display.mjs';
import { connectDesktop } from '../frontend/api/desktop.mjs';

test('display defaults and invalid snapshot styles cannot inject CSS', () => {
  assert.deepEqual(accountDisplay({}), { fontSize: 16, fontColor: '#18A058' });
  assert.deepEqual(accountDisplay({ fontSize: '16;display:none', fontColor: 'url(https://private.invalid)' }),
    { fontSize: 16, fontColor: '#18A058' });
  assert.deepEqual(displayFromFields(' B ', '28', '#ab12ef'), { name: 'B', fontSize: 28, fontColor: '#AB12EF' });
  for (const size of ['', '9', '29', '16.5', 'NaN', 'Infinity']) {
    assert.throws(() => displayFromFields('B', size, '#18A058'), (error) => error === 'APPEARANCE_INVALID');
  }
  for (const color of ['#abc', '#12345678', 'red', '#18A058;display:none', '']) {
    assert.throws(() => displayFromFields('B', '16', color), (error) => error === 'APPEARANCE_INVALID');
  }
});

test('display gateway captures all fields in one named native operation', async () => {
  const calls = [];
  const api = connectDesktop(async (command, args) => { calls.push([command, args]); return 'committed'; });
  assert.equal(await api.updateDisplay('b', 'B', 24, '#112233'), 'committed');
  assert.deepEqual(calls, [['account_update_display', { id: 'b', name: 'B', fontSize: 24, fontColor: '#112233' }]]);
});

test('original account editor enables appearance fields and commits the non-active owner once', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  assert.equal(ui.get('account-settings-fontSize').disabled, false);
  assert.equal(ui.get('account-settings-fontColor').disabled, false);
  assert.equal(ui.get('account-settings-fontSize').value, '16');
  assert.equal(ui.get('account-settings-fontColor').value, '#18A058');
  ui.get('account-settings-name').value = ' B updated ';
  ui.get('account-settings-fontSize').value = '24';
  ui.get('account-settings-fontColor').value = '#ab12ef';
  await ui.click('account-settings-save');
  assert.deepEqual(ui.calls.filter(([name]) => name === 'account_update_display'), [
    ['account_update_display', { id: 'b', name: 'B updated', fontSize: 24, fontColor: '#AB12EF' }],
  ]);
  assert.equal(ui.state.activeId, 'a');
  assert.deepEqual(ui.state.openedIds, ['a', 'b']);
  assert.equal(ui.calls.some(([name]) => name === 'account_activate'), false);
  const label = ui.get('nav-accounts').children[1].querySelector('.nav-account-name');
  assert.equal(label.textContent, 'B updated');
  assert.equal(label.style.fontSize, '24px');
  assert.equal(label.style.color, '#AB12EF');
  await ui.context('b', 1);
  assert.equal(ui.get('account-settings-fontSize').value, '24');
  assert.equal(ui.get('account-settings-fontColor').value, '#AB12EF');
});

test('failed appearance save retains every draft field and prior sidebar presentation', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  ui.get('account-settings-name').value = 'Draft B';
  ui.get('account-settings-fontSize').value = '28';
  ui.get('account-settings-fontColor').value = '#123456';
  ui.failures.add('account_update_display');
  await ui.click('account-settings-save');
  assert.equal(ui.get('account-settings-name').value, 'Draft B');
  assert.equal(ui.get('account-settings-fontSize').value, '28');
  assert.equal(ui.get('account-settings-fontColor').value, '#123456');
  const label = ui.get('nav-accounts').children[1].querySelector('.nav-account-name');
  assert.equal(label.textContent, 'b');
  assert.equal(label.style.fontSize, '16px');
  assert.equal(label.style.color, '#18A058');
  assert.equal(ui.get('account-settings-overlay').classList.contains('hidden'), false);
  assert.equal(ui.state.activeId, 'a');
  ui.failures.clear();
  await ui.click('runtime-retry');
  assert.equal(ui.calls.filter(([name]) => name === 'account_update_display').length, 1);
  assert.equal(ui.get('account-settings-fontSize').value, '28');
  await ui.click('account-settings-save');
  assert.equal(ui.state.accounts[1].fontSize, 28);
  assert.equal(ui.state.accounts[1].fontColor, '#123456');
});

test('invalid appearance is rejected before native save without discarding the draft', async () => {
  const ui = await fixture();
  await ui.context('b', 1);
  ui.get('account-settings-name').value = 'Draft';
  ui.get('account-settings-fontSize').value = '10.5';
  await ui.click('account-settings-save');
  assert.equal(ui.calls.some(([name]) => name === 'account_update_display'), false);
  assert.equal(ui.get('account-settings-fontSize').value, '10.5');
  assert.equal(ui.state.accounts[1].name, 'b');
  assert.equal(ui.get('account-settings-overlay').classList.contains('hidden'), false);
  assert.match(ui.get('account-settings-status').textContent, /10–28/);
});
