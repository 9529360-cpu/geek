'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '../scripts/geek-subscription-worker-core.js'), 'utf8');

// OPS-01: the overview exposes actionable growth, revenue, and queue metrics.
for (const field of ['todayUsers', 'todayRevenueUsd', 'pendingValueUsd', 'disabledUsers', 'resetRequests']) {
  assert.match(worker, new RegExp(`${field}:`), `经营指标必须包含 ${field}`);
}
assert.match(worker, /经营驾驶舱/, '后台首页必须采用经营驾驶舱信息架构');
assert.match(worker, /id="pending-summary"/, '总览必须汇总待确认订单');
assert.match(worker, /id="reset-summary"/, '总览必须汇总密码重置待办');

// OPS-02/03/04: routine operations stay in contextual workspace UI.
assert.match(worker, /data-view="tasks"/, '侧边栏必须提供运营待办入口');
assert.match(worker, /id="resetsBody"/, '待办必须提供密码重置申请表格');
assert.match(worker, /id="userStatus"/, '用户表必须提供状态筛选');
assert.match(worker, /id="orderStatus"/, '订单表必须提供状态筛选');
assert.match(worker, /id="userDrawer"/, '用户详情必须使用上下文侧滑面板');
assert.doesNotMatch(worker, /alert\(detail\)/, '用户详情不得继续使用浏览器 alert');

// OPS-05: phones receive a desktop requirement, not a compressed admin console.
assert.match(worker, /请使用电脑访问经营后台/, '窄屏必须显示电脑访问提示');
assert.match(worker, /@media \(max-width: 960px\)[\s\S]*?#panelView[\s\S]*?display: none !important/, '窄屏必须隐藏经营后台主体');
assert.match(worker, /\.desktop-required \{ display: flex; \}/, '窄屏必须显示专用提示');

// OPS-06: preserve the existing authenticated and audited mutation boundary.
assert.match(worker, /const admin = await requireAdmin\(request, env\)/, '管理接口必须继续要求管理员会话');
assert.match(worker, /request\.method === 'POST' && !csrfAllowed\(request\)/, '管理写操作必须继续进行同源校验');
assert.doesNotMatch(worker, /localStorage\.(?:getItem|setItem)/, '管理员凭据不得进入 localStorage');
assert.match(worker, /confirm\('确认处理该密码重置申请/, '密码重置处理必须二次确认');

console.log('OPERATIONS_DASHBOARD_CONTRACT_OK');
