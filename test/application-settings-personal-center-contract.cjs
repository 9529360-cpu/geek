'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('ui/index.html', 'utf8');
const controller = fs.readFileSync('ui/settings-controller.js', 'utf8');
const app = fs.readFileSync('ui/app.js', 'utf8');

assert.match(html, /aria-label="应用设置"/);
assert.match(html, /<span>应用设置<\/span>/);
assert.match(html, /settings-personal-center/);
assert.match(html, /id="settings-account-email"/);
assert.match(html, /id="settings-account-quota"/);
assert.match(html, />个人中心</);
assert.match(html, />邮箱</);
assert.match(html, />剩余字符</);

assert.match(app, /getSubscriptionState:\s*\(\)\s*=>\s*window\.api\.subscription\.getState\(\)/);
assert.match(app, /refreshSubscription:\s*\(\)\s*=>\s*window\.api\.subscription\.refresh\(\)/);
assert.doesNotMatch(app, /subscription\.getQuota\(/, '应用设置个人中心不得使用 fail-open quota API');

assert.match(controller, /getSubscriptionState/);
assert.match(controller, /refreshSubscription/);
assert.match(controller, /settings-account-email/);
assert.match(controller, /settings-account-quota/);
assert.match(controller, /字符余额未知/);
assert.match(controller, /账户信息暂不可用/);
assert.match(controller, /void refreshPersonalCenter\(\)/, '应用设置打开后账户刷新必须异步进行，不能阻塞设置面板');
assert.doesNotMatch(controller, /await refreshPersonalCenter\(\)/, '网络账户刷新不得阻塞应用设置打开');
assert.doesNotMatch(controller, /MAX_SAFE_INTEGER|getQuota/, '应用设置个人中心不得复制 fail-open 余额逻辑');

console.log('APPLICATION_SETTINGS_PERSONAL_CENTER_CONTRACT_OK');
