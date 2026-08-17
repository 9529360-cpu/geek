'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'src/preload.cjs'), 'utf8');
const subscription = fs.readFileSync(path.join(root, 'src/subscription.cjs'), 'utf8');
const accountUi = fs.readFileSync(path.join(root, 'ui/subscription.html'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'scripts/geek-translate-worker.js'), 'utf8');

// Client-side usage reporting is obsolete: the translation gateway now reserves and
// finalizes quota server-side. Do not expose the stale single-argument IPC method to
// renderer JavaScript, where it could under-count or double-count usage.
assert.doesNotMatch(preload, /subscription:report-usage/, 'renderer preload 不得再暴露旧 usage-report IPC');
assert.doesNotMatch(preload, /reportUsage\s*:/, 'window.api.subscription 不得暴露旧 reportUsage 方法');
assert.doesNotMatch(accountUi + appUi, /subscription\.reportUsage\s*\(/, 'renderer 不得调用旧 reportUsage');

// The store method, retained for compatibility/internal use, has the new text-pair
// contract. The authoritative charging path is the authenticated gateway.
assert.match(subscription, /async function reportUsage\(sourceText, targetText\)/, '订阅存储层 usage 方法必须保持原文+译文契约');
assert.match(gateway, /async function reserveUsage\(/, '翻译网关必须在服务端预留额度');
assert.match(gateway, /async function finishUsage\(/, '翻译网关必须在服务端完成额度结算');
assert.match(gateway, /verifyTranslationJwt/, '额度结算网关必须验证翻译 JWT');

console.log('SUBSCRIPTION_IPC_CONTRACT_OK');
