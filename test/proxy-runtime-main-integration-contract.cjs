'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const runtime = read('src/proxy-runtime.cjs');

assert.match(main, /const \{ createProxyRuntime \} = require\('\.\/proxy-runtime\.cjs'\)/, 'main must compose the proxy runtime owner');
assert.match(main, /const proxyRuntime = createProxyRuntime\(\{/, 'main must create exactly one proxy runtime');
assert.doesNotMatch(main, /function proxyRulesFor\s*\(/, 'proxy rule compilation belongs to proxy-runtime');
assert.doesNotMatch(main, /encodeURIComponent\(login\)[\s\S]{0,120}encodeURIComponent\(password\)/, 'main must never embed proxy credentials in proxyRules');

assert.match(runtime, /app\.on\('login', authHandler\)/, 'proxy auth must use Electron login challenges');
assert.match(runtime, /authInfo\.isProxy !== true/, 'normal website Basic Auth must never receive proxy credentials');
assert.match(runtime, /responseDetails\?\.firstAuthAttempt === false/, 'repeated failed proxy challenges must not replay credentials');
assert.match(runtime, /accountState\.findByPartition\(partition\)/, 'proxy credentials must resolve through authoritative account partition ownership');
assert.match(runtime, /canonicalHost\(authInfo\.host\) !== descriptor\.canonicalHost/, 'proxy auth host must match exactly');
assert.match(runtime, /Number\(authInfo\.port\) !== descriptor\.port/, 'proxy auth port must match exactly');
assert.match(runtime, /await ses\.clearAuthCache\(\)/, 'same-endpoint credential rotation must invalidate the Session HTTP auth cache');
assert.match(runtime, /await ses\.closeAllConnections\(\)/, 'live proxy changes must close pooled connections after setProxy');

function bodyBetween(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `must locate ${startMarker}`);
  return main.slice(start, end);
}

const startup = bodyBetween('app.whenReady().then(async () => {', "\n\napp.on('window-all-closed'");
const accountLoad = startup.indexOf('await accountState.load()');
const configLoad = startup.indexOf('await configStore.load()');
const authInstall = startup.indexOf('proxyRuntime.installAuthenticationHandler()');
const proxyApply = startup.indexOf('await proxyRuntime.applyAccounts(accountState.getSnapshot().accounts, configStore.getSnapshot())');
const ipcInstall = startup.indexOf('registerIpcHandlers()');
const subscriptionGate = startup.indexOf('await enforceSubscriptionGate()');
assert.ok(accountLoad >= 0 && configLoad > accountLoad, 'startup must load Account State then Config State before proxy composition');
assert.ok(authInstall > configLoad, 'proxy auth must bind only after both authoritative stores load');
assert.ok(proxyApply > authInstall, 'existing account sessions must be pre-applied after auth binding');
assert.ok(ipcInstall > proxyApply, 'IPC must not expose account creation before startup proxy readiness is established');
assert.ok(subscriptionGate > ipcInstall, 'main account UI must not open before startup proxy readiness');

const addBody = bodyBetween('async function addAccount(', '\n\nasync function switchAccount');
const addCommit = addBody.indexOf('await accountState.add(payload)');
const addProxy = addBody.indexOf('await proxyRuntime.applyAccount(account, configStore.getSnapshot())');
const addNotify = addBody.indexOf('notifyAccountsChanged(result.snapshot)');
assert.ok(addCommit >= 0 && addProxy > addCommit && addNotify > addProxy, 'new accounts must pre-apply their Session proxy before renderer notification/return');

const updateBody = bodyBetween('async function updateAccount(', '\n\nasync function moveAccount');
const updateCommit = updateBody.indexOf('await accountState.update(accountId, patchData)');
const updateProxy = updateBody.indexOf('await proxyRuntime.applyAccount(account, configStore.getSnapshot())');
const updateNotify = updateBody.indexOf('notifyAccountsChanged(result.snapshot)');
assert.ok(updateCommit >= 0 && updateProxy > updateCommit && updateNotify > updateProxy, 'account proxy changes must remain post-durable-commit and pre-notify');

const removeBody = bodyBetween('async function removeAccount(', '\n\nlet accountIpcBoundary');
const removeCommit = removeBody.indexOf('await accountState.remove(accountId)');
const forgetProxy = removeBody.indexOf('proxyRuntime.forgetPartition(removedAccount.partition)');
assert.ok(removeCommit >= 0 && forgetProxy > removeCommit, 'proxy readiness must be forgotten only after durable account removal');

const configInstall = main.match(/configIpcBoundary = installConfigIpc\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';
const configCommitted = configInstall.indexOf('onCommitted: async');
const configProxy = configInstall.indexOf('await proxyRuntime.applyAccounts(snapshot.accounts, config)');
const configNotify = configInstall.indexOf('notifyAccountsChanged(snapshot)');
assert.ok(configCommitted >= 0 && configProxy > configCommitted && configNotify > configProxy, 'global proxy application must remain a post-commit Config side effect');

const attachBody = bodyBetween("window.webContents.on('will-attach-webview'", "\n\n  window.webContents.on('did-attach-webview'");
assert.match(attachBody, /proxyRuntime\.isReadyForAccount\(account, globalConfig\)/, 'WebView attachment must require exact current proxy readiness');
assert.match(attachBody, /webview-proxy-not-ready[\s\S]*event\.preventDefault\(\)/, 'unready account partitions must fail closed before navigation');
assert.doesNotMatch(attachBody, /setProxy\(/, 'will-attach-webview must never start asynchronous proxy mutation');
assert.doesNotMatch(attachBody, /proxyRuntime\.apply/, 'will-attach-webview must consume readiness, not race proxy application');

console.log('PROXY_RUNTIME_MAIN_INTEGRATION_CONTRACT_OK');
