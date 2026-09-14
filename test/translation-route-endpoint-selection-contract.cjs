'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGatewayPool, DEFAULT_RECOVERY_PROBE_MS } = require('../src/gateway-failover.cjs');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');

const PRIMARY = 'https://primary.example.test';
const BACKUP = 'https://backup.example.test';
const BACKUP_2 = 'https://backup-2.example.test';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function createRuntimeHarness({ endpoints = [PRIMARY, BACKUP], fetchImpl } = {}) {
  const handlers = new Map();
  const calls = [];
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: { readFile: async () => '', appendFile: async () => {} },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-route-selection',
    accountState: { findById: () => ({ partition: 'persist:route-selection' }) },
    createGatewayPool,
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      getQuota: async () => ({ remaining_chars: null }),
      getTranslationToken: async () => 'translation-token',
    }),
    env: { GEEK_TRANSLATION_GATEWAY_URL: endpoints.join(',') },
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (body) calls.push({ url, body });
      if (fetchImpl) return fetchImpl(url, options, body, calls.length - 1);
      return response(200, { text: `translated:${body.text}`, source: body.source, target: body.target });
    },
    randomUUID: (() => { let n = 0; return () => `route-request-${++n}`; })(),
  });
  runtime.install();
  const rawTranslate = handlers.get('translation:translate');
  return {
    runtime,
    calls,
    translate: payload => rawTranslate({ sender: { id: 1 } }, payload).then(unwrapTranslationIpcResponse),
  };
}

(async () => {
  // Gateway-pool authority: explicit routes stay inside their endpoint class.
  {
    let clock = 1;
    const pool = createGatewayPool({ endpoints: [PRIMARY, BACKUP, BACKUP_2], now: () => clock });
    assert.equal(pool.pick('default').endpoint, PRIMARY);
    assert.equal(pool.pick('primary').endpoint, PRIMARY);
    assert.equal(pool.pick('backup').endpoint, BACKUP);
    assert.deepEqual(pool.routeAvailability(), { primary: true, backup: true });

    pool.reportFailure(BACKUP);
    assert.equal(pool.pick('backup').endpoint, BACKUP_2, 'backup selection may fail over only within the backup class');
    pool.reportFailure(BACKUP_2);
    assert.throws(
      () => pool.pick('backup'),
      error => error?.code === 'TRANSLATION_ROUTE_UNAVAILABLE' && error?.route === 'backup' && error?.retryable === true,
      'explicit backup must fail clearly instead of crossing back to primary while backups cool down',
    );

    clock += DEFAULT_RECOVERY_PROBE_MS;
    assert.equal(pool.pick('backup').endpoint, BACKUP, 'explicit backup may half-open a backup after its cooldown');

    const primaryLocked = createGatewayPool({ endpoints: [PRIMARY, BACKUP], now: () => 1 });
    primaryLocked.reportFailure(PRIMARY);
    assert.throws(
      () => primaryLocked.pick('primary'),
      error => error?.code === 'TRANSLATION_ROUTE_UNAVAILABLE' && error?.route === 'primary',
      'explicit primary must not silently fail over to backup',
    );
    assert.equal(primaryLocked.pick('default').endpoint, BACKUP, 'automatic route must retain normal failover');

    const single = createGatewayPool({ endpoints: [PRIMARY] });
    assert.deepEqual(single.routeAvailability(), { primary: true, backup: false });
    assert.throws(
      () => single.pick('backup'),
      error => error?.code === 'TRANSLATION_ROUTE_NOT_CONFIGURED' && error?.retryable === false,
      'single-endpoint deployment must report that backup is not configured',
    );
  }

  // Runtime must send explicit backup traffic to the backup endpoint and pass the
  // actual selected route to the Worker rather than only echoing the UI label.
  {
    const h = createRuntimeHarness();
    const result = await h.translate({
      accountId: 'account-a', text: 'backup please', source: 'auto', target: 'it',
      route: 'backup', refresh: true, skipQuota: true,
    });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, `${BACKUP}/v1/translate`);
    assert.equal(h.calls[0].body.route, 'backup');
    assert.equal(result.route, 'backup');
    h.runtime.dispose();
  }

  // Explicit primary is a policy lock: a retryable primary failure must surface
  // and must never spend a second attempt on backup.
  {
    const h = createRuntimeHarness({
      fetchImpl: async (url, _options, body) => url.startsWith(PRIMARY)
        ? response(503, { error: 'upstream_unavailable' })
        : response(200, { text: `backup:${body.text}`, target: body.target }),
    });
    await assert.rejects(
      h.translate({ accountId: 'account-a', text: 'primary locked', target: 'it', route: 'primary', refresh: true, skipQuota: true }),
      error => error?.status === 503 && error?.category === 'gateway',
    );
    assert.deepEqual(h.calls.map(call => call.url), [`${PRIMARY}/v1/translate`]);
    h.runtime.dispose();
  }

  // Automatic route keeps the mature health-failover behavior.
  {
    const h = createRuntimeHarness({
      fetchImpl: async (url, _options, body) => url.startsWith(PRIMARY)
        ? response(503, { error: 'upstream_unavailable' })
        : response(200, { text: `backup:${body.text}`, target: body.target }),
    });
    const result = await h.translate({
      accountId: 'account-a', text: 'automatic failover', target: 'it', route: 'default', refresh: true, skipQuota: true,
    });
    assert.deepEqual(h.calls.map(call => call.url), [`${PRIMARY}/v1/translate`, `${BACKUP}/v1/translate`]);
    assert.equal(h.calls[1].body.route, 'backup', 'Worker must see the route actually used after failover');
    assert.equal(result.route, 'backup');
    h.runtime.dispose();
  }

  // A single-endpoint production configuration must fail before network I/O when
  // a stale profile still asks for backup.
  {
    const h = createRuntimeHarness({ endpoints: [PRIMARY] });
    await assert.rejects(
      h.translate({ accountId: 'account-a', text: 'stale backup', target: 'it', route: 'backup', refresh: true, skipQuota: true }),
      error => error?.code === 'TRANSLATION_ROUTE_NOT_CONFIGURED' && error?.category === 'gateway' && error?.retryable === false,
    );
    assert.equal(h.calls.length, 0, 'unconfigured backup must not accidentally call primary');
    h.runtime.dispose();
  }

  // Settings UX must not present backup as usable until health confirms a second
  // configured endpoint. This is a dynamic controller test, not a source regex.
  {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'translation-settings.js'), 'utf8');
    const backupOption = { disabled: false, textContent: '备用线路' };
    const routeSelect = {
      value: 'backup',
      dataset: {},
      querySelector(selector) { return selector === 'option[value="backup"]' ? backupOption : null; },
    };
    const elements = {
      'translation-service-state': { textContent: '', dataset: {} },
      'translation-gateway-status': { textContent: '', dataset: {} },
      'translation-global-status': { textContent: '', dataset: {} },
      'translation-server': routeSelect,
    };
    let healthResult = { ok: true, models: 1, endpointCount: 1 };
    const context = {
      window: {},
      document: { getElementById: id => elements[id] || null },
      setTimeout,
      clearTimeout,
      Promise,
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'translation-settings.js' });
    const controller = context.window.GeekTranslationSettings.create({
      core: { normalizeConfig: () => ({}) },
      getActiveId: () => 'account-a',
      getStorage: () => '{}',
      setStorage: async () => true,
      getCurrentChat: async () => '',
      sync() {},
      health: async () => healthResult,
    });

    await controller.checkHealth(true);
    assert.equal(backupOption.disabled, true);
    assert.equal(backupOption.textContent, '备用线路（未配置）');
    assert.equal(routeSelect.dataset.backupConfigured, '0');
    assert.match(elements['translation-global-status'].textContent, /未配置备用线路/);
    assert.match(elements['translation-gateway-status'].textContent, /1\/1 条线路可用/);

    healthResult = { ok: true, models: 2, endpointCount: 2 };
    routeSelect.value = 'default';
    await controller.checkHealth(true);
    assert.equal(backupOption.disabled, false);
    assert.equal(backupOption.textContent, '备用线路');
    assert.equal(routeSelect.dataset.backupConfigured, '1');
    assert.match(elements['translation-gateway-status'].textContent, /2\/2 条线路可用/);
  }

  console.log('TRANSLATION_ROUTE_ENDPOINT_SELECTION_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
