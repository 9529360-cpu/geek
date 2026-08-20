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

// 桌面端当前仍创建 manual 订单；本轮只修正文案，不切换支付方式。
// 客服确认的是收款，字符余额由系统事务自动增加，不应描述为人工开通。
assert.doesNotMatch(ui, /付款后由客服手动开通/, '不得把字符余额更新描述为客服手动开通');
assert.doesNotMatch(ui, /客服确认收款后自动到账/, '不得混淆人工确认收款与系统自动增加字符');
assert.match(ui, /收款确认后字符余额自动更新/, '套餐提示必须说明确认收款后的自动余额更新');
assert.match(ui, /客服确认收款后，系统自动增加字符余额/, '桌面 manual 订单必须区分收款确认与自动加字符');
assert.match(ui, /字符余额已更新！剩余/, '成功状态必须描述字符余额更新结果');
assert.match(ui, /订单状态尚未更新，请稍后再试；如长时间未更新，请联系客服/, '待确认状态必须准确描述订单尚未更新');
assert.match(subscription, /request\('\/api\/orders', \{ method: 'POST', body: \{ plan \} \}\)/,
  '桌面文案修正不得改变当前 manual 订单请求契约');
assert.doesNotMatch(ui, /pay_method\s*:\s*['"]usdt['"]/, '文案 PR 不得暗中启用桌面 USDT 支付');

console.log('ACCOUNT_IDENTITY_CONTRACT_OK');
