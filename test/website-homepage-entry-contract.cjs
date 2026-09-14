'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entry = fs.readFileSync(path.join(__dirname, '../scripts/geek-website-entry.js'), 'utf8');

// WEB-HOME-01: the marketing homepage is owned by the isolated website entry layer.
assert.match(entry, /const HOME_PATH = '\/';/, '官网入口必须显式拥有根路径');
assert.match(entry, /request\.method === 'GET' && url\.pathname === HOME_PATH/, 'GET / 必须由新版首页接管');
assert.ok(
  entry.indexOf("url.pathname === HOME_PATH") < entry.indexOf('baseWorker.fetch(request, env, ctx)'),
  '首页必须在委托 legacy Worker 前返回，避免改动账户/支付/下载业务面',
);

// WEB-HOME-02: first screen must explain the real product, not generic SaaS claims.
for (const marker of [
  '海外会话工作台',
  '一个桌面，',
  'WhatsApp / Telegram / LINE',
  '多账号独立会话',
  '翻译与群发同一工作台',
  '产品界面示意',
]) {
  assert.ok(entry.includes(marker), `官网首页缺少核心产品表达: ${marker}`);
}

// WEB-HOME-03: the homepage must expose the current product pillars and conversion paths.
for (const id of ['product', 'translation', 'broadcast', 'security', 'start']) {
  assert.match(entry, new RegExp(`id="${id}"`), `官网首页必须包含 #${id} 区块`);
}
assert.match(entry, /href="\/download"/, '首页必须提供正式下载入口');
assert.match(entry, /href="\/login"/, '首页必须提供登录/注册入口');
assert.ok(entry.includes('不同账号可以同时工作'), '群发说明必须表达多账号并行语义');
assert.ok(entry.includes('同一账号一次只执行一个群发任务'), '群发说明必须表达同账号串行边界');

// WEB-HOME-04: the marketing surface stays dependency-light, keyboard-visible, and motion-safe.
assert.match(entry, /:focus-visible/, '官网首页必须有可见键盘焦点');
assert.match(entry, /prefers-reduced-motion/, '官网首页必须尊重减少动态效果偏好');
assert.match(entry, /class="skip-link"/, '官网首页必须提供 skip link');
assert.match(entry, /script-src 'none'/, '官网首页必须保持无脚本执行面');
assert.doesNotMatch(entry, /<(?:script|iframe)\b/i, '官网首页不得引入脚本或 iframe');
assert.doesNotMatch(entry, /(?:src|href)=["']https?:\/\//i, '官网首页不得加载第三方远程资源');

// WEB-HOME-05: reset-token URL hardening remains part of the entry boundary.
assert.match(entry, /const RESET_TOKEN_CAPTURE = \[/, '密码重置 token 捕获逻辑不得丢失');
assert.match(entry, /history\.replaceState\(null, '', location\.pathname\)/, '密码重置 token 必须继续从地址栏移除');
assert.match(entry, /export \{ hardenResetHtml, homeResponse \};/, 'reset hardening 必须继续可测试导出');

console.log('WEBSITE_HOMEPAGE_ENTRY_CONTRACT_OK');
