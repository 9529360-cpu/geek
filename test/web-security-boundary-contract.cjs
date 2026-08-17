'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'resources/bridge-preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const adapters = fs.readFileSync(path.join(root, 'ui/translation-adapters.js'), 'utf8');

assert.doesNotMatch(main, /registerSchemesAsPrivileged[\s\S]*scheme:\s*['"]https?['"]/, '不得把系统 HTTP(S) 注册成特权协议');
assert.doesNotMatch(main, /bypassCSP|service-worker-schemes/, '不得全局绕过网页 CSP 或重定义 HTTP(S) service worker 协议');
assert.match(preload, /event\.origin\s*!==\s*window\.location\.origin/, 'webview preload 必须校验消息来源 origin');
assert.doesNotMatch(app, /postMessage\([\s\S]{0,300},\s*['"]\*['"]\s*\)/, 'UI 注入脚本不得向任意 origin 发送桥消息');
assert.doesNotMatch(adapters, /postMessage\([\s\S]{0,300},\s*['"]\*['"]\s*\)/, '翻译适配器不得向任意 origin 发送桥消息');

console.log('WEB_SECURITY_BOUNDARY_CONTRACT_OK');
