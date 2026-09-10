'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const api = [
  fs.readFileSync(path.join(root, 'scripts/geek-subscription-entry.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker-core.js'), 'utf8'),
].join('\n');
const accountNumber = fs.readFileSync(path.join(root, 'scripts/account-number.mjs'), 'utf8');
const site = fs.readFileSync(path.join(root, 'scripts/geek-website-worker.js'), 'utf8');

assert.match(api, /HttpOnly; Secure; SameSite=Strict/, '登录会话必须使用安全 HttpOnly Cookie');
assert.match(api, /PASSWORD_ITERATIONS = 310000/, '新密码必须使用更强的 PBKDF2 参数');
assert.match(api, /password\.length < 10 \|\| password\.length > 128/, '注册密码必须限制为 10–128 位');
assert.match(api, /verification\.needsUpgrade/, '旧密码必须在成功登录后透明升级');
assert.doesNotMatch(api, /Access-Control-Allow-Origin': '\*'/, '账号 API 不得允许任意跨域读取');
assert.doesNotMatch(api, /Access-Control-Allow-Origin/, '同源代理上线后账号 API 不应再开放浏览器跨域读取');
assert.match(api, /csrfAllowed\(request\)/, 'Cookie 鉴权的写操作必须校验 Origin');
assert.match(api, /SELECT id, account_no, email, status, quota_chars, created_at FROM users WHERE id = \?/, '用户详情只能返回安全账号字段，不得返回密码哈希和盐');
assert.match(api, /WHERE account_no = \? OR email LIKE \?/, '管理后台账号号检索必须只允许完整精确匹配');
assert.match(api, /status = 'processing'[\s\S]{0,800}db\.batch/, '支付确认必须先原子认领订单再加余额');
assert.match(api, /status = 'pending', tx_id = NULL/, '自动确认失败后必须释放订单以便安全重试');
assert.match(accountNumber, /crypto\.getRandomValues\(new Uint8Array\(ACCOUNT_NO_RANDOM_BYTES\)\)/, '账号号必须由 Web Crypto 安全随机字节生成');
assert.match(accountNumber, /ACCOUNT_NO_PATTERN = \/\^GK-\[0-9a-f\]\{32\}\$\//, '账号号格式必须固定为 GK- 加 32 位小写十六进制');
assert.doesNotMatch(accountNumber, /Math\.random|Date\.now|userId|email/i, '账号号生成不得依赖顺序 ID、邮箱、时间或弱随机数');
assert.doesNotMatch(site, /localStorage\.(?:getItem|setItem)\(['"]geek_web_token/, '官网不得把用户 Token 存入 localStorage');
assert.doesNotMatch(api, /localStorage\.(?:getItem|setItem)\(TOKEN_KEY/, '运营后台不得把管理员 Token 存入 localStorage');
assert.match(site, /proxyApi\(request, path \+ url\.search\)/, '官网账号请求必须走同源代理');
assert.match(site, /me\.data\.user\?\.account_no/, '官网必须直接展示服务端返回的持久化账号号');
assert.match(site, /copyValue\(accountNo, '账号号', event\.currentTarget\)/, '官网必须复用复制能力复制账号号');
assert.match(site, /accountNoEl\.textContent = accountNo \|\| '暂不可用'/, '官网账号号不可用时必须安全降级');
assert.match(api, /password_reset_requests/, '服务端必须保存密码重置请求状态');
assert.match(api, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/, '重置 Token 必须使用 256 位安全随机数');
assert.match(api, /token_hash = \? AND status = 'issued' AND expires_at > datetime\('now'\)/, '重置 Token 必须校验哈希、状态和有效期');
assert.match(api, /token_version = token_version \+ 1/, '改密后必须撤销旧会话');
assert.match(api, /api\.resend\.com\/emails/, '必须通过邮件 API 自动发送重置链接');
assert.match(site, /href="\/forgot-password"/, '登录页必须提供忘记密码入口');
assert.match(site, /path === '\/reset-password'/, '官网必须提供设置新密码页面');

console.log('ACCOUNT_SECURITY_CONTRACT_OK');
