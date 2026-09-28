'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'subscription.html'), 'utf8');
const scriptMatch = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'subscription renderer must keep one executable inline script');
assert.match(html, /id="service-health"[^>]*role="status"[^>]*aria-live="polite"/, 'subscription window must expose an accessible service-health status');
assert.match(html, /翻译线路 · 检测中…/, 'service health must start in an explicit checking state');
for (const platform of ['WhatsApp', 'Telegram', 'LINE', 'Messenger', 'Instagram']) assert.ok(html.includes(platform), `subscription brand surface must name ${platform}`);
assert.doesNotMatch(scriptMatch[1], /setInterval\s*\(/, 'subscription health visibility must not add a background polling loop');

function element(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    onclick: null,
    classList: { add() {}, remove() {} },
    addEventListener() {},
  };
}

function createHarness({ health = null } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const views = ['view-login', 'view-register', 'view-plans', 'view-order', 'view-home'].map(get);
  let healthCalls = 0;

  const document = {
    querySelector(selector) {
      assert.match(selector, /^#[A-Za-z0-9_-]+$/, 'subscription health contract only expects id selectors');
      return get(selector.slice(1));
    },
    querySelectorAll(selector) {
      if (selector === '.view') return views;
      if (selector === '.plan') return [];
      return [];
    },
    getElementById(id) { return get(id); },
  };

  const subscription = {
    logout: async () => ({ ok: true }),
    getState: async () => ({ loggedIn: false }),
    refresh: async () => ({ loggedIn: false }),
    login: async () => ({ ok: true }),
    register: async () => ({ ok: true }),
    createOrder: async () => ({ order: { plan: 'basic', amount: 25, id: 1 } }),
    enterApp() {},
    closeWindow() {},
  };
  const translation = health === null
    ? undefined
    : { health: async () => { healthCalls += 1; return health(); } };

  const context = {
    document,
    window: { api: { subscription, ...(translation ? { translation } : {}) } },
    location: { reload() {} },
    console,
    Number,
    setTimeout() {},
  };

  vm.runInNewContext(scriptMatch[1], context, { filename: 'ui/subscription.html' });
  return { get, healthCalls: () => healthCalls };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

(async () => {
  {
    const h = createHarness({
      health: async () => ({
        ok: true,
        recommendedRoute: 'primary',
        routes: {
          primary: { configured: true, healthy: true, latencyMs: 42 },
          backup: { configured: true, healthy: true, latencyMs: 71 },
        },
      }),
    });
    await settle();
    assert.equal(h.healthCalls(), 1, 'subscription health probe runs once at startup');
    assert.equal(h.get('service-health').textContent, '翻译线路 · 主线路 42 ms');
    assert.equal(h.get('service-health').dataset.state, 'ok');
  }

  {
    const h = createHarness({
      health: async () => ({
        ok: true,
        recommendedRoute: 'backup',
        routes: {
          primary: { configured: true, healthy: false, latencyMs: null },
          backup: { configured: true, healthy: true, latencyMs: 67 },
        },
      }),
    });
    await settle();
    assert.equal(h.get('service-health').textContent, '翻译线路 · 备用线路 67 ms');
    assert.equal(h.get('service-health').dataset.state, 'ok');
  }

  {
    const h = createHarness({
      health: async () => ({
        ok: true,
        recommendedRoute: 'primary',
        routes: {
          primary: { configured: true, healthy: true, latencyMs: null },
          backup: { configured: false, healthy: false, latencyMs: null },
        },
      }),
    });
    await settle();
    assert.equal(h.get('service-health').textContent, '翻译线路 · 主线路 可达', 'unknown RTT must never be invented as 0 ms');
  }

  {
    const h = createHarness({ health: async () => ({ ok: false, routes: {} }) });
    await settle();
    assert.equal(h.get('service-health').textContent, '翻译线路 · 暂不可用');
    assert.equal(h.get('service-health').dataset.state, 'error');
  }

  {
    const h = createHarness({ health: async () => { throw new Error('offline'); } });
    await settle();
    assert.equal(h.get('service-health').textContent, '翻译线路 · 检测失败');
    assert.equal(h.get('service-health').dataset.state, 'error');
  }

  {
    const h = createHarness();
    await settle();
    assert.equal(h.healthCalls(), 0);
    assert.equal(h.get('service-health').textContent, '翻译线路 · 待检测');
    assert.equal(h.get('service-health').dataset.state, 'idle');
  }

  console.log('SUBSCRIPTION_SERVICE_HEALTH_CONTRACT_OK');
})().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
