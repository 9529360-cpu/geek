'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');

assert.match(preload, /function normalizeSubscriptionIpcError\(error\)/,
  'preload 必须归一化 subscription IPC 错误');
assert.match(preload, /message\.includes\(code\)/,
  '归一化必须从 Electron 包装后的错误消息中提取后端错误码');
assert.match(preload, /'invalid_credentials'[\s\S]*?'password_reset_required'[\s\S]*?'email_exists'/,
  '登录、旧密码重置和注册错误码必须保留');
assert.match(preload, /function invokeSubscription\(channel, \.\.\.args\)/,
  'subscription 调用必须经过统一 invoke 包装');
assert.match(preload, /login: \(email, password\) => invokeSubscription\('subscription:login'/,
  '登录必须使用统一错误归一化');
assert.match(preload, /register: \(email, password\) => invokeSubscription\('subscription:register'/,
  '注册必须使用统一错误归一化');
assert.doesNotMatch(preload, /console\.(?:log|error)\([^\n]*(?:password|Authorization|token)/i,
  'preload 不得记录认证凭据');

console.log('SUBSCRIPTION_IPC_ERROR_CONTRACT_OK');
