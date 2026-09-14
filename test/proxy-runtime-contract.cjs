'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const proxyRuntime = require('../src/proxy-runtime.cjs');

function fakeApp() {
  const listeners = new Map();
  return {
    listeners,
    on(event, handler) { listeners.set(event, handler); },
    removeListener(event, handler) { if (listeners.get(event) === handler) listeners.delete(event); },
  };
}

function fakeSessionModule() {
  const sessions = new Map();
  return {
    sessions,
    fromPartition(partition) {
      if (!sessions.has(partition)) {
        const calls = [];
        sessions.set(partition, {
          calls,
          failNext: false,
          async setProxy(config) {
            calls.push(['setProxy', config]);
            if (this.failNext) {
              this.failNext = false;
              throw Object.assign(new Error('proxy apply failed'), { code: 'PROXY_TEST_APPLY' });
            }
          },
          async closeAllConnections() { calls.push(['closeAllConnections']); },
        });
      }
      return sessions.get(partition);
    },
  };
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
  const accounts = [accountA, accountB];
  let globalConfig = {
    openProxy: true,
    protocal: 'socks5',
    host: 'proxy-global.test',
    port: '1080',
    login: 'global-user',
    password: 'global-secret',
  };

  // The UI field is the proxy server protocol. Electron ProxyConfig accepts a proxy
  // URI applying to the Session; credentials must never be embedded as URL userinfo.
  assert.equal(proxyRuntime.proxyRulesFor(accountA), 'http://proxy-a.test:8080');
  assert.equal(proxyRuntime.proxyRulesFor(globalConfig), 'socks5://proxy-global.test:1080');
  assert.equal(proxyRuntime.proxyRulesFor({ ...accountA, protocal: 'https' }), 'https://proxy-a.test:8080');
  assert.equal(proxyRuntime.proxyRulesFor({ ...accountA, protocal: 'socks4' }), 'socks4://proxy-a.test:8080');
  assert.equal(proxyRuntime.proxyRulesFor({ ...accountA, host: '[2001:db8::1]' }), 'http://[2001:db8::1]:8080');
  for (const rules of [proxyRuntime.proxyRulesFor(accountA), proxyRuntime.proxyRulesFor(globalConfig)]) {
    assert.doesNotMatch(rules, /alice|alpha-secret|global-user|global-secret|@/);
  }
  assert.deepEqual(proxyRuntime.sessionProxyConfig(null), { mode: 'direct' });
  assert.throws(
    () => proxyRuntime.sessionProxyConfig({ openProxy: true, protocal: 'http', host: '', port: '8080' }),
    error => error?.code === 'PROXY_CONFIG_INVALID',
    'an enabled but invalid proxy must fail closed rather than becoming direct mode',
  );
  assert.equal(proxyRuntime.effectiveProxyConfig(accountA, globalConfig), accountA);
  assert.equal(proxyRuntime.effectiveProxyConfig(accountB, globalConfig), globalConfig);

  const app = fakeApp();
  const session = fakeSessionModule();
  const accountState = {
    getSnapshot() { return { accounts: accounts.map(account => ({ ...account })) }; },
    findByPartition(partition) { return accounts.find(account => account.partition === partition) || null; },
  };
  const errors = [];
  const runtime = proxyRuntime.createProxyRuntime({
    app,
    session,
    accountState,
    getGlobalConfig: () => ({ ...globalConfig }),
    onError(error, meta) { errors.push({ error, meta }); },
  });

  assert.equal(runtime.installAuthentication(), true);
  assert.equal(runtime.installAuthentication(), false, 'login owner must install only once');
  assert.equal(typeof app.listeners.get('login'), 'function');

  const startup = await runtime.applyAllAccounts({ closeConnections: false });
  assert.deepEqual(startup.map(row => [row.accountId, row.ok]), [['A', true], ['B', true]]);
  const aSession = session.sessions.get(accountA.partition);
  const bSession = session.sessions.get(accountB.partition);
  assert.deepEqual(aSession.calls, [[
    'setProxy',
    {
      mode: 'fixed_servers',
      proxyRules: 'http://proxy-a.test:8080',
      proxyBypassRules: '<local>',
    },
  ]]);
  assert.deepEqual(bSession.calls, [[
    'setProxy',
    {
      mode: 'fixed_servers',
      proxyRules: 'socks5://proxy-global.test:1080',
      proxyBypassRules: '<local>',
    },
  ]]);

  // Unchanged effective proxy state is a no-op: ordinary account/config writes must
  // not tear down healthy sockets.
  await runtime.applyAccount(accountA);
  assert.equal(aSession.calls.length, 1);

  // Credential changes are part of the operational proxy fingerprint even though
  // credentials are deliberately absent from proxyRules. Re-auth must close pooled
  // connections after the new setting is committed.
  accountA.hpwd = 'alpha-secret-2';
  await runtime.applyAccount(accountA);
  assert.equal(aSession.calls.length, 3);
  assert.equal(aSession.calls[1][0], 'setProxy');
  assert.deepEqual(aSession.calls[2], ['closeAllConnections']);

  function challenge({ webContents, details, authInfo }) {
    let prevented = 0;
    const credentials = [];
    const handled = runtime.handleLogin(
      { preventDefault() { prevented += 1; } },
      webContents,
      details,
      authInfo,
      (username, password) => credentials.push([username, password]),
    );
    return { handled, prevented, credentials };
  }

  const aChallenge = challenge({
    webContents: { session: { partition: accountA.partition } },
    details: { firstAuthAttempt: true },
    authInfo: { isProxy: true, host: 'PROXY-A.TEST', port: 8080 },
  });
  assert.deepEqual(aChallenge, {
    handled: true,
    prevented: 1,
    credentials: [['alice', 'alpha-secret-2']],
  });

  const bChallenge = challenge({
    webContents: { session: { partition: accountB.partition } },
    details: { firstAuthAttempt: true },
    authInfo: { isProxy: true, host: 'proxy-global.test', port: 1080 },
  });
  assert.deepEqual(bChallenge.credentials, [['global-user', 'global-secret']]);

  for (const rejected of [
    challenge({
      webContents: { session: { partition: accountA.partition } },
      details: { firstAuthAttempt: true },
      authInfo: { isProxy: false, host: 'proxy-a.test', port: 8080 },
    }),
    challenge({
      webContents: { session: { partition: accountA.partition } },
      details: { firstAuthAttempt: true },
      authInfo: { isProxy: true, host: 'proxy-b.test', port: 8080 },
    }),
    challenge({
      webContents: { session: { partition: 'persist:webview-page-UNKNOWN' } },
      details: { firstAuthAttempt: true },
      authInfo: { isProxy: true, host: 'proxy-a.test', port: 8080 },
    }),
    challenge({
      webContents: { session: { partition: accountA.partition } },
      details: { firstAuthAttempt: false },
      authInfo: { isProxy: true, host: 'proxy-a.test', port: 8080 },
    }),
  ]) {
    assert.equal(rejected.handled, false);
    assert.equal(rejected.prevented, 0);
    assert.deepEqual(rejected.credentials, []);
  }

  // A failed apply belongs only to that account partition and fails auth closed. It
  // cannot suppress or redirect another account's credentials.
  accountA.host = 'proxy-a2.test';
  aSession.failNext = true;
  assert.equal(await runtime.applyAccount(accountA), false);
  assert.equal(runtime.isPartitionReady(accountA.partition), false);
  assert.equal(runtime.isPartitionReady(accountB.partition), true);
  assert.equal(errors.at(-1).meta.partition, accountA.partition);
  assert.deepEqual(challenge({
    webContents: { session: { partition: accountA.partition } },
    details: { firstAuthAttempt: true },
    authInfo: { isProxy: true, host: 'proxy-a2.test', port: 8080 },
  }).credentials, []);
  assert.deepEqual(challenge({
    webContents: { session: { partition: accountB.partition } },
    details: { firstAuthAttempt: true },
    authInfo: { isProxy: true, host: 'proxy-global.test', port: 1080 },
  }).credentials, [['global-user', 'global-secret']]);

  // A malformed enabled config also fails closed for only its partition; it cannot
  // silently drop to direct mode.
  accountA.host = '';
  assert.equal(await runtime.applyAccount(accountA), false);
  assert.equal(runtime.isPartitionReady(accountA.partition), false);
  assert.equal(errors.at(-1).error.code, 'PROXY_CONFIG_INVALID');
  assert.equal(runtime.isPartitionReady(accountB.partition), true);

  // Deleting an account removes only its operational runtime state. Credentials stay
  // owned by Account/Config State and are never cached here in plaintext.
  assert.equal(runtime.forgetPartition(accountA.partition), true);
  assert.equal(runtime.isPartitionReady(accountA.partition), true, 'forgotten partitions return to unknown, not failed');
  assert.equal(runtime.isPartitionReady(accountB.partition), true);

  // Disabling the global proxy moves B to direct mode and closes only B's pooled
  // connections because its effective proxy fingerprint changed.
  globalConfig = { ...globalConfig, openProxy: false };
  await runtime.applyAccount(accountB);
  assert.deepEqual(bSession.calls.slice(-2), [
    ['setProxy', { mode: 'direct' }],
    ['closeAllConnections'],
  ]);

  runtime.dispose();
  assert.equal(app.listeners.has('login'), false);

  // Production composition contract: the owner must be wired to loaded Account/Config
  // authorities, pre-apply before the subscription/main-window gate, apply new accounts
  // before renderer exposure, and fail closed when a partition apply failed.
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  assert.match(main, /require\(['"]\.\/proxy-runtime\.cjs['"]\)/);
  assert.match(main, /proxyRuntime\s*=\s*createProxyRuntime\(/);
  assert.match(main, /proxyRuntime\.installAuthentication\(\)/);
  assert.match(main, /await proxyRuntime\.applyAllAccounts\(\{\s*closeConnections:\s*false\s*\}\)/);
  assert.ok(
    main.indexOf('await proxyRuntime.applyAllAccounts({ closeConnections: false })') < main.indexOf('await enforceSubscriptionGate()'),
    'existing account Sessions must be configured before the UI gate can create account WebViews',
  );
  const addBody = main.match(/async function addAccount\([\s\S]*?\n}\n\nasync function switchAccount/)?.[0] || '';
  assert.match(addBody, /await proxyRuntime\?\.applyAccount\(account, \{ closeConnections: false \}\)/);
  assert.ok(
    addBody.indexOf('await proxyRuntime?.applyAccount') < addBody.indexOf('notifyAccountsChanged'),
    'new account proxy must be attempted before renderer notification/return',
  );
  assert.match(main, /proxyRuntime\?\.forgetPartition\(removedAccount\.partition\)/);
  assert.doesNotMatch(main, /function proxyRulesFor\(/, 'ProxyConfig grammar must have one owner');
  assert.doesNotMatch(main, /encodeURIComponent\(login\)|encodeURIComponent\(password\)/, 'main must not rebuild credential-bearing proxy rules');
  assert.match(main, /if \(proxyRuntime && !proxyRuntime\.isPartitionReady\(partition\)\) \{[\s\S]{0,240}event\.preventDefault\(\)/);
  assert.doesNotMatch(
    main,
    /will-attach-webview[\s\S]{0,2600}applyProxyForPartition\(partition, accountProxy\)/,
    'WebView attach must not race an unawaited setProxy operation',
  );

  console.log('PROXY_RUNTIME_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
