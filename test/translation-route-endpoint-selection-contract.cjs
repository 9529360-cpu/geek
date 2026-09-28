'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGatewayPool, DEFAULT_RECOVERY_PROBE_MS } = require('../src/gateway-failover.cjs');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

const PRIMARY = 'https://primary.example.test';
const BACKUP = 'https://backup.example.test';
const BACKUP_2 = 'https://backup-2.example.test';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
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
      if (url.endsWith('/health')) return response(200, { ok: true });
      return response(200, { text: `translated:${body.text}`, source: body.source, target: body.target });
    },
    randomUUID: (() => { let n = 0; return () => `route-request-${++n}`; })(),
  });
  runtime.install();
  const rawTranslate = handlers.get('translation:translate');
  const rawHealth = handlers.get('translation:health');
  const event = mainFrameIpcEvent({ id: 1 });
  return {
    runtime,
    calls,
    translate: payload => rawTranslate(event, payload).then(unwrapTranslationIpcResponse),
    health: () => rawHealth(event),
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

  // Runtime must send explicit backup traffic to the backup endpoint, while also
  // preserving the stable user-selected operation route for replay identity.
  {
    const h = createRuntimeHarness();
    const result = await h.translate({
      accountId: 'account-a', text: 'backup please', source: 'auto', target: 'it',
      route: 'backup', refresh: true, skipQuota: true,
    });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, `${BACKUP}/v1/translate`);
    assert.equal(h.calls[0].body.route, 'backup');
    assert.equal(h.calls[0].body.operationRoute, 'backup');
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
    assert.equal(h.calls[0].body.operationRoute, 'primary');
    h.runtime.dispose();
  }

  // Automatic route keeps the mature health-failover behavior. Both physical
  // endpoint attempts must carry the same logical operation route and request ID
  // contract, even though the selected transport route changes primary -> backup.
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
    assert.equal(h.calls[0].body.route, 'primary');
    assert.equal(h.calls[1].body.route, 'backup', 'Worker must see the route actually used after failover');
    assert.deepEqual(
      h.calls.map(call => call.body.operationRoute),
      ['default', 'default'],
      'physical failover must not change the semantic route bound to the idempotency key'
    );
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

  // Public runtime health may expose route class and latency, but it must never
  // leak configured endpoint URLs to the renderer.
  {
    const h = createRuntimeHarness({
      endpoints: [PRIMARY, BACKUP, BACKUP_2],
      fetchImpl: async (url, _options, body) => {
        if (url.endsWith('/health')) {
          if (url.startsWith(PRIMARY)) return response(200, { ok: true });
          if (url.startsWith(BACKUP)) return response(503, { ok: false });
          return response(200, { ok: true });
        }
        return response(200, { text: `translated:${body.text}`, source: body.source, target: body.target });
      },
    });
    const health = await h.health();
    assert.equal(health.ok, true);
    assert.equal(health.models, 2);
    assert.equal(health.endpointCount, 3);
    assert.equal(health.routes.primary.configured, true);
    assert.equal(health.routes.primary.healthy, true);
    assert.ok(Number.isFinite(health.routes.primary.latencyMs) && health.routes.primary.latencyMs >= 0);
    assert.equal(health.routes.backup.configured, true);
    assert.equal(health.routes.backup.healthy, true);
    assert.equal(health.routes.backup.healthyCount, 1);
    assert.equal(health.routes.backup.endpointCount, 2);
    assert.ok(Number.isFinite(health.routes.backup.latencyMs) && health.routes.backup.latencyMs >= 0);
    assert.equal(health.recommendedRoute, 'primary');
    const serialized = JSON.stringify(health);
    assert.ok(!serialized.includes(PRIMARY) && !serialized.includes(BACKUP) && !serialized.includes(BACKUP_2), 'health projection must not expose configured endpoint URLs');
    h.runtime.dispose();
  }

  // Settings UX must keep route configuration, gateway health and current-user
  // translation readiness as three distinct facts. Gateway /health alone must
  // never be presented as end-to-end translation readiness.
  {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'translation-settings.js'), 'utf8');
    assert.doesNotMatch(source, /服务正常|翻译服务正常/, 'gateway-only health must not claim end-to-end translation readiness');
    const primaryOption = { disabled: false, textContent: '主线路' };
    const backupOption = { disabled: false, textContent: '备用线路' };
    const routeSelect = {
      value: 'backup',
      dataset: {},
      querySelector(selector) {
        if (selector === 'option[value="primary"]') return primaryOption;
        if (selector === 'option[value="backup"]') return backupOption;
        return null;
      },
    };
    const elements = {
      'translation-service-state': { textContent: '', dataset: {} },
      'translation-gateway-status': { textContent: '', dataset: {} },
      'translation-global-status': { textContent: '', dataset: {} },
      'translation-server': routeSelect,
    };
    let healthResult = {
      ok: true,
      models: 1,
      endpointCount: 1,
      recommendedRoute: 'primary',
      routes: {
        primary: { configured: true, healthy: true, latencyMs: 23 },
        backup: { configured: false, healthy: false, healthyCount: 0, endpointCount: 0, latencyMs: null },
      },
    };
    let readinessResult = { ready: true, reason: 'ready', retryable: false, quota: 'positive', remaining_chars: 345 };
    let readinessCalls = 0;
    const context = {
      window: {},
      document: { getElementById: id => elements[id] || null },
      setTimeout,
      clearTimeout,
      Promise,
      Number,
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
      readiness: async () => { readinessCalls += 1; return readinessResult; },
    });

    await controller.checkHealth(true);
    assert.equal(primaryOption.textContent, '主线路 · 23 ms');
    assert.equal(backupOption.disabled, true);
    assert.equal(backupOption.textContent, '备用线路（未配置）');
    assert.equal(routeSelect.dataset.backupConfigured, '0');
    assert.equal(routeSelect.dataset.recommendedRoute, 'primary');
    assert.match(elements['translation-global-status'].textContent, /未配置备用线路/);
    assert.equal(elements['translation-service-state'].textContent, '基础检查通过');
    assert.match(elements['translation-gateway-status'].textContent, /账号：授权可用/);
    assert.match(elements['translation-gateway-status'].textContent, /本地余额 345 字符/);
    assert.match(elements['translation-gateway-status'].textContent, /网关：可达 · 主线路 23 ms/);
    assert.match(elements['translation-gateway-status'].textContent, /不代表上游翻译供应商实时可用/);
    assert.equal(readinessCalls, 1);

    readinessResult = { ready: false, reason: 'quota-exhausted', retryable: false, quota: 'exhausted', remaining_chars: 0 };
    healthResult = {
      ok: true,
      models: 2,
      endpointCount: 2,
      recommendedRoute: 'primary',
      routes: {
        primary: { configured: true, healthy: true, latencyMs: 31 },
        backup: { configured: true, healthy: true, healthyCount: 1, endpointCount: 1, latencyMs: 55 },
      },
    };
    routeSelect.value = 'default';
    await controller.checkHealth(true);
    assert.equal(primaryOption.textContent, '主线路 · 31 ms');
    assert.equal(backupOption.disabled, false);
    assert.equal(backupOption.textContent, '备用线路 · 55 ms');
    assert.equal(routeSelect.dataset.backupConfigured, '1');
    assert.equal(routeSelect.dataset.recommendedRoute, 'primary');
    assert.equal(elements['translation-service-state'].textContent, '额度不足');
    assert.match(elements['translation-gateway-status'].textContent, /翻译额度已用完/);
    assert.match(elements['translation-gateway-status'].textContent, /网关：可达 · 主线路 31 ms · 备用线路 · 55 ms/);

    readinessResult = { ready: false, reason: 'login-required', retryable: false, quota: 'unknown' };
    healthResult = {
      ok: false,
      models: 0,
      endpointCount: 2,
      recommendedRoute: null,
      routes: {
        primary: { configured: true, healthy: false, latencyMs: null },
        backup: { configured: true, healthy: false, healthyCount: 0, endpointCount: 1, latencyMs: null },
      },
    };
    await controller.checkHealth(true);
    assert.equal(primaryOption.textContent, '主线路 · 异常');
    assert.equal(backupOption.textContent, '备用线路 · 异常');
    assert.equal(elements['translation-service-state'].textContent, '需登录', 'account action must outrank generic gateway failure in the header');
    assert.match(elements['translation-gateway-status'].textContent, /未登录.*个人中心登录/);
    assert.match(elements['translation-gateway-status'].textContent, /网关：暂不可用/);
    assert.match(elements['translation-gateway-status'].textContent, /主线路异常/);
    assert.match(elements['translation-gateway-status'].textContent, /备用线路异常/);

    // Healthy-but-unmeasured routes must say reachable, never invent a 0 ms RTT.
    readinessResult = { ready: true, reason: 'ready', retryable: false, quota: 'unknown' };
    healthResult = {
      ok: true,
      models: 1,
      endpointCount: 1,
      recommendedRoute: 'primary',
      routes: {
        primary: { configured: true, healthy: true, latencyMs: null },
        backup: { configured: false, healthy: false, healthyCount: 0, endpointCount: 0, latencyMs: null },
      },
    };
    await controller.checkHealth(true);
    assert.equal(primaryOption.textContent, '主线路 · 可达');
    assert.match(elements['translation-gateway-status'].textContent, /网关：可达 · 主线路 可达/);
    assert.doesNotMatch(elements['translation-gateway-status'].textContent, /0 ms/);

    // Older runtime payloads without route details must remain display-compatible.
    healthResult = { ok: true, models: 2, endpointCount: 2 };
    await controller.checkHealth(true);
    assert.match(elements['translation-gateway-status'].textContent, /网关：可达 · 2\/2 条网关健康/);
  }

  console.log('TRANSLATION_ROUTE_ENDPOINT_SELECTION_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
