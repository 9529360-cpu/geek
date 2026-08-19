'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const index = read('ui/index.html');
const profile = read('ui/profile-center.js');
const css = read('ui/profile-center.css');
const subscription = read('ui/subscription.html');
const preload = read('src/preload.cjs');
const main = read('src/main.cjs');
const pkg = JSON.parse(read('package.json'));
const marker = read('.github/release-client-version').trim();

assert.match(index, /profile-center\.css/, '主窗口必须加载个人中心样式');
assert.match(index, /profile-center\.js/, '主窗口必须加载个人中心模块');
assert.match(profile, /profile-center-entry/, '左侧栏必须有个人中心入口');
assert.match(profile, /字符余量/, '个人中心入口与面板必须保留字符余量展示');
assert.match(profile, /entryTitle\.textContent = '个人中心'/, '侧栏应保持稳定的个人中心标题而不是常驻暴露邮箱');
assert.match(profile, /remainingValue == null \|\| remainingValue === '' \? NaN : Number\(remainingValue\)/,
  '缺失的字符余量不得被 Number(null) 误判为 0');
assert.match(profile, /subscription\.getState\(\)/, '个人中心必须读取当前账号状态');
assert.match(profile, /subscription\.getQuota\(force === true\)/, '个人中心刷新必须复用现有 quota API');
assert.match(profile, /subscription\.openPlans\(\)/, '购买按钮必须复用现有套餐窗口');
assert.match(profile, /subscription\.logout\(\)/, '个人中心必须保留退出登录能力');
assert.match(profile, /window\.relaunch\(\)/, '退出登录后必须回到登录门禁流程');
assert.match(css, /side-nav\.collapsed \.profile-entry-copy/, '折叠侧栏必须保持个人中心入口可访问');
assert.doesNotMatch(subscription, /id=\"view-home\"/, '登录后不应再存在余额购买中间首页');
assert.match(subscription, /finishAuthentication/, '登录与注册成功必须统一进入工作区');
assert.match(subscription, /requestedView === 'plans'/, '套餐窗口必须支持个人中心直达');
assert.match(subscription, /await window\.api\.subscription\.enterApp\(\)/, '普通登录成功必须直接进入主窗口');
assert.match(preload, /openPlans: \(\) => invokeSubscription\('subscription:open-plans'\)/, 'preload 必须只暴露受控套餐入口');
assert.match(main, /function createSubscriptionWindow\(initialView = ''\)/, '订阅窗口必须支持受控初始视图');
assert.match(main, /query: \{ view: initialView \}/, '套餐直达必须通过本地 file query 传递');
assert.match(main, /ipcMain\.handle\('subscription:open-plans'/, '主进程必须注册套餐窗口 IPC');
assert.match(main, /createSubscriptionWindow\(state\.loggedIn \? 'plans' : ''\)/, '未登录时套餐入口必须回退到登录窗口');
assert.equal(pkg.version, '1.2.12', '普通 UX 维护不得修改客户端版本');
assert.equal(marker, '1.2.12', '普通 UX 维护不得触发客户端发布');

console.log('PROFILE_CENTER_UX_CONTRACT_OK');
