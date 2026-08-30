'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : !!force;
      if (next) values.add(name); else values.delete(name);
      return next;
    },
  };
}

function node(id) {
  return {
    id,
    value: '',
    checked: false,
    disabled: false,
    textContent: '',
    dataset: {},
    classList: classList(id === 'settings-overlay' ? ['hidden'] : []),
    isConnected: true,
    focus() {},
    addEventListener() {},
    closest() { return null; },
  };
}

const nodes = new Map();
const get = id => {
  if (!nodes.has(id)) nodes.set(id, node(id));
  return nodes.get(id);
};
const tabs = [
  Object.assign(node('tab-account-center'), { dataset: { tab: 'account-center' }, classList: classList(['active']) }),
  Object.assign(node('tab-global'), { dataset: { tab: 'global' }, classList: classList() }),
];

const document = {
  activeElement: null,
  getElementById: get,
  querySelectorAll(selector) { return selector === '.settings-tab' ? tabs : []; },
  addEventListener() {},
};
const context = { window: {}, document, setTimeout, clearTimeout };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '../ui/settings-controller.js'), 'utf8');
vm.runInContext(source, context, { filename: 'settings-controller.js' });

const accounts = [
  { id: 'A', type: 'whatsapp', name: 'WA A', fontSize: 16, fontColor: '#18A058', openProxy: true, protocal: 'socks5', host: '127.0.0.1', port: '1080', huser: '', hpwd: '' },
  { id: 'B', type: 'telegram-z', name: 'TG B', fontSize: 16, fontColor: '#18A058', openProxy: false, protocal: 'http', host: '', port: '', huser: '', hpwd: '' },
];
const updates = [];
const configWrites = [];
const controller = context.window.GeekSettingsController.create({
  getConfig: async () => ({ theme: 'dark', accent: 'green', openProxy: false }),
  setConfig: async patch => { configWrites.push({ ...patch }); },
  getAccounts: async () => ({ activeAccountId: 'B', accounts: accounts.map(item => ({ ...item })) }),
  updateAccount: async (accountId, patch) => { updates.push({ accountId, patch: { ...patch } }); },
  applyTheme() {},
  getActiveId: () => 'B',
  familyLabel: type => type.startsWith('telegram') ? 'Telegram' : 'WhatsApp',
});

(async () => {
  // Open the instance editor for A while B is the active account.
  assert.equal(await controller.openAccount('A', { focus: 'proxy' }), true);
  assert.equal(get('acc-select').value, 'A');

  // Simulate a stale/hostile UI mutation after the menu opened. The immutable target must remain A.
  get('acc-select').value = 'B';
  get('acc-name').value = 'WA A renamed';
  get('acc-fontSize').value = '17';
  get('acc-fontColor').value = '#123456';
  get('acc-openProxy').checked = true;
  get('acc-protocal').value = 'http';
  get('acc-host').value = '10.0.0.8';
  get('acc-port').value = '8080';
  get('acc-huser').value = 'proxy-user';
  get('acc-hpwd').value = 'proxy-pass';

  assert.equal(await controller.save(), true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].accountId, 'A', '实例保存必须仍然作用被右击的 A');
  assert.equal(updates[0].patch.protocal, 'http', 'HTTP 必须进入 canonical account patch');
  assert.equal(configWrites.length, 0, '实例保存不得写全局配置');

  // Ordinary settings resets the lock and must only write global config, even if instance fields are invalid.
  await controller.open();
  get('acc-name').value = '';
  get('cfg-theme').value = 'light';
  get('cfg-accent').value = 'blue';
  get('cfg-openProxy').checked = false;
  assert.equal(await controller.save(), true);
  assert.equal(updates.length, 1, '普通设置不得再写任何实例');
  assert.equal(configWrites.length, 1, '普通设置必须继续写全局配置');
  assert.equal(configWrites[0].theme, 'light');

  console.log('ACCOUNT_CONTEXT_TARGET_RUNTIME_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
