'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
const subscriptionUi = fs.readFileSync(path.join(root, 'ui', 'subscription.html'), 'utf8');

assert.match(preload, /function normalizeSubscriptionIpcError\(error\)/,
  'preload 必须归一化 subscription IPC 错误');
assert.match(preload, /message\.includes\(code\)/,
  '归一化必须从 Electron 包装后的错误消息中提取后端错误码');
assert.match(preload, /'invalid_credentials'[\s\S]*?'email_exists'[\s\S]*?'password_length_invalid'/,
  '登录和注册常见错误码必须保留');
assert.match(preload, /function invokeSubscription\(channel, \.\.\.args\)/,
  'subscription 调用必须经过统一 invoke 包装');
assert.match(preload, /login: \(email, password\) => invokeSubscription\('subscription:login'/,
  '登录必须使用统一错误归一化');
assert.match(preload, /register: \(email, password\) => invokeSubscription\('subscription:register'/,
  '注册必须使用统一错误归一化');
assert.match(subscriptionUi, /e\.message === 'invalid_credentials'/,
  '登录页应继续消费归一化后的 invalid_credentials');
assert.match(subscriptionUi, /e\.message === 'email_exists'/,
  '注册页应继续消费归一化后的 email_exists');

console.log('SUBSCRIPTION_IPC_ERROR_CONTRACT_OK');
