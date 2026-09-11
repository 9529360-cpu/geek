'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'e2e/specs/shell-smoke.e2e.cjs');
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `async function probeRejectedAccountType() {\n  return browser.executeAsync((done) => {\n    (async () => {\n      const before = await window.api.accounts.list();\n      let message = '';\n      try {\n        await window.api.accounts.add({ name: 'E2E invalid type', type: 'telegrm' });\n      } catch (error) {\n        message = String(error?.message || error || '');\n      }\n      const after = await window.api.accounts.list();\n      done({\n        rejected: message.includes('ACCOUNT_TYPE_UNSUPPORTED'),\n        beforeIds: Array.isArray(before?.accounts) ? before.accounts.map(account => account.id) : [],\n        afterIds: Array.isArray(after?.accounts) ? after.accounts.map(account => account.id) : [],\n        beforeActive: String(before?.activeAccountId || ''),\n        afterActive: String(after?.activeAccountId || ''),\n      });\n    })().catch((error) => done({ rejected: false, probeError: String(error?.name || 'Error').slice(0, 80) }));\n  });\n}\n`;
const newBlock = `async function probeRejectedAccountType() {\n  return browser.executeAsync((done) => {\n    (async () => {\n      const before = await window.api.accounts.list();\n      const results = [];\n      for (const type of ['telegrm', '', null, ' whatsapp']) {\n        let message = '';\n        try {\n          await window.api.accounts.add({ name: 'E2E invalid type', type });\n        } catch (error) {\n          message = String(error?.message || error || '');\n        }\n        results.push({ type: String(type), rejected: message.includes('ACCOUNT_TYPE_UNSUPPORTED') });\n      }\n      const after = await window.api.accounts.list();\n      done({\n        rejected: results.every(item => item.rejected),\n        rejectedCount: results.filter(item => item.rejected).length,\n        beforeIds: Array.isArray(before?.accounts) ? before.accounts.map(account => account.id) : [],\n        afterIds: Array.isArray(after?.accounts) ? after.accounts.map(account => account.id) : [],\n        beforeActive: String(before?.activeAccountId || ''),\n        afterActive: String(after?.activeAccountId || ''),\n      });\n    })().catch((error) => done({ rejected: false, probeError: String(error?.name || 'Error').slice(0, 80) }));\n  });\n}\n`;
const first = source.indexOf(oldBlock);
if (first < 0 || source.indexOf(oldBlock, first + oldBlock.length) >= 0) throw new Error('expected one rejected type probe block');
source = source.slice(0, first) + newBlock + source.slice(first + oldBlock.length);
source = source.replace(
  "console.log(`E2E_ACCOUNT_TYPE rejected=${rejectedTypeProbe.rejected === true} stateUnchanged=${JSON.stringify(rejectedTypeProbe.beforeIds) === JSON.stringify(rejectedTypeProbe.afterIds) && rejectedTypeProbe.beforeActive === rejectedTypeProbe.afterActive}`);",
  "console.log(`E2E_ACCOUNT_TYPE rejected=${rejectedTypeProbe.rejected === true} rejectedCount=${rejectedTypeProbe.rejectedCount || 0} stateUnchanged=${JSON.stringify(rejectedTypeProbe.beforeIds) === JSON.stringify(rejectedTypeProbe.afterIds) && rejectedTypeProbe.beforeActive === rejectedTypeProbe.afterActive}`);",
);
fs.writeFileSync(file, source);
require('node:child_process').execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
fs.rmSync(path.join(root, 'scripts/account-ipc-type-e2e-bootstrap.cjs'));
fs.rmSync(path.join(root, '.github/workflows/account-ipc-type-e2e-bootstrap.yml'));
