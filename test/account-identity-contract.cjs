'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatAccountReference } = require('../src/account-reference.cjs');

assert.equal(formatAccountReference(1), 'GK-000001');
assert.equal(formatAccountReference(42), 'GK-000042');
assert.equal(formatAccountReference(1234567), 'GK-1234567');
assert.equal(formatAccountReference(0), '');
assert.equal(formatAccountReference('bad'), '');

const subscription = fs.readFileSync(path.join(__dirname, '../src/subscription.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../ui/subscription.html'), 'utf8');

assert.match(subscription, /user_id:\s*identity\.user_id/, '本地状态必须暴露 user_id');
assert.match(subscription, /account_ref:\s*state\.account_ref \|\| identity\.account_ref/, '本地状态必须暴露稳定账号号');
assert.match(subscription, /request\('\/api\/me'\)/, '旧登录态必须能从服务端回填账号身份');
assert.match(ui, /let currentPlan = 'basic'/, '默认选中的套餐和提交套餐必须一致');
assert.match(ui, /pass\.length < 10 \|\| pass\.length > 128/, '客户端密码规则必须与服务端 10–128 位一致');
assert.match(ui, /id="home-account-ref"/, '个人中心必须显示客服账号号');
assert.doesNotMatch(ui, /密码（至少 6 位）/, '不得再展示过期的 6 位密码规则');

console.log('ACCOUNT_IDENTITY_CONTRACT_OK');
