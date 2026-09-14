'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const proxy = require('../src/proxy-runtime.cjs');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createApp() {
  const listeners = new Map();
  return {
    whenReady: () => Promise.resolve(),
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

function createSessionModule(timeline) {
  const sessions = new Map();
  const proto = {
    async setProxy(config) {
      this.calls.push(['setProxy', clone(config)]);
      timeline.push(['setProxy', this.partitionKey || 'default', clone(config)]);
      if (this.failNext) {
        this.failNext = false;
        throw Object.assign(new Error('proxy apply failed'), { code: 'PROXY_TEST_APPLY' });
      }
    },
  };
  function makeSession(partition = '') {
    const session = Object.create(proto);
    session.partitionKey = partition;
    session.storagePath = partition
      ? `/tmp/geek/Partitions/${partition.replace(/^persist:/, '')}`
      : '/tmp/geek/Session Storage';
    session.calls = [];
    session.failNext = false;
    session.closeAllConnections = async function closeAllConnections() {
      this.calls.push(['closeAllConnections']);
      timeline.push(['closeAllConnections', this.partitionKey]);
    };
    return session;
  }
  return {
    defaultSession: makeSession(),
    sessions,
    fromPartition(partition) {
      if (!sessions.has(partition)) sessions.set(partition, makeSession(partition));
      return sessions.get(partition);
    },
  };
}

function createHostContents() {
  const handlers = new Map();
  return {
    on(event, handler) { handlers.set(event, handler); },
    emit(event, ...args) { handlers.get(event)?.(...args); },
  };
}

(async () => {
  const accountA = {
    id: 'A', partition: 'persist:webview-page-A', openProxy: true,
    protocal: 'http', host: 'proxy-a.test', port: '8080', huser: 'alice', hpwd: 'alpha-secret',
  };
  const accountB = { id: 'B', partition: 'persist:webview-page-B', openProxy: false };
  const globalProxy = {
    openProxy: true, protocal: 'socks5', host: 'proxy-global.test', port: '1080',
    login: 'global-user', password: 'global-secret',
  };

  // ProxyConfig grammar: protocol/host/port only. Credentials belong to app.login.
  assert.equal(proxy.proxyRulesFor(accountA), 'http://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor(globalProxy), 'socks5://proxy-global.test:1080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, protocal: 'https' }), 'https://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, protocal: 'socks4' }), 'socks4://proxy-a.test:8080');
  assert.equal(proxy.proxyRulesFor({ ...accountA, host: '[2001:db8::1]' }), 'http://[2001:db8::1]:8080');
  assert.deepEqual(proxy.sessionProxyConfig(null), { mode: 'direct' });
  assert.throws(
    () => proxy.sessionProxyConfig({ openProxy: true, protocal: 'http', host: '', port: '8080' }),
    error => error?.code === 'PROXY_CONFIG_INVALID',
  );
  for (const rules of [proxy.proxyRulesFor(accountA), proxy.proxyRulesFor(globalProxy)]) {
    assert.doesNotMatch(rules, /alice|alpha-secret|global-user|global-secret|@/);
  }

  const timeline = [];
  const app = createApp();
  const sessionModule = createSessionModule(timeline);
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

  // Legacy main receives decorated views over the same real stores; it does not get a
  // second state owner. Startup proxy application waits for both durable stores to load.
  const accountStore = accountStateModule.createAccountStateStore();
  const configStore = configStateModule.createConfigStateStore();
  assert.deepEqual(accountStore.getSnapshot(), rawAccountStore.getSnapshot());
  await accountStore.load();
  assert.equal(sessionModule.sessions.size, 0);
  await configStore.load();

  const runtime = composition.getRuntime();
  const aSession = sessionModule.sessions.get(accountA.partition);
  const bSession = sessionModule.sessions.get(accountB.partition);
  assert.ok(runtime && aSession && bSession);
  assert.equal(runtime.isPartitionReady(accountA.partition), true);
  assert.equal(runtime.isPartitionReady(accountB.partition), true);
  assert.equal(aSession.calls[0][1].proxyRules, 'http://proxy-a.test:8080');
  assert.equal(bSession.calls[0][1].proxyRules, 'socks5://proxy-global.test:1080');
  assert.doesNotMatch(JSON.stringify(aSession.calls[0][1]), /alice|alpha-secret|@/);
  assert.doesNotMatch(JSON.stringify(bSession.calls[0][1]), /global-user|global-secret|@/);

  // New account and account updates cross the durable commit point before Session side effects.
  const accountC = {
    id: 'C', partition: 'persist:webview-page-C', openProxy: false,
    protocal: 'http', host: '', port: '', huser: '', hpwd: '',
  };
  let start = timeline.length;
  await accountStore.add(accountC);
  let slice = timeline.slice(start);
  assert.deepEqual(slice.slice(0, 2).map(row => row[0]), ['account-add-commit', 'setProxy']);
  assert.equal(slice[1][1], accountC.partition);
  assert.equal(sessionModule.sessions.get(accountC.partition).calls[0][1].proxyRules, 'socks5://proxy-global.test:1080');

  start = timeline.length;
  await accountStore.update('A', { hpwd: 'alpha-secret-2' });
  slice = timeline.slice(start);
  assert.deepEqual(slice.slice(0, 3).map(row => row[0]), ['account-update-commit', 'setProxy', 'closeAllConnections']);
  assert.doesNotMatch(JSON.stringify(slice[1][2]), /alice|alpha-secret-2|@/);

  // Global updates reproject only accounts inheriting the global proxy.
  start = timeline.length;
  await configStore.update({ host: 'proxy-global2.test' });
  slice = timeline.slice(start);
  assert.equal(slice[0][0], 'config-update-commit');
  assert.deepEqual(
    slice.filter(row => row[0] === 'setProxy').map(row => row[1]).sort(),
    [accountB.partition, accountC.partition].sort(),
  );

  // Legacy account Session.setProxy calls are ignored as configuration input. The runtime
  // re-resolves the current durable owner, so old userinfo rules cannot leak credentials.
  const bCallsBeforeLegacy = bSession.calls.length;
  assert.equal(await bSession.setProxy({ mode: 'fixed_servers', proxyRules: 'http://wrong:secret@evil.invalid:9999' }), true);
  assert.equal(bSession.calls.length, bCallsBeforeLegacy, 'unchanged authoritative proxy is deduped');
  const defaultConfig = { mode: 'fixed_servers', proxyRules: 'http://default-proxy.test:8000' };
  await sessionModule.defaultSession.setProxy(defaultConfig);
  assert.deepEqual(sessionModule.defaultSession.calls.at(-1), ['setProxy', defaultConfig], 'non-account Session stays native');

  function challenge(partition, details, authInfo) {
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
    challenge(accountA.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'PROXY-A.TEST', port: 8080 }),
    { handled: true, prevented: 1, credentials: [['alice', 'alpha-secret-2']] },
  );
  assert.deepEqual(
    challenge(accountB.partition, { firstAuthAttempt: true }, { isProxy: true, host: 'proxy-global2.test', port: 1080 }).credentials,
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

  // A native proxy-apply failure marks only A not-ready. The WebView attachment boundary
  // then blocks A while B remains usable.
  aSession.failNext = true;
  await accountStore.update('A', { host: 'proxy-a2.test' });
  assert.equal(runtime.isPartitionReady(accountA.partition), false);
  assert.equal(runtime.isPartitionReady(accountB.partition), true);
  assert.equal(errors.at(-1).meta.partition, accountA.partition);
  assert.equal(errors.at(-1).error.code, 'PROXY_TEST_APPLY');

  const hostContents = createHostContents();
  app.emit('web-contents-created', {}, hostContents);
  let blockedA = 0;
  hostContents.emit('will-attach-webview', { preventDefault() { blockedA += 1; } }, {}, { partition: accountA.partition });
  assert.equal(blockedA, 1);
  let blockedB = 0;
  hostContents.emit('will-attach-webview', { preventDefault() { blockedB += 1; } }, {}, { partition: accountB.partition });
  assert.equal(blockedB, 0);

  // Recover A through the durable account owner, then prove account removal forgets only
  // C's operational runtime state and cannot resurrect it through legacy setProxy.
  await accountStore.update('A', { host: 'proxy-a.test' });
  assert.equal(runtime.isPartitionReady(accountA.partition), true);
  const cSession = sessionModule.sessions.get(accountC.partition);
  const cCallsBeforeRemove = cSession.calls.length;
  assert.equal(runtime.isPartitionReady(accountC.partition), true);
  await accountStore.remove('C');
  assert.equal(runtime.isPartitionReady(accountC.partition), false);
  assert.equal(await cSession.setProxy({ mode: 'direct' }), false);
  assert.equal(cSession.calls.length, cCallsBeforeRemove);

  await configStore.update({ openProxy: false });
  assert.deepEqual(bSession.calls.slice(-2), [
    ['setProxy', { mode: 'direct' }],
    ['closeAllConnections'],
  ]);

  composition.dispose();
  assert.equal(accountStateModule.createAccountStateStore, originalAccountFactory);
  assert.equal(configStateModule.createConfigStateStore, originalConfigFactory);
  assert.equal(app.listenerCount('login'), 0);
  assert.equal(app.listenerCount('web-contents-created'), 0);
  const nativeAfterDispose = { mode: 'fixed_servers', proxyRules: 'http://native-after-dispose.test:9000' };
  await bSession.setProxy(nativeAfterDispose);
  assert.deepEqual(bSession.calls.at(-1), ['setProxy', nativeAfterDispose]);

  // Production source order: preserve the existing Session partition gate and make proxy
  // readiness a peer early boundary before legacy main.cjs is evaluated.
  const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
  const compatInstall = entry.indexOf('installSessionPartitionCompat({ app, sessionModule: session })');
  const proxyInstall = entry.indexOf('installProxyRuntimeComposition({');
  const readyList = entry.indexOf('Promise.all([');
  const compatReady = entry.indexOf('sessionPartitionCompat.ready', readyList);
  const proxyReady = entry.indexOf('proxyRuntimeComposition.ready', readyList);
  const thenIndex = entry.indexOf('.then(', readyList);
  const mainIndex = entry.indexOf("require('./main.cjs')", thenIndex);
  const catchIndex = entry.indexOf('.catch(', mainIndex);
  assert.ok(compatInstall >= 0 && proxyInstall > compatInstall);
  assert.ok(readyList > proxyInstall && compatReady > readyList && proxyReady > readyList);
  assert.ok(thenIndex > proxyReady && mainIndex > thenIndex && catchIndex > mainIndex);
  assert.match(entry.slice(catchIndex), /app\.quit\(\)/);
  assert.match(entry, /accountStateModule\s*=\s*require\(['"]\.\/account-state\.cjs['"]\)/);
  assert.match(entry, /configStateModule\s*=\s*require\(['"]\.\/config-state\.cjs['"]\)/);

  console.log('PROXY_RUNTIME_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
