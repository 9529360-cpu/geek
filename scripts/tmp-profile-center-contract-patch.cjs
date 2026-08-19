'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'test', 'account-identity-contract.cjs');
let source = fs.readFileSync(file, 'utf8');

const beforeRead = "const subscription = fs.readFileSync(path.join(__dirname, '../src/subscription.cjs'), 'utf8');\nconst ui = fs.readFileSync(path.join(__dirname, '../ui/subscription.html'), 'utf8');";
const afterRead = "const subscription = fs.readFileSync(path.join(__dirname, '../src/subscription.cjs'), 'utf8');\nconst ui = fs.readFileSync(path.join(__dirname, '../ui/subscription.html'), 'utf8');\nconst profileCenter = fs.readFileSync(path.join(__dirname, '../ui/profile-center.js'), 'utf8');";
if (!source.includes(beforeRead)) throw new Error('Missing account identity read anchor');
source = source.replace(beforeRead, afterRead);

const beforeAssert = "assert.match(ui, /id=\"home-account-ref\"/, '个人中心必须显示客服账号号');";
const afterAssert = [
  "assert.match(profileCenter, /profile-center-account-ref/, '个人中心必须保留客服账号号展示位');",
  "assert.match(profileCenter, /quota\\?\\.account_ref \\|\\| state\\?\\.account_ref/, '个人中心必须优先使用稳定账号号来源');",
  "assert.match(profileCenter, /accountRef\\.textContent = accountNumber \\|\\| '暂不可用'/, '个人中心必须把账号号写入可见文本');"
].join('\n');
if (!source.includes(beforeAssert)) throw new Error('Missing legacy home account reference assertion');
source = source.replace(beforeAssert, afterAssert);

fs.writeFileSync(file, source, 'utf8');
console.log('ACCOUNT_IDENTITY_PROFILE_MIGRATION_OK');
