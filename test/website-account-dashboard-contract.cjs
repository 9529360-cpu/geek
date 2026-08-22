'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../scripts/geek-website-worker.js'), 'utf8');

// WEB-DASH-01: the authenticated account surface is a desktop console.
assert.match(worker, /<body class="\$\{active === 'account' \? 'account-page' : ''\}">/, '账户页必须有独立页面作用域');
assert.match(worker, /class="dashboard-shell"/, '账户页必须提供桌面控制台壳层');
assert.match(worker, /class="dashboard-sidebar"/, '桌面控制台必须提供固定侧边导航');
for (const id of ['overview', 'packages', 'orders', 'resources']) {
  assert.match(worker, new RegExp(`id="${id}"`), `控制台必须包含 ${id} 工作区`);
}

// WEB-DASH-02: overview and order operations surface meaningful account state.
for (const id of ['quota', 'account-state', 'latest-order-status', 'member-since', 'orders-list']) {
  assert.match(worker, new RegExp(`id="${id}"`), `控制台必须包含 ${id} 状态`);
}
assert.match(worker, /class="orders-table"/, '最近订单必须采用可扫描的桌面表格布局');
assert.match(worker, /row\.className = 'order-row'/, '订单数据必须渲染为表格行');
assert.match(worker, /box\.replaceChildren\(\.\.\.nodes\)/, '订单行必须继续使用安全 DOM 节点替换');

// WEB-DASH-03: phones receive an explicit desktop requirement, not a squeezed dashboard.
assert.match(worker, /id="desktop-required-title">请使用电脑访问用户后台/, '窄屏必须显示电脑访问提示');
assert.match(worker, /@media \(max-width: 960px\)[\s\S]*?\.account-page \.dashboard-shell \{ display: none; \}/, '窄屏必须完全隐藏后台控制台');
assert.match(worker, /@media \(max-width: 960px\)[\s\S]*?\.account-page \.desktop-required \{ display: flex; \}/, '窄屏必须显示专用提示层');

// Payment destinations and exact amounts must remain server-provided.
assert.match(worker, /encodeURIComponent\(pay\.usdt_address\)/, '付款二维码必须使用服务端地址');
assert.match(worker, /copyValue\(pay\.usdt_amount_display, '精确金额'/, '复制金额必须使用服务端精确金额');
assert.match(worker, /copyValue\(pay\.usdt_address, '收款地址'/, '复制地址必须使用服务端地址');

console.log('WEBSITE_ACCOUNT_DASHBOARD_CONTRACT_OK');
