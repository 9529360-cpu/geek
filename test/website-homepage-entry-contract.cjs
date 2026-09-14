'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entry = fs.readFileSync(path.join(__dirname, '../scripts/geek-website-entry.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../scripts/geek-marketing-router.js'), 'utf8');

// WEB-HOME-01: production owns / in the shared marketing router. The isolated entry keeps
// its previous homepage only as a compatibility fallback for direct callers and rollback.
assert.match(router, /marketingResponse\(url\.pathname, request\.method\)/, '生产官网必须先经过统一 marketing renderer');
assert.match(router, /if \(path !== '\/' && !MARKETING_ROUTES\.has\(path\)\) return null;/, '统一 renderer 必须显式拥有根路径');
assert.match(router, /url\.pathname === '\/index\.html'/, '/index.html 必须收口到 canonical 首页');
assert.doesNotMatch(router, /enhanceHomepageHtml/, '生产首页不得再依赖旧 HTML 的链接投影');
assert.match(entry, /const HOME_PATH = '\/';/, '兼容入口仍应保留可回退的根路径实现');
assert.match(entry, /request\.method === 'GET' && url\.pathname === HOME_PATH/, '兼容入口根路径不得意外损坏');

// WEB-HOME-02: shared production homepage must explain the real product and reuse the common shell.
for (const marker of [
  '海外会话工作台',
  '一个桌面，',
  'WhatsApp / Telegram / LINE',
  '多账号独立会话',
  '翻译与群发同一工作台',
  '账号就是工作现场',
]) {
  assert.ok(router.includes(marker), `统一官网首页缺少核心产品表达: ${marker}`);
}
assert.match(router, /stageProduct\(\)/, '首页必须复用产品工作台视觉组件');
assert.match(router, /stageSecurity\(\)/, '首页必须复用安全边界视觉组件');
assert.match(router, /href="\/download"/, '首页必须提供正式下载入口');
assert.match(router, /href="\/product"/, '首页必须进入统一产品信息架构');
assert.ok(router.includes('不同账号可以同时工作'), '群发说明必须表达多账号并行语义');
assert.ok(router.includes('同一账号一次只执行一个群发任务'), '群发说明必须表达同账号串行边界');

// WEB-HOME-03: account surfaces keep existing behavior but receive the current site theme.
for (const route of ['/login', '/forgot-password', '/reset-password', '/account']) {
  assert.ok(router.includes(`'${route}'`), `账户页面必须纳入统一主题投影: ${route}`);
}
assert.match(router, /data-geek-site-theme="unified-20260914"/, '账户页面必须带可验证的统一主题标记');
assert.match(router, /--accent:#25d366!important/, '账户页面强调色必须与新版官网一致');

// WEB-HOME-04: reset-token URL hardening remains part of the delegated entry boundary.
assert.match(entry, /const RESET_TOKEN_CAPTURE = \[/, '密码重置 token 捕获逻辑不得丢失');
assert.match(entry, /history\.replaceState\(null, '', location\.pathname\)/, '密码重置 token 必须继续从地址栏移除');
assert.match(entry, /export \{ hardenResetHtml, homeResponse \};/, 'reset hardening 必须继续可测试导出');

console.log('WEBSITE_HOMEPAGE_ENTRY_CONTRACT_OK');
