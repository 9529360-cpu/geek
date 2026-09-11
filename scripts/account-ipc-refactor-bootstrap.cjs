'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, value) => fs.writeFileSync(path.join(root, file), value);

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`missing ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`duplicate ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

let main = read('src/main.cjs');
main = replaceOnce(
  main,
  "const { installAccountDataBoundary } = require('./account-data-boundary.cjs');\n",
  "const { installAccountDataBoundary } = require('./account-data-boundary.cjs');\nconst { installAccountIpc } = require('./account-ipc.cjs');\n",
  'account IPC import',
);

const accountFunctions = `let accountIpcBoundary = null;\n\nasync function updateAccount(event, accountId, patchData) {\n  assertTrustedSender(event);\n  assertValidAccountId(accountId);\n\n  const account = accountsState.accounts.find((item) => item.id === accountId);\n  if (!account) {\n    throw new Error('账号不存在');\n  }\n\n  const raw = patchData && typeof patchData === 'object' ? patchData : {};\n\n  if (typeof raw.name === 'string') {\n    const name = sanitizeAccountName(raw.name, account.name);\n    if (name) {\n      account.name = name;\n    }\n  }\n  if (Number.isInteger(raw.fontSize) && raw.fontSize >= 10 && raw.fontSize <= 28) {\n    account.fontSize = raw.fontSize;\n  }\n  if (typeof raw.fontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.fontColor)) {\n    account.fontColor = raw.fontColor;\n  }\n  if (typeof raw.openProxy === 'boolean') {\n    account.openProxy = raw.openProxy;\n  }\n  if (raw.protocal === 'http' || raw.protocal === 'https' || raw.protocal === 'socks4' || raw.protocal === 'socks5') {\n    account.protocal = raw.protocal;\n  }\n  if (typeof raw.host === 'string') account.host = raw.host;\n  if (typeof raw.port === 'string') account.port = raw.port;\n  if (typeof raw.huser === 'string') account.huser = raw.huser;\n  if (typeof raw.hpwd === 'string') account.hpwd = raw.hpwd;\n\n  await persistAccounts();\n  await applyProxyForPartition(\n    account.partition,\n    account.openProxy ? account : (configState.openProxy ? configState : null)\n  );\n  notifyAccountsChanged();\n\n  return publicState();\n}\n\nasync function moveAccount(event, accountId, direction) {\n  assertTrustedSender(event);\n  assertValidAccountId(accountId);\n\n  const index = accountsState.accounts.findIndex((item) => item.id === accountId);\n  if (index === -1) {\n    throw new Error('账号不存在');\n  }\n  const target = direction === 'up' ? index - 1 : index + 1;\n  if (target < 0 || target >= accountsState.accounts.length) {\n    throw new Error('已经是边缘位置');\n  }\n\n  const [moved] = accountsState.accounts.splice(index, 1);\n  accountsState.accounts.splice(target, 0, moved);\n\n  await persistAccounts();\n  notifyAccountsChanged();\n\n  return publicState();\n}\n\nasync function moveAccountTo(event, accountId, targetIndex) {\n  assertTrustedSender(event);\n  assertValidAccountId(accountId);\n\n  const index = accountsState.accounts.findIndex((item) => item.id === accountId);\n  if (index === -1) {\n    throw new Error('账号不存在');\n  }\n  const insertAt = Math.max(0, Math.min(accountsState.accounts.length - 1, targetIndex | 0));\n  const [moved] = accountsState.accounts.splice(index, 1);\n  accountsState.accounts.splice(insertAt, 0, moved);\n\n  await persistAccounts();\n  notifyAccountsChanged();\n\n  return publicState();\n}\n\n`;
main = replaceOnce(main, 'function registerIpcHandlers() {\n', accountFunctions + 'function registerIpcHandlers() {\n', 'registerIpcHandlers seam');

main = replaceOnce(
  main,
  "  });\n  ipcMain.handle('translation:translate', translateViaRemoteGateway);\n",
  `  });\n  accountIpcBoundary = installAccountIpc({\n    ipcMain,\n    assertTrustedSender,\n    listAccounts: async () => publicState(),\n    addAccount,\n    removeAccount: (event, accountId) => accountDataBoundary.runAccountRemoval(event, accountId, removeAccount),\n    switchAccount,\n    updateAccount,\n    moveAccount,\n    moveAccountTo,\n  });\n  ipcMain.handle('translation:translate', translateViaRemoteGateway);\n`,
  'account IPC composition',
);

const accountRegistrationBlock = /\n  ipcMain\.handle\('accounts:list',[\s\S]*?\n  ipcMain\.handle\('config:get'/;
const registrationMatches = main.match(accountRegistrationBlock);
if (!registrationMatches) throw new Error('missing account registration block');
if ((main.match(/ipcMain\.handle\('accounts:list'/g) || []).length !== 1) throw new Error('unexpected accounts:list registration count');
main = main.replace(accountRegistrationBlock, "\n  ipcMain.handle('config:get'");

const quitBlock = `  isQuitting = true; // 允许窗口真正关闭（托盘"退出"路径）\n  ipcMain.removeHandler('accounts:list');\n  ipcMain.removeHandler('accounts:add');\n  ipcMain.removeHandler('accounts:remove');\n  ipcMain.removeHandler('accounts:switch');\n  ipcMain.removeHandler('accounts:update');\n  ipcMain.removeHandler('accounts:move');\n`;
main = replaceOnce(
  main,
  quitBlock,
  `  isQuitting = true; // 允许窗口真正关闭（托盘"退出"路径）\n  accountIpcBoundary?.dispose();\n  accountIpcBoundary = null;\n`,
  'account IPC quit teardown',
);
write('src/main.cjs', main);

let ownership = read('test/ipc-registration-ownership-contract.cjs');
ownership = replaceOnce(
  ownership,
  "const accountData = read('src/account-data-boundary.cjs');\n",
  "const accountData = read('src/account-data-boundary.cjs');\nconst accountIpc = read('src/account-ipc.cjs');\n",
  'ownership account IPC source',
);
ownership = replaceOnce(
  ownership,
  "assert.match(main, /accountDataBoundary\\.runAccountRemoval\\(event, accountId, removeAccount\\)/, 'accounts:remove must explicitly cross the account-data deletion lifecycle');\n",
  `for (const channel of ['accounts:list','accounts:add','accounts:remove','accounts:switch','accounts:update','accounts:move','accounts:move-to']) {\n  assert.ok(accountIpc.includes(\`'\${channel}'\`), \`Account IPC owner must declare \${channel}\`);\n  assert.equal(main.includes(\`ipcMain.handle('\${channel}'\`), false, \`main must not directly register Account channel \${channel}\`);\n}\nassert.match(accountIpc, /normalizeAccountAddPayload\\(payload\\)/, 'accounts:add must cross the ingress payload gate before mutation');\nassert.match(accountIpc, /assertTrustedSender\\(event\\)[\\s\\S]*normalizeAccountAddPayload/, 'sender validation must precede accounts:add payload processing');\nassert.match(accountIpc, /dispose\\(\\)[\\s\\S]*ipcMain\\.removeHandler/, 'Account IPC owner must own teardown');\nassert.match(main, /removeAccount:\\s*\\(event, accountId\\) => accountDataBoundary\\.runAccountRemoval\\(event, accountId, removeAccount\\)/, 'accounts:remove must explicitly cross the account-data deletion lifecycle');\n`,
  'ownership account removal assertion',
);
ownership = replaceOnce(
  ownership,
  "assert.match(main, /ACCOUNT_TYPE_UNSUPPORTED/, 'real accounts:add owner must reject unsupported account types');\n",
  "assert.match(main, /ACCOUNT_TYPE_UNSUPPORTED/, 'authoritative account mutation must reject unsupported account types');\n",
  'ownership account type assertion text',
);
write('test/ipc-registration-ownership-contract.cjs', ownership);

let website = read('test/website-account-lifecycle-security-contract.cjs');
website = replaceOnce(
  website,
  `const updateStart = main.indexOf("ipcMain.handle('accounts:update'");\nconst updateEnd = main.indexOf("ipcMain.handle('accounts:move'", updateStart);\n`,
  `const updateStart = main.indexOf('async function updateAccount');\nconst updateEnd = main.indexOf('async function moveAccount', updateStart);\n`,
  'website update seam assertion',
);
write('test/website-account-lifecycle-security-contract.cjs', website);

let e2e = read('e2e/specs/shell-smoke.e2e.cjs');
const malformedProbe = `\nasync function probeMalformedAccountPayloads() {\n  return browser.executeAsync((done) => {\n    (async () => {\n      const before = await window.api.accounts.list();\n      const results = [];\n      for (const payload of [null, []]) {\n        let message = '';\n        try {\n          await window.api.accounts.add(payload);\n        } catch (error) {\n          message = String(error?.message || error || '');\n        }\n        results.push({ rejected: message.includes('ACCOUNT_PAYLOAD_INVALID') });\n      }\n      const after = await window.api.accounts.list();\n      done({\n        rejected: results.every(item => item.rejected),\n        beforeIds: Array.isArray(before?.accounts) ? before.accounts.map(account => account.id) : [],\n        afterIds: Array.isArray(after?.accounts) ? after.accounts.map(account => account.id) : [],\n        beforeActive: String(before?.activeAccountId || ''),\n        afterActive: String(after?.activeAccountId || ''),\n      });\n    })().catch((error) => done({ rejected: false, probeError: String(error?.name || 'Error').slice(0, 80) }));\n  });\n}\n`;
e2e = replaceOnce(e2e, '\nasync function activationSnapshot(accountId) {\n', malformedProbe + '\nasync function activationSnapshot(accountId) {\n', 'malformed E2E probe');
e2e = replaceOnce(
  e2e,
  `    assert.equal(rejectedTypeProbe.afterActive, rejectedTypeProbe.beforeActive, 'rejected account type must not switch active account state');\n\n    const accounts = await $$('.nav-account');\n`,
  `    assert.equal(rejectedTypeProbe.afterActive, rejectedTypeProbe.beforeActive, 'rejected account type must not switch active account state');\n\n    const malformedPayloadProbe = await probeMalformedAccountPayloads();\n    console.log(\`E2E_ACCOUNT_PAYLOAD rejected=\${malformedPayloadProbe.rejected === true} stateUnchanged=\${JSON.stringify(malformedPayloadProbe.beforeIds) === JSON.stringify(malformedPayloadProbe.afterIds) && malformedPayloadProbe.beforeActive === malformedPayloadProbe.afterActive}\`);\n    assert.equal(malformedPayloadProbe.rejected, true, \`real accounts:add did not reject malformed payloads: \${malformedPayloadProbe.probeError || 'unknown'}\`);\n    assert.deepEqual(malformedPayloadProbe.afterIds, malformedPayloadProbe.beforeIds, 'malformed account payload must not create or remove account state');\n    assert.equal(malformedPayloadProbe.afterActive, malformedPayloadProbe.beforeActive, 'malformed account payload must not switch active account state');\n\n    const accounts = await $$('.nav-account');\n`,
  'malformed E2E assertions',
);
write('e2e/specs/shell-smoke.e2e.cjs', e2e);

for (const file of [
  'src/account-ipc.cjs',
  'src/main.cjs',
  'test/ipc-account-ingress-contract.cjs',
  'test/ipc-registration-ownership-contract.cjs',
  'test/website-account-lifecycle-security-contract.cjs',
  'e2e/specs/shell-smoke.e2e.cjs',
]) {
  require('node:child_process').execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}

if (/ipcMain\.handle\s*=/.test(read('src/main.cjs')) || /ipcMain\.handle\s*=/.test(read('src/account-ipc.cjs'))) {
  throw new Error('ipcMain.handle replacement detected');
}
for (const channel of Object.values(require('../src/account-ipc.cjs').ACCOUNT_IPC_CHANNELS)) {
  if (read('src/main.cjs').includes(`ipcMain.handle('${channel}'`)) throw new Error(`main still owns ${channel}`);
}

fs.rmSync(path.join(root, 'scripts/account-ipc-refactor-bootstrap.cjs'));
fs.rmSync(path.join(root, '.github/workflows/account-ipc-refactor-bootstrap.yml'));
