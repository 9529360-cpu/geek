'use strict';

const assert = require('node:assert/strict');
const { compileProxyConfig, createProxyRuntime, effectiveProxyConfig } = require('../src/proxy-runtime.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 8) {
  for (let index = 0; index < turns; index++) await Promise.resolve();
}

function makeProxyConfig(host, port = '8080') {
  return { openProxy: true, protocal: 'http', host, port, login: 'user', password: 'secret' };
}

function createControlledRuntime() {
  const started = [];
  const currentRoute = new Map();
  const closeCalls = new Map();

  function sessionFor(partition) {
    return {
      partition,
      async setProxy(value) {
        const gate = deferred();
        started.push({ partition, value, gate });
        await gate.promise;
        currentRoute.set(partition, value);
      },
      async clearAuthCache() {},
      async closeAllConnections() {
        closeCalls.set(partition, (closeCalls.get(partition) || 0) + 1);
      },
    };
  }

  const runtime = createProxyRuntime({
    app: { on() {} },
    sessionModule: { fromPartition: sessionFor },
    accountState: { findByPartition() { return null; } },
    getGlobalConfig: () => ({ openProxy: false }),
  });

  return { runtime, started, currentRoute, closeCalls };
}

const secret = 'p@ss:word';
for (const [protocal, expected] of [
  ['http', 'http://proxy.example:8080'],
  ['https', 'https://proxy.example:8080'],
  ['socks4', 'socks4://proxy.example:8080'],
  ['socks5', 'socks5://proxy.example:8080'],
]) {
  const compiled = compileProxyConfig({ openProxy: true, protocal, host: 'proxy.example', port: '8080', huser: 'alice', hpwd: secret });
  assert.equal(compiled.proxyRules, expected);
  assert.equal(compiled.proxyRules.includes('alice'), false);
  assert.equal(compiled.proxyRules.includes(secret), false);
  assert.equal(compiled.proxyRules.includes('@'), false);
}
assert.equal(compileProxyConfig(null).mode, 'direct');
assert.throws(() => compileProxyConfig({ openProxy: true, host: 'proxy.example:8080', port: '8080' }), /must not include a port/);
assert.throws(() => compileProxyConfig({ openProxy: true, host: 'proxy.example', port: '0' }), /port is invalid/);

const accountA = { id: 'A', partition: 'persist:webview-page-A', openProxy: true, protocal: 'http', host: 'a.proxy', port: '9001', huser: 'alice', hpwd: 'a-secret' };
const accountB = { id: 'B', partition: 'persist:webview-page-B', openProxy: false };
const accountC = { id: 'C', partition: 'persist:webview-page-C', openProxy: true, protocal: 'socks5', host: 'bad proxy', port: '1080', huser: 'charlie', hpwd: 'c-secret' };
let globalConfig = { openProxy: true, protocal: 'https', host: 'global.proxy', port: '9443', login: 'global-user', password: 'global-secret' };
const accounts = new Map([[accountA.partition, accountA], [accountB.partition, accountB], [accountC.partition, accountC]]);
const loginHandlers = [];
const calls = new Map();

function sessionFor(partition) {
  if (!calls.has(partition)) calls.set(partition, { setProxy: [], close: 0, clearAuth: 0, events: [] });
  const record = calls.get(partition);
  return {
    partition,
    async setProxy(value) {
      record.events.push(`set:${value.mode}`);
      record.setProxy.push(value);
      if (record.failSetProxy) throw new Error('simulated setProxy failure');
    },
    async clearAuthCache() {
      record.events.push('clear-auth');
      record.clearAuth++;
      if (record.failClearAuth) throw new Error('simulated clearAuthCache failure');
    },
    async closeAllConnections() {
      record.events.push('close');
      record.close++;
      if (record.failClose) throw new Error('simulated close failure');
    },
  };
}

const runtime = createProxyRuntime({
  app: { on(name, handler) { if (name === 'login') loginHandlers.push(handler); } },
  sessionModule: { fromPartition: sessionFor },
  accountState: { findByPartition(partition) { return accounts.get(partition) || null; } },
  getGlobalConfig: () => globalConfig,
});

assert.equal(effectiveProxyConfig(accountA, globalConfig), accountA);
assert.equal(effectiveProxyConfig(accountB, globalConfig), globalConfig);

(async () => {
  runtime.installAuthenticationHandler();
  runtime.installAuthenticationHandler();
  assert.equal(loginHandlers.length, 1);

  let result = await runtime.applyAccount(accountA, globalConfig);
  assert.equal(result.ok, true);
  assert.equal(runtime.isReadyForAccount(accountA, globalConfig), true);
  assert.deepEqual(calls.get(accountA.partition).setProxy[0], {
    mode: 'fixed_servers',
    proxyRules: 'http://a.proxy:9001',
    proxyBypassRules: '<local>',
  });

  result = await runtime.applyAccount(accountA, globalConfig);
  assert.equal(result.deduped, true);
  assert.equal(calls.get(accountA.partition).setProxy.length, 1);
  assert.equal(calls.get(accountA.partition).close, 0);
  assert.equal(calls.get(accountA.partition).clearAuth, 0);

  result = await runtime.applyAccount(accountB, globalConfig);
  assert.equal(result.ok, true);
  assert.equal(runtime.isReadyForAccount(accountB, globalConfig), true);
  assert.equal(calls.get(accountB.partition).setProxy[0].proxyRules, 'https://global.proxy:9443');

  function authAttempt({ account, host, port, isProxy = true, firstAuthAttempt = true }) {
    let prevented = false;
    let credentials = null;
    loginHandlers[0](
      { preventDefault() { prevented = true; } },
      account ? { session: { partition: account.partition } } : { session: { partition: '' } },
      { firstAuthAttempt },
      { isProxy, host, port },
      (username, password) => { credentials = [username, password]; },
    );
    return { prevented, credentials };
  }

  assert.deepEqual(authAttempt({ account: accountA, host: 'A.PROXY', port: 9001 }), { prevented: true, credentials: ['alice', 'a-secret'] });
  assert.deepEqual(authAttempt({ account: accountB, host: 'global.proxy', port: 9443 }), { prevented: true, credentials: ['global-user', 'global-secret'] });
  assert.deepEqual(authAttempt({ account: accountA, host: 'other.proxy', port: 9001 }), { prevented: false, credentials: null });
  assert.deepEqual(authAttempt({ account: accountA, host: 'a.proxy', port: 9002 }), { prevented: false, credentials: null });
  assert.deepEqual(authAttempt({ account: accountA, host: 'a.proxy', port: 9001, isProxy: false }), { prevented: false, credentials: null });
  assert.deepEqual(authAttempt({ account: accountA, host: 'a.proxy', port: 9001, firstAuthAttempt: false }), { prevented: false, credentials: null });
  assert.deepEqual(authAttempt({ account: null, host: 'a.proxy', port: 9001 }), { prevented: false, credentials: null });

  accountA.hpwd = 'rotated';
  assert.equal(runtime.isReadyForAccount(accountA, globalConfig), false, 'credential changes must invalidate readiness before apply');
  result = await runtime.applyAccount(accountA, globalConfig);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.get(accountA.partition).events.slice(-3), ['set:fixed_servers', 'clear-auth', 'close']);
  assert.equal(calls.get(accountA.partition).clearAuth, 1, 'same-endpoint credential rotation must clear cached HTTP auth');
  assert.deepEqual(authAttempt({ account: accountA, host: 'a.proxy', port: 9001 }), { prevented: true, credentials: ['alice', 'rotated'] });

  accountA.host = 'next.proxy';
  result = await runtime.applyAccount(accountA, globalConfig);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.get(accountA.partition).events.slice(-2), ['set:fixed_servers', 'close']);
  assert.equal(calls.get(accountA.partition).clearAuth, 1, 'moving to a different proxy endpoint must not clear unrelated HTTP auth cache');
  assert.deepEqual(authAttempt({ account: accountA, host: 'a.proxy', port: 9001 }), { prevented: false, credentials: null });
  assert.deepEqual(authAttempt({ account: accountA, host: 'next.proxy', port: 9001 }), { prevented: true, credentials: ['alice', 'rotated'] });

  result = await runtime.applyAccount(accountC, globalConfig);
  assert.equal(result.ok, false);
  assert.equal(runtime.isReadyForAccount(accountC, globalConfig), false);
  assert.equal(runtime.isReadyForAccount(accountA, globalConfig), true, 'one partition failure must not poison another');

  const failing = { id: 'D', partition: 'persist:webview-page-D', openProxy: true, protocal: 'http', host: 'd.proxy', port: '8080', huser: 'd', hpwd: 'd' };
  accounts.set(failing.partition, failing);
  sessionFor(failing.partition);
  calls.get(failing.partition).failSetProxy = true;
  result = await runtime.applyAccount(failing, globalConfig);
  assert.equal(result.ok, false);
  assert.equal(runtime.isReadyForAccount(failing, globalConfig), false);

  globalConfig = { openProxy: false };
  result = await runtime.applyAccount(accountB, globalConfig);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.get(accountB.partition).events.slice(-2), ['set:direct', 'close']);
  assert.equal(runtime.isReadyForAccount(accountB, globalConfig), true);

  const direct = { id: 'E', partition: 'persist:webview-page-E', openProxy: false };
  accounts.set(direct.partition, direct);
  result = await runtime.applyAccount(direct, globalConfig);
  assert.equal(result.ok, true);
  assert.equal(calls.has(direct.partition), false, 'fresh direct sessions must not require asynchronous setProxy');
  assert.equal(runtime.isReadyForAccount(direct, globalConfig), true);

  runtime.forgetPartition(accountA.partition);
  assert.equal(runtime.isReadyForAccount(accountA, globalConfig), false);

  {
    const controlled = createControlledRuntime();
    const partition = 'persist:webview-page-race';
    const oldConfig = makeProxyConfig('old.proxy');
    const newConfig = makeProxyConfig('new.proxy');

    const oldApply = controlled.runtime.applyPartition(partition, oldConfig);
    await flushMicrotasks();
    assert.equal(controlled.started.length, 1, 'the first same-partition proxy mutation should enter setProxy');

    const newApply = controlled.runtime.applyPartition(partition, newConfig);
    await flushMicrotasks();
    assert.equal(controlled.started.length, 1, 'a later same-partition proxy mutation must wait for the earlier full transition');

    controlled.started[0].gate.resolve();
    assert.equal((await oldApply).ok, true);
    await flushMicrotasks();
    assert.equal(controlled.started.length, 2, 'the queued same-partition mutation must start after the earlier apply completes');
    assert.equal(controlled.started[1].value.proxyRules, 'http://new.proxy:8080');
    controlled.started[1].gate.resolve();
    assert.equal((await newApply).ok, true);
    assert.equal(controlled.currentRoute.get(partition).proxyRules, 'http://new.proxy:8080', 'the latest queued proxy must own the final Electron Session route');
    assert.equal(controlled.runtime.stateFor(partition).host, 'new.proxy', 'the latest queued proxy must own readiness');
  }

  {
    const controlled = createControlledRuntime();
    const applyA = controlled.runtime.applyPartition('persist:webview-page-concurrent-A', makeProxyConfig('a.parallel'));
    const applyB = controlled.runtime.applyPartition('persist:webview-page-concurrent-B', makeProxyConfig('b.parallel'));
    await flushMicrotasks();
    assert.equal(controlled.started.length, 2, 'different account partitions must not be globally serialized');
    const startedPartitions = new Set(controlled.started.map(entry => entry.partition));
    assert.equal(startedPartitions.has('persist:webview-page-concurrent-A'), true);
    assert.equal(startedPartitions.has('persist:webview-page-concurrent-B'), true);
    for (const entry of controlled.started) entry.gate.resolve();
    assert.equal((await applyA).ok, true);
    assert.equal((await applyB).ok, true);
  }

  {
    const controlled = createControlledRuntime();
    const partition = 'persist:webview-page-recover';
    const failedApply = controlled.runtime.applyPartition(partition, makeProxyConfig('broken.proxy'));
    await flushMicrotasks();
    assert.equal(controlled.started.length, 1);
    const recoveredApply = controlled.runtime.applyPartition(partition, makeProxyConfig('recovered.proxy'));
    await flushMicrotasks();
    assert.equal(controlled.started.length, 1, 'a queued recovery must still wait while the failing mutation is unresolved');
    controlled.started[0].gate.reject(new Error('simulated async setProxy rejection'));
    const failedResult = await failedApply;
    assert.equal(failedResult.ok, false);
    await flushMicrotasks();
    assert.equal(controlled.started.length, 2, 'a failed mutation must not poison the per-partition queue');
    controlled.started[1].gate.resolve();
    const recoveredResult = await recoveredApply;
    assert.equal(recoveredResult.ok, true);
    assert.equal(controlled.runtime.stateFor(partition).host, 'recovered.proxy');
  }

  {
    const controlled = createControlledRuntime();
    const partition = 'persist:webview-page-forgotten';
    const inFlight = controlled.runtime.applyPartition(partition, makeProxyConfig('stale.proxy'));
    await flushMicrotasks();
    assert.equal(controlled.started.length, 1);
    controlled.runtime.forgetPartition(partition);
    assert.equal(controlled.runtime.stateFor(partition), null, 'forget must clear readiness immediately');
    controlled.started[0].gate.resolve();
    const staleResult = await inFlight;
    assert.equal(staleResult.stale, true, 'an in-flight apply invalidated by account deletion must be reported as stale');
    assert.equal(controlled.runtime.stateFor(partition), null, 'stale completion must never resurrect proxy readiness after account deletion');
  }

  console.log('PROXY_RUNTIME_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
