const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'resources', 'extensions', 'line-3.5.1', 'static', 'js', 'main.js'),
  'utf8'
);

const initMethod = source.match(/async init\(\) \{[\s\S]*?\n          \}/)?.[0] || '';
assert.ok(initMethod, '必须找到 LINE token manager init 方法');
assert.match(initMethod, /localStorage\.getItem\('__stardust_line_token'\)/, 'LINE 初始化阶段必须从持久化 token 恢复认证状态');
assert.ok(
  initMethod.indexOf("localStorage.getItem('__stardust_line_token')") < initMethod.indexOf('ACCESS_TOKEN_NOT_EXISTS'),
  '持久化 token 恢复必须发生在 ACCESS_TOKEN_NOT_EXISTS 判断之前'
);

const method = source.match(/getAccessToken\(\) \{[\s\S]*?\n          \}/)?.[0] || '';
assert.ok(method, '必须找到 LINE getAccessToken 方法');
assert.match(method, /if \(e\) return e/, '内存 accessToken 为空字符串时必须继续读取持久化 token');
assert.match(method, /localStorage\.getItem\('__stardust_line_token'\)/, '必须保留 LINE token 持久化 fallback');
assert.doesNotMatch(method, /null !== \(e =/, '不得用会把空字符串视为有效 token 的 nullish fallback');

console.log('LINE_TOKEN_FALLBACK_CONTRACT_OK');
