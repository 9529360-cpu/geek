'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'subscription.html'), 'utf8');
const scriptMatch = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'subscription renderer must keep one executable inline script');
assert.match(html, /id="home-logout-err"/, 'home view must expose a visible logout failure target');

const FAILURE_MESSAGE = '退出未完成，本机登录状态仍然保留，请重试。';

function element(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    onclick: null,
    classList: {
      add() {},
      remove() {},
    },
    addEventListener() {},
  };
}

function createHarness() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const views = ['view-login', 'view-register', 'view-plans', 'view-order', 'view-home'].map(get);
  let logoutCalls = 0;
  let reloadCalls = 0;
  let logoutImpl = async () => ({ ok: true });

  const document = {
    querySelector(selector) {
      assert.match(selector, /^#[A-Za-z0-9_-]+$/, `unexpected selector in subscription contract: ${selector}`);
      return get(selector.slice(1));
    },
    querySelectorAll(selector) {
      if (selector === '.view') return views;
      if (selector === '.plan') return [];
      return [];
    },
    getElementById(id) {
      return get(id);
    },
  };

  const subscription = {
    logout() {
      logoutCalls += 1;
      return logoutImpl();
    },
    getState: async () => ({ loggedIn: false }),
    refresh: async () => ({ loggedIn: false }),
    login: async () => ({ ok: true }),
    register: async () => ({ ok: true }),
    createOrder: async () => ({ order: { plan: 'basic', amount: 25, id: 1 } }),
    enterApp() {},
    closeWindow() {},
  };

  const context = {
    document,
    window: { api: { subscription } },
    location: { reload() { reloadCalls += 1; } },
    console,
    Number,
    setTimeout() {},
  };

  vm.runInNewContext(scriptMatch[1], context, { filename: 'ui/subscription.html' });

  return {
    get,
    setLogoutImpl(fn) { logoutImpl = fn; },
    logoutCalls: () => logoutCalls,
    reloadCalls: () => reloadCalls,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  const harness = createHarness();
  await settle();

  harness.setLogoutImpl(async () => {
    throw new Error('EPERM C:\\Users\\private\\subscription.json');
  });
  await harness.get('home-logout').onclick();
  assert.equal(harness.reloadCalls(), 0, 'failed durable logout must not reload into a false logged-out projection');
  assert.equal(harness.get('home-logout-err').textContent, FAILURE_MESSAGE, 'home logout failure must be explicit and actionable');
  assert.doesNotMatch(harness.get('home-logout-err').textContent, /EPERM|Users|subscription\.json/i, 'raw filesystem details must not leak into the renderer');

  harness.setLogoutImpl(async () => ({ ok: true }));
  await harness.get('home-logout').onclick();
  assert.equal(harness.reloadCalls(), 1, 'successful durable logout must retain the existing reload completion');
  assert.equal(harness.get('home-logout-err').textContent, '', 'retry must clear the previous logout failure before succeeding');

  const plansHarness = createHarness();
  await settle();
  plansHarness.setLogoutImpl(async () => {
    throw new Error('simulated durable clear failure');
  });
  await plansHarness.get('back-login').onclick();
  assert.equal(plansHarness.get('plans-err').textContent, FAILURE_MESSAGE, 'plans logout entry must use the same visible recovery contract');
  assert.equal(plansHarness.reloadCalls(), 0);

  const concurrent = createHarness();
  await settle();
  let resolveLogout;
  concurrent.setLogoutImpl(() => new Promise((resolve) => { resolveLogout = resolve; }));
  const first = concurrent.get('home-logout').onclick();
  const second = concurrent.get('back-login').onclick();
  assert.equal(concurrent.logoutCalls(), 1, 'concurrent logout clicks must coalesce to one durable clear');
  resolveLogout({ ok: true });
  await Promise.all([first, second]);
  assert.equal(concurrent.reloadCalls(), 1, 'coalesced successful logout must reload exactly once');

  console.log('SUBSCRIPTION_LOGOUT_FEEDBACK_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
