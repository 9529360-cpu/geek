'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../scripts/geek-website-worker.js'), 'utf8');

// WEB-ONB-01: support navigation must target real, uniquely named sections.
for (const id of ['guide', 'faq']) {
  assert.match(worker, new RegExp(`<section class="section" id="${id}">`), `官网必须包含 #${id} 区块`);
  assert.match(worker, new RegExp(`href="/#${id}"`), `官网必须提供指向 #${id} 的导航`);
}
assert.doesNotMatch(worker, /<a href="\/#download">使用教程<\/a>/, '使用教程不能继续错误指向下载区');
assert.doesNotMatch(worker, /<a href="\/#pricing">常见问题<\/a>/, '常见问题不能继续错误指向定价区');

// WEB-ACC-01/03: account data and orders have explicit refresh/recovery affordances.
assert.match(worker, /id="member-since"/, '个人中心必须展示账户创建信息');
assert.match(worker, /id="refresh-account"/, '个人中心必须允许手动刷新账户数据');
assert.match(worker, /id="refresh-orders"/, '个人中心必须允许手动刷新订单');
assert.match(worker, /formatDate\(order\.created_at\)/, '订单列表必须格式化创建时间');
assert.match(worker, /Number\(order\.amount_cents\) \/ 100/, 'USDT 订单必须优先显示用于匹配链上付款的精确金额');
assert.match(worker, /box\.replaceChildren\(\.\.\.nodes\)/, '订单渲染必须继续使用安全 DOM 节点');

// WEB-ACC-02: payment copy actions use the current server response, not a second destination.
assert.match(worker, /id="copy-usdt-amount"/, 'USDT 精确金额必须可复制');
assert.match(worker, /id="copy-usdt-address"/, 'USDT 收款地址必须可复制');
assert.match(worker, /copyValue\(pay\.usdt_address, '收款地址'/, '复制地址必须来自当前 pay 响应');
assert.match(worker, /payment-qr\?address=' \+ encodeURIComponent\(pay\.usdt_address\)/, '二维码必须继续来自当前 pay 响应');

// WEB-A11Y-01 / WEB-OBS-01.
assert.match(worker, /:focus-visible/, '键盘焦点必须可见');
assert.match(worker, /prefers-reduced-motion/, '必须尊重减少动态效果偏好');
assert.match(worker, /<link rel="icon" href="\/favicon\.svg"/, '页面必须声明同源 favicon');
assert.match(worker, /path === '\/favicon\.svg'/, 'Worker 必须提供 favicon 路由');

// WEB-ONB-02: do not bypass the existing dynamic release download boundary.
assert.match(worker, /geek-setup-\$\{await latestVersion\(\)\}\.exe/, '下载必须继续使用动态已发布版本');

console.log('WEBSITE_ACCOUNT_SELF_SERVICE_CONTRACT_OK');
