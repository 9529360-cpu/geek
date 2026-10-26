import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/shell.mjs';
import { describeNotice, badgeText } from '../frontend/models/unread.mjs';
import { paintUnread } from '../frontend/controllers/unread.mjs';

test('new-message copy is only the platform and the count', () => {
  const account = { id: 'a', name: '柜员', platformId: 'whatsapp' };
  assert.deepEqual(describeNotice(account, 3), {
    title: '柜员',
    body: 'WHATSAPP 收到 3 条新消息',
  });
  assert.equal(describeNotice({ id: 't', name: '', platformId: 'telegram-k' }, 12).body,
    'TELEGRAM 收到 12 条新消息');
  assert.equal(describeNotice({ id: 'm', name: '聊天正文不应出现', platformId: 'messenger' }, 2), null);
  assert.equal(describeNotice(account, 0), null);
  assert.equal(describeNotice(account, 1.5), null);
  assert.equal(badgeText(120), '99+');
  assert.equal(badgeText(0), '');
});

test('badges follow the count and only an unselected family flashes', async () => {
  const ui = await fixture({ initialState: {
    accounts: [
      { id: 'a', name: 'WA', platformId: 'whatsapp', archived: false, proxy: { mode: 'system' } },
      { id: 't', name: 'TG', platformId: 'telegram-k', archived: false, proxy: { mode: 'system' } },
    ],
    activeId: 'a',
    openedIds: ['a'],
  } });
  paintUnread(ui.document, ui.state, [{ id: 't', count: 4 }, { id: 'a', count: 2 }, { id: 'nope', count: -1 }]);
  const wa = ui.get('nav-accounts').children.find((row) => row.dataset.id === 'a');
  assert.equal(wa.querySelector('.acc-dot').textContent, '2');
  assert.equal(wa.querySelector('.acc-dot').getAttribute('data-count'), '2');
  const tabs = [...ui.get('account-tabs').children];
  const telegram = tabs.find((tab) => tab.dataset.platform === 'telegram');
  const whatsapp = tabs.find((tab) => tab.dataset.platform === 'whatsapp');
  assert.equal(telegram.querySelector('.tab-dot').getAttribute('data-on'), 'true');
  assert.equal(telegram.classList.contains('flash'), true);
  assert.equal(whatsapp.classList.contains('flash'), false);
  paintUnread(ui.document, ui.state, []);
  assert.equal(wa.querySelector('.acc-dot').textContent, '');
  assert.equal(wa.querySelector('.acc-dot').hasAttribute('data-count'), false);
  assert.equal(telegram.querySelector('.tab-dot').hasAttribute('data-on'), false);
  assert.equal(ui.calls.some(([name]) => name === 'unread_poll'), false);
});
