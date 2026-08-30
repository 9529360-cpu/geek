'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'ui', 'settings-controller.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

// Context-menu ownership stays in app.js and every action is bound to the right-clicked account id.
assert.match(app, /function refreshAccountInstance\(accountId\)/, '必须有唯一的目标实例刷新 handler');
const refreshBody = app.match(/function refreshAccountInstance\(accountId\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
assert.match(refreshBody, /wvMap\.get\(accountId\)/, '刷新必须按传入 accountId 查找 WebView');
assert.doesNotMatch(refreshBody, /activeId/, '刷新不得依赖当前选中账号');
assert.match(app, /ctxMenu\.dataset\.accountId = account\.id/, '右键菜单必须绑定被右击实例 ID');
assert.match(app, /data-act=\"edit\">账号设置</, '实例编辑入口应明确为账号设置');
assert.match(app, /settingsController\.openAccount\(accountId/, '右键账号设置必须以固定 accountId 打开 canonical handler');
assert.match(app, /settingsController\.openAccount\(accountId,\s*\{\s*focus:\s*['\"]proxy['\"]\s*\}\)/, '代理菜单必须复用同一个固定实例账号设置 handler');

assert.doesNotMatch(html, /id=\"proxy-overlay\"/, '旧独立代理弹窗必须移除，避免第二套代理状态');
assert.doesNotMatch(app, /showProxyDialog|proxyAccountId/, 'renderer 不得保留第二套代理保存 handler');

// Ordinary Settings remains global/account-center only; instance editing is entered from the account context menu.
assert.match(html, /data-settings-tab=\"account-center\"/, '设置页必须提供极客个人中心');
assert.match(html, /data-settings-tab=\"global\"/, '设置页必须保留全局应用设置');
assert.doesNotMatch(html, /<select id=\"acc-select\"/, '实例设置不应再通过自由账号选择器改变 target');
assert.match(html, /id=\"acc-protocal\"/, '实例代理表单必须包含协议字段');
assert.match(settings, /async function openAccount\(accountId,\s*options = \{\}\)/, 'controller 必须提供固定实例入口');
assert.match(settings, /lockedAccountId/, '实例设置必须保存固定 target，而不是依赖 active account');
assert.match(settings, /protocal:\s*value\('acc-protocal'/, '实例代理协议必须走 canonical account patch');

assert.match(settings, /if \(!lockedAccountId\)[\s\S]{0,500}globalProxyError[\s\S]{0,500}return \{ ok: true \}/, '普通设置只校验全局字段');
assert.match(settings, /const accountId = currentAccountId\(\);[\s\S]{0,500}账号显示名不能为空/, '实例设置必须只校验固定 target 字段');

// Personal center must use real subscription state/refresh and expose an explicit unknown/error state.
assert.match(html, /id=\"geek-account-email\"/, '个人中心必须显示真实邮箱字段');
assert.match(html, /id=\"geek-account-quota\"/, '个人中心必须显示字符余额字段');
assert.match(html, /id=\"geek-account-status\"/, '个人中心必须有真实加载状态');
assert.match(app, /async function loadGeekAccountCenter\(\)/, '必须有个人中心真实数据加载函数');
assert.match(app, /window\.api\.subscription\.getState\(\)/, '个人中心必须复用 subscription state');
assert.match(app, /window\.api\.subscription\.refresh\(\)/, '个人中心必须主动刷新真实账户状态');
assert.match(app, /networkError/, '个人中心必须识别网络失败');
assert.doesNotMatch(app, /MAX_SAFE_INTEGER/, '个人中心不得把 fail-open 哨兵当余额显示');

// Account proxy update must support round-tripping every supported protocol and immediately fall back to global proxy.
assert.match(main, /raw\.protocal === 'http'/, 'accounts:update 必须允许协议切回 HTTP');
assert.match(main, /account\.openProxy\s*\?\s*account\s*:\s*\(configState\.openProxy\s*\?\s*configState\s*:\s*null\)/,
  '关闭独立代理后必须立即回落到全局代理或直连');

// Existing safety boundaries must remain in place.
assert.match(main, /hpwd:\s*account\.hpwd\s*\?\s*safeEncrypt\(account\.hpwd\)/, '账号代理密码必须继续加密落盘');
assert.match(main, /partitionFor\(id\)/, '账号 partition 生成规则不得改变');
assert.match(app, /window\.api\.accounts\.remove\(id\)/, '删除账号必须继续复用现有安全删除 IPC');
assert.doesNotMatch(app + main, /console\.(?:log|error|warn)\([^\n]*(?:hpwd|Authorization|subscription\.json)/i,
  '新增实现不得记录代理密码、Authorization 或订阅状态文件内容');

console.log('ACCOUNT_CONTEXT_PHASE2_CONTRACT_OK');
