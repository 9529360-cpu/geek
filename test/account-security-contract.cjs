'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker.js'), 'utf8');
const site = fs.readFileSync(path.join(root, 'scripts/geek-website-worker.js'), 'utf8');

assert.match(api, /HttpOnly; Secure; SameSite=Strict/, '登录会话必须使用安全 HttpOnly Cookie');
assert.match(api, /PASSWORD_ITERATIONS = 310000/, '新密码必须使用更强的 PBKDF2 参数');
assert.match(api, /password\.length < 10 \|\| password\.length > 128/, '注册密码必须限制为 10–128 位');
assert.match(api, /verification\.needsUpgrade/, '旧密码必须在成功登录后透明升级');
assert.doesNotMatch(api, /Access-Control-Allow-Origin': '\*'/, '账号 API 不得允许任意跨域读取');
assert.match(api, /csrfAllowed\(request\)/, 'Cookie 鉴权的写操作必须校验 Origin');
assert.match(api, /SELECT id, email, status, quota_chars, created_at FROM users WHERE id = \?/, '用户详情不得返回密码哈希和盐');
assert.match(api, /status = 'processing'[\s\S]{0,800}db\.batch/, '支付确认必须先原子认领订单再加余额');
assert.doesNotMatch(site, /localStorage\.(?:getItem|setItem)\(['"]geek_web_token/, '官网不得把用户 Token 存入 localStorage');
assert.doesNotMatch(api, /localStorage\.(?:getItem|setItem)\(TOKEN_KEY/, '运营后台不得把管理员 Token 存入 localStorage');
assert.match(site, /proxyApi\(request, path \+ url\.search\)/, '官网账号请求必须走同源代理');

console.log('ACCOUNT_SECURITY_CONTRACT_OK');
