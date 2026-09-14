'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const proxy = require('../src/proxy-runtime.cjs');

function createEmitterApp() {
  const listeners = new Map();
  return {
    listeners,
    whenReady() { return Promise.resolve(); },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return this;
    },
    removeListener(event, handler) {
      listeners.get(event)?.delete(handler);
      if (!listeners.get(event)?.size) listeners.delete(event);
      return this;
    },
    emit(event, ...args) {
      for (const handler of [...(listeners.get(event) || [])]) handler(...args);
    },
    listenerCount(event) { return listeners.get(event)?.size || 0; },
  };
}

function createSessionHarness(timeline = []) {
  const sessions = new Map();
  const proto = {
    async setProxy(config) {
      this.calls.push(['native-setProxy', config]);
      timeline.push(['native-setProxy', this.partitionHint || 'default', config]);
      if (this.failNext) {
        this.failNext = false;
        throw Object.assign(new Error('proxy apply failed'), { code: 'PROXY_TEST_APPLY' });
      }
    },
  };
  function makeSession(partition = '') {
    const value = Object.create(proto);
    value.partitionHint = partition || 'default';
    value.storagePath = partition
      ? `/tmp/geek/Partitions/${partition.replace(/^persist:/, '')}`
      : '/tmp/geek/Session Storage';
    value.calls = [];
    value.failNext = false;
    value.closeAllConnections = async function closeAllConnections() {
      this.calls.push(['closeAllConnections']);
      timeline.push(['closeAllConnections', this.partitionHint]);
    };
    return value;
  }
  const defaultSession = makeSession('');
  return {
    proto,
    defaultSession,
    sessions,
    fromPartition(partition) {
      if (!sessions.has(partition)) sessions.set(partition, makeSession(partition));
      return sessions.get(partition);
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

(async () => {
  const accountA = {
    id: 'A',
    partition: 'persist:webview-page-A',
    openProxy: true,
    protocal: 'http',
    host: 'proxy-a.test',
    port: '8080',
    huser: 'alice',
    hpwd: 'alpha-secret',
  };
  const accountB = {
    id: 'B',
    partition: 'persist:webview-page-B',
    openProxy: false,
  };
  const globalProxy = {
    openProxy: true,
    protocal: 'socks5',
    host: 'proxy-global.test',
    port: '1080',
    login: 'global-user',
    password: 'global-secret',
  };

  // The UI protocol selector names the proxy server protocol. Electron receives only
  // scheme/host/port; proxy credentials are handled by the login challenge instead.
  assert.equal(proxy.proxyRulesFor(accountA), 'http://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor(globalProxy), 'socks5://proxy-global.test:1080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, protocal: 'https' }), 'https://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, protocal: 'socks4' }), 'socks4://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, host: '[2001:db8::1]' }), 'http://[2001:db8::1]:8080');
  for (const rules of [proxy.proxyRulesFor(accountA), proxy.proxyRulesFor(globalProxy)]) {
    assert.doesNotMatch(rules, /alice|alpha-secret|global-user|global-secret|@/);
  }
  assert.deepEqual(proxy.sessionProxyConfig(null), { mode: 'direct' });
  assert.throws(
    () => proxy.sessionProxyConfig({ openProxy: true, protocal: 'http', host: '', port: '8080' }),
    error => error?.code === 'PROXY_CONFIG_INVALID',
    'an enabled malformed proxy must fail closed instead of silently becoming direct',
  );
  assert.equal(proxy.effectiveProxyConfig(accountA, globalProxy), accountA);
  assert.equal(proxy.effectiveProxyConfig(accountB, globalProxy), globalProxy);

  // Standalone runtime: prove authentication ownership, dedupe, changed-connection
  // teardown, and per-partition failure isolation independently of composition wiring.
  {
    const app = createEmitterApp();
    const session = createSessionHarness();
    const accounts = [clone(accountA), clone(accountB)];
    let globalConfig = clone(globalProxy);
    const errors = [];
    const runtime = proxy.createProxyRuntime({
      app,
      session,
      accountState: {
        getSnapshot: () => ({ accounts: clone(accounts) }),
        findByPartition: partition => clone(accounts.find(item => item.partition === partition) || null),
      },
      getGlobalConfig: () => clone(globalConfig),
      onError(error, meta) { errors.push({ error, meta }); },
    });

    assert.equal(runtime.installAuthentication(), true);
    assert.equal(runtime.installAuthentication(), false, 'authentication owner installs exactly once');
    assert.equal(app.listenerCount('login'), 1);

    const startup = await runtime.applyAllAccounts({ closeConnections: false });
    assert.deepEqual(startup.map(row => [row.accountId, row.ok]), [['A', true], ['B', true]]);
    const aSession = session.sessions.get(accountA.partition);
    const bSession = session.sessions.get(accountB.partition);
    assert.equal(aSession.calls[0][1].proxyRules, 'http://proxy-a.test:8080');
    assert.equal(bSession.calls[0][1].proxyRules, 'socks5://proxy-global.test:1080');

    await runtime.applyAccount(accounts[0]);
    assert.equal(aSession.calls.length, 1, 'unchanged effective proxy must not churn healthy sockets');

    accounts[0].hpwd = 'alpha-secret-2';
    await runtime.applyAccount(accounts[0]);
    assert.deepEqual(aSession.calls.slice(-2).map(call => call[0]), ['native-setProxy', 'closeAllConnections']);
    assert.doesNotMatch(JSON.stringify(aSession.calls.at(-2)[1]), /alpha-secret-2|alice/);

    function challenge(partition, details, authInfo) {
      let prevented = 0;
      const credentials = [];
      const handled = runtime.handleLogin(
        { preventDefault() { prevented += 1; } },
        { session: { partition } },
        details,
        authInfo,
        (username, password) => credentials.push([username, password]),
      );
      return { handled, prevented, credentials };
    }

    assert.deepEqual(
      challenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'PROXY-A.TEST', port: 8080 }),
      { handled: true, prevented: 1, credentials: [['alice', 'alpha-secret-2']] },
    );
    assert.deepEqual(
      challenge(accountB.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-global.test', port: 1080 }).credentials,
      [['global-user', 'global-secret']],
    );
    for (const rejected of [
      challenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: false, host: 'proxy-a.test', port: 8080 }),
      challenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'other.test', port: 8080 }),
      challenge('persist:webview-page-UNKNOWN', { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-a.test', port: 8080 }),
      challenge(accountA.partition, { firstAuthAttempt: false }, { isProxy: true, host: 'proxy-a.test', port: 8080 }),
    ]) {
      assert.equal(rejected.handled, false);
      assert.equal(rejected.prevented, 0);
      assert.deepEqual(rejected.credentials, []);
    }

    accounts[0].host = 'proxy-a2.test';
    aSession.failNext = true;
    assert.equal(await runtime.applyAccount(accounts[0]), false);
    assert.equal(runtime.isPartitionReady(accountA.partition), false);
    assert.equal(runtime.isPartitionReady(accountB.partition), true);
    assert.equal(errors.at(-1).meta.partition, accountA.partition);
    assert.deepEqual(
      challenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-a2.test', port: 8080 }).credentials,
      [],
      'a failed partition must not receive proxy credentials',
    );

    accounts[0].host = '';
    assert.equal(await runtime.applyAccount(accounts[0]), false);
    assert.equal(errors.at(-1).error.code, 'PROXY_CONFIG_INVALID');
    assert.equal(runtime.isPartitionReady(accountA.partition), false);
    assert.equal(runtime.isPartitionReady(accountB.partition), true);

    runtime.forgetPartition(accountA.partition);
    assert.equal(runtime.isPartitionReady(accountA.partition), false, 'forgotten partitions are unknown/not ready');

    globalConfig = { ...globalConfig, openProxy: false };
    await runtime.applyAccount(accounts[1]);
    assert.deepEqual(bSession.calls.slice(-2), [
      ['native-setProxy', { mode: 'direct' }],
      ['closeAllConnections'],
    ]);

    runtime.dispose();
    assert.equal(app.listenerCount('login'), 0);
  }

  // Composition contract: main-entry decorates the same Account/Config Store factories
  // consumed by legacy main.cjs. Durable mutations stay authoritative; the runtime only
  // projects those commits into account Sessions and never caches a second plaintext config.
  {
    const timeline = [];
    const app = createEmitterApp();
    const sessionModule = createSessionHarness(timeline);
    let accounts = [clone(accountA), clone(accountB)];
    let config = clone(globalProxy);

    const rawAccountStore = {
      async load() { timeline.push(['account-load']); return { accounts: clone(accounts) }; },
      getSnapshot() { return { accounts: clone(accounts) }; },
      findByPartition(partition) { return clone(accounts.find(item => item.partition === partition) || null); },
      async add(payload) {
        const account = clone(payload);
        accounts.push(account);
        timeline.push(['account-add-commit', account.id]);
        return { account: clone(account), snapshot: { accounts: clone(accounts) } };
      },
      async update(accountId, patch) {
        const account = accounts.find(item => item.id === accountId);
        Object.assign(account, patch || {});
        timeline.push(['account-update-commit', accountId]);
        return { account: clone(account), snapshot: { accounts: clone(accounts) } };
      },
      async remove(accountId) {
        const index = accounts.findIndex(item => item.id === accountId);
        const [removedAccount] = accounts.splice(index, 1);
        timeline.push(['account-remove-commit', accountId]);
        return { removedAccount: clone(removedAccount), snapshot: { accounts: clone(accounts) } };
      },
    };
    const rawConfigStore = {
      async load() { timeline.push(['config-load']); return clone(config); },
      getSnapshot() { return clone(config); },
      async update(patch) {
        config = { ...config, ...(patch || {}) };
        timeline.push(['config-update-commit']);
        return clone(config);
      },
    };
    const originalAccountFactory = () => rawAccountStore;
    const originalConfigFactory = () => rawConfigStore;
    const accountStateModule = { createAccountStateStore: originalAccountFactory };
    const configStateModule = { createConfigStateStore: originalConfigFactory };
    const errors = [];

    const composition = proxy.installProxyRuntimeComposition({
      app,
      sessionModule,
      accountStateModule,
      configStateModule,
      onError(error, meta) { errors.push({ error, meta }); },
    });
    await composition.ready;

    const accountStore = accountStateModule.createAccountStateStore();
    const configStore = configStateModule.createConfigStateStore();
    assert.notEqual(accountStore, rawAccountStore, 'composition decorates the existing store instance rather than replacing its authority');
    assert.notEqual(configStore, rawConfigStore);
    assert.equal(accountStore.getSnapshot(), rawAccountStore.getSnapshot(), 'spread methods preserve the real account store projection');

    await accountStore.load();
    assert.equal(sessionModule.sessions.size, 0, 'proxy pre-apply waits until both durable stores have loaded');
    await configStore.load();

    const aSession = sessionModule.sessions.get(accountA.partition);
    const bSession = sessionModule.sessions.get(accountB.partition);
    assert.ok(aSession && bSession, 'all existing account Sessions are configured during startup state load');
    assert.equal(aSession.calls[0][1].proxyRules, 'http://proxy-a.test:8080');
    assert.equal(bSession.calls[0][1].proxyRules, 'socks5://proxy-global.test:1080');
    assert.doesNotMatch(JSON.stringify(aSession.calls[0][1]), /alice|alpha-secret|@/);
    assert.doesNotMatch(JSON.stringify(bSession.calls[0][1]), /global-user|global-secret|@/);
    const runtime = composition.getRuntime();
    assert.ok(runtime);
    assert.equal(runtime.isPartitionReady(accountA.partition), true);
    assert.equal(runtime.isPartitionReady(accountB.partition), true);

    const addStart = timeline.length;
    const accountC = {
      id: 'C',
      partition: 'persist:webview-page-C',
      openProxy: false,
      protocal: 'http',
      host: '',
      port: '',
      huser: '',
      hpwd: '',
    };
    await accountStore.add(accountC);
    const addSlice = timeline.slice(addStart);
    assert.equal(addSlice[0][0], 'account-add-commit', 'durable account add commits before proxy side effects');
    assert.equal(addSlice[1][0], 'native-setProxy');
    assert.equal(addSlice[1][1], accountC.partition);
    assert.equal(sessionModule.sessions.get(accountC.partition).calls[0][1].proxyRules, 'socks5://proxy-global.test:1080');

    const updateStart = timeline.length;
    await accountStore.update('A', { hpwd: 'alpha-secret-3' });
    const updateSlice = timeline.slice(updateStart);
    assert.equal(updateSlice[0][0], 'account-update-commit', 'durable account update commits before proxy side effects');
    assert.equal(updateSlice[1][0], 'native-setProxy');
    assert.equal(updateSlice[1][1], accountA.partition);
    assert.deepEqual(updateSlice[2], ['closeAllConnections', accountA.partition]);
    assert.doesNotMatch(JSON.stringify(updateSlice[1][2]), /alpha-secret-3|alice|@/);

    const configStart = timeline.length;
    await configStore.update({ host: 'proxy-global2.test' });
    const configSlice = timeline.slice(configStart);
    assert.equal(configSlice[0][0], 'config-update-commit', 'global config commits before account Session reprojection');
    const changedPartitions = configSlice.filter(row => row[0] === 'native-setProxy').map(row => row[1]).sort();
    assert.deepEqual(changedPartitions, [accountB.partition, accountC.partition].sort(), 'only accounts inheriting global proxy are reconfigured');
    for (const row of configSlice.filter(item => item[0] === 'native-setProxy')) {
      assert.equal(row[2].proxyRules, 'socks5://proxy-global2.test:1080');
      assert.doesNotMatch(JSON.stringify(row[2]), /global-user|global-secret|@/);
    }

    // Legacy main.cjs still calls Session.setProxy. For account Sessions the early
    // compatibility seam ignores the caller-supplied rule (including old userinfo)
    // and reapplies the authoritative current account/global config instead.
    const bNativeBeforeLegacy = bSession.calls.length;
    const legacyResult = await bSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: 'http://wrong:secret@evil.invalid:9999',
    });
    assert.equal(legacyResult, true);
    assert.equal(bSession.calls.length, bNativeBeforeLegacy, 'unchanged authoritative config dedupes legacy setProxy calls');

    const defaultConfig = { mode: 'fixed_servers', proxyRules: 'http://default-proxy.test:8000' };
    await sessionModule.defaultSession.setProxy(defaultConfig);
    assert.deepEqual(sessionModule.defaultSession.calls.at(-1), ['native-setProxy', defaultConfig], 'non-account Sessions retain Electron native setProxy behavior');

    function authChallenge(partition, details, authInfo) {
      let prevented = 0;
      const credentials = [];
      const handled = runtime.handleLogin(
        { preventDefault() { prevented += 1; } },
        { session: sessionModule.fromPartition(partition) },
        details,
        authInfo,
        (username, password) => credentials.push([username, password]),
      );
      return { handled, prevented, credentials };
    }
    assert.deepEqual(
      authChallenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-a.test', port: 8080 }).credentials,
      [['alice', 'alpha-secret-3']],
    );
    assert.deepEqual(
      authChallenge(accountB.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-global2.test', port: 1080 }).credentials,
      [['global-user', 'global-secret']],
    );
    assert.deepEqual(
      authChallenge(accountB.partition, { firstAuthAttempt: true }, { isProxy: false, host: 'proxy-global2.test', port: 1080 }).credentials,
      [],
      'ordinary website auth is never answered with proxy credentials',
    );

    // A committed but invalid enabled proxy marks only that partition not ready. The
    // early will-attach boundary blocks that account without affecting healthy peers.
    await accountStore.update('A', { host: '' });
    assert.equal(runtime.isPartitionReady(accountA.partition), false);
    assert.equal(runtime.isPartitionReady(accountB.partition), true);
    assert.equal(errors.at(-1).error.code, 'PROXY_CONFIG_INVALID');

    function createHostContents() {
      const handlers = new Map();
      return {
        on(event, handler) { handlers.set(event, handler); },
        emit(event, ...args) { handlers.get(event)?.(...args); },
      };
    }
    const hostContents = createHostContents();
    app.emit('web-contents-created', {}, hostContents);
    let blockedA = 0;
    hostContents.emit('will-attach-webview', { preventDefault() { blockedA += 1; } }, {}, { partition: accountA.partition });
    assert.equal(blockedA, 1, 'failed account partition must fail closed before WebView attach');
    let blockedB = 0;
    hostContents.emit('will-attach-webview', { preventDefault() { blockedB += 1; } }, {}, { partition: accountB.partition });
    assert.equal(blockedB, 0, 'healthy account partitions remain isolated from peer failure');

    assert.equal(runtime.isPartitionReady(accountC.partition), true);
    const cSession = sessionModule.sessions.get(accountC.partition);
    const cCallsBeforeRemove = cSession.calls.length;
    await accountStore.remove('C');
    assert.equal(runtime.isPartitionReady(accountC.partition), false, 'account removal forgets operational proxy readiness');
    assert.equal(await cSession.setProxy({ mode: 'direct' }), false, 'removed account Session cannot resurrect a proxy config through the legacy seam');
    assert.equal(cSession.calls.length, cCallsBeforeRemove, 'removed account never reaches native setProxy again');

    await configStore.update({ openProxy: false });
    assert.deepEqual(bSession.calls.slice(-2), [
      ['native-setProxy', { mode: 'direct' }],
      ['closeAllConnections'],
    ]);

    const decoratedAccountFactory = accountStateModule.createAccountStateStore;
    assert.notEqual(decoratedAccountFactory, originalAccountFactory);
    composition.dispose();
    assert.equal(accountStateModule.createAccountStateStore, originalAccountFactory);
    assert.equal(configStateModule.createConfigStateStore, originalConfigFactory);
    assert.equal(app.listenerCount('login'), 0);
    assert.equal(app.listenerCount('web-contents-created'), 0);

    const nativeAfterDispose = { mode: 'fixed_servers', proxyRules: 'http://native-after-dispose.test:9000' };
    await bSession.setProxy(nativeAfterDispose);
    assert.deepEqual(bSession.calls.at(-1), ['native-setProxy', nativeAfterDispose], 'dispose restores the native Session method');
  }

  // Production wiring: preserve the existing partition-compat startup gate while adding
  // proxy readiness as a second early boundary before legacy main.cjs can create UI.
  const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
  const compatInstall = entry.indexOf('installSessionPartitionCompat({ app, sessionModule: session })');
  const proxyInstall = entry.indexOf('installProxyRuntimeComposition({');
  const readyList = entry.indexOf('Promise.all([');
  const compatReady = entry.indexOf('sessionPartitionCompat.ready', readyList);
  const proxyReady = entry.indexOf('proxyRuntimeComposition.ready', readyList);
  const thenIndex = entry.indexOf('.then(', readyList);
  const mainIndex = entry.indexOf("require('./main.cjs')", thenIndex);
  const catchIndex = entry.indexOf('.catch(', mainIndex);
  assert.ok(compatInstall >= 0 && proxyInstall > compatInstall, 'proxy owner composes after partition identity compatibility is installed');
  assert.ok(readyList > proxyInstall && compatReady > readyList && proxyReady > readyList, 'both early runtime boundaries participate in startup readiness');
  assert.ok(thenIndex > proxyReady && mainIndex > thenIndex, 'legacy main loads only after partition and proxy boundaries are ready');
  assert.ok(catchIndex > mainIndex);
  assert.match(entry.slice(catchIndex), /app\.quit\(\)/, 'early runtime boundary failure must block startup');
  assert.match(entry, /accountStateModule\s*=\s*require\(['"]\.\/account-state\.cjs['"]\)/);
  assert.match(entry, /configStateModule\s*=\s*require\(['"]\.\/config-state\.cjs['"]\)/);
  assert.match(entry, /installProxyRuntimeComposition\(\{[\s\S]*accountStateModule,[\s\S]*configStateModule,/);

  console.log('PROXY_RUNTIME_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
