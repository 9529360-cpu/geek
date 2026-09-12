'use strict';

const fs = require('node:fs');

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(search, replacement);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = source.match(new RegExp(pattern.source, flags)) || [];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

let main = fs.readFileSync('src/main.cjs', 'utf8').replace(/\r\n?/g, '\n');
main = replaceOnce(main, "const crypto = require('node:crypto');\n", '', 'crypto import');
main = replaceOnce(main, "const { createGatewayPool } = require('./gateway-failover.cjs');\n", '', 'gateway import');
main = replaceOnce(main, "const { assertSafeTranslationOutput } = require('./translation-output-safety.cjs');\n", '', 'translation safety import');
main = replaceOnce(
  main,
  "const { installConfigIpc } = require('./config-ipc.cjs');\n",
  "const { installConfigIpc } = require('./config-ipc.cjs');\nconst { createTranslationRuntime } = require('./translation-runtime.cjs');\n",
  'translation runtime import'
);

main = replaceOnce(
  main,
  "  deletedTranslationPartitions.add(removedAccount.partition);\n  translationCaches.delete(removedAccount.partition);\n  translationCacheLoaded.delete(removedAccount.partition);\n  translationCacheWrites.delete(removedAccount.partition);\n  for (const key of translationLatestRequest.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationLatestRequest.delete(key);\n  for (const key of translationInflight.keys()) if (key.startsWith(`${removedAccount.partition}:`)) translationInflight.delete(key);\n",
  "  translationRuntime?.deleteAccount(removedAccount.partition);\n",
  'account removal translation cleanup'
);

main = replaceRegexOnce(
  main,
  /\nconst TRANSLATION_CACHE_VERSION = 'prompt-20260822-2';[\s\S]*?\nasync function translateViaRemoteGateway\(event, payload\) \{[\s\S]*?\n\}\n\nlet accountIpcBoundary = null;/,
  '\nlet accountIpcBoundary = null;',
  'translation runtime block'
);
main = replaceOnce(
  main,
  'let accountIpcBoundary = null;\nlet configIpcBoundary = null;\n',
  'let accountIpcBoundary = null;\nlet configIpcBoundary = null;\nlet translationRuntime = null;\n',
  'runtime boundary slot'
);

main = replaceOnce(
  main,
  "  ipcMain.handle('translation:translate', translateViaRemoteGateway);\n",
  "  translationRuntime = createTranslationRuntime({\n    ipcMain,\n    fs,\n    safeStorage,\n    getUserDataDir: () => app.getPath('userData'),\n    accountState,\n    createGatewayPool: require('./gateway-failover.cjs').createGatewayPool,\n    assertSafeTranslationOutput: require('./translation-output-safety.cjs').assertSafeTranslationOutput,\n    assertTrustedSender,\n    assertValidAccountId,\n    getSubscriptionStore: () => initSubscriptionStore(),\n  }).install();\n",
  'translation translate registration'
);
main = replaceOnce(main, "  ipcMain.handle('translation:health', checkTranslationGateway);\n", '', 'translation health registration');
main = main.replace(/resolveAccountPartition\(accountId\)/g, 'accountState.resolvePartition(accountId)');
main = replaceOnce(
  main,
  "  configIpcBoundary?.dispose();\n  configIpcBoundary = null;\n",
  "  configIpcBoundary?.dispose();\n  configIpcBoundary = null;\n  translationRuntime?.dispose();\n  translationRuntime = null;\n",
  'translation teardown'
);

for (const forbidden of [
  'TRANSLATION_CACHE_VERSION', 'translationCaches', 'translationCacheLoaded', 'deletedTranslationPartitions',
  'translationInflight', 'translationCacheWrites', 'translationLatestRequest', 'translationRemoteQueue',
  'translateViaRemoteGateway', 'checkTranslationGateway', "ipcMain.handle('translation:",
]) {
  if (main.includes(forbidden)) throw new Error(`main still owns translation runtime marker: ${forbidden}`);
}
fs.writeFileSync('src/main.cjs', main);

let gateway = fs.readFileSync('test/gateway-failover-integration-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
gateway = gateway.replace("const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');", "const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');\nconst runtime = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');");
gateway = gateway.replace(/assert\.match\(main,/g, 'assert.match(runtime,');
gateway = gateway.replace("assert.match(runtime, /require\\('\\.\\/gateway-failover\\.cjs'\\)/, '主进程必须加载端点池模块');", "assert.match(main, /createTranslationRuntime/, '主进程必须组合 Translation Runtime owner');");
gateway = gateway.replace("'主进程必须创建网关池'", "'Translation Runtime 必须创建网关池'");
gateway = gateway.replace(/translationRemoteQueue\|TRANSLATION_REMOTE_LIMIT = 20/, 'remoteQueue|TRANSLATION_REMOTE_LIMIT = 20');
gateway = gateway.replace(/translationInflight\|loadTranslationCache\|appendTranslationCache/, 'state\\.inflight|loadCache|appendCache');
fs.writeFileSync('test/gateway-failover-integration-contract.cjs', gateway);

let accountOwner = fs.readFileSync('test/account-state-production-ownership-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
accountOwner = replaceOnce(
  accountOwner,
  "const removeBody = functionBody('removeAccount', '\\n\\nconst TRANSLATION_CACHE_VERSION');",
  "const removeBody = functionBody('removeAccount', '\\n\\nlet accountIpcBoundary');",
  'remove body delimiter'
);
accountOwner = replaceOnce(
  accountOwner,
  "for (const effect of ['deletedTranslationPartitions.add', 'webContents.getAllWebContents', 'clearStorageData()', 'notifyAccountsChanged(result.snapshot)']) {",
  "for (const effect of ['translationRuntime?.deleteAccount', 'webContents.getAllWebContents', 'clearStorageData()', 'notifyAccountsChanged(result.snapshot)']) {",
  'remove body side effects'
);
fs.writeFileSync('test/account-state-production-ownership-contract.cjs', accountOwner);

console.log('FH04_INTEGRATION_OK');
