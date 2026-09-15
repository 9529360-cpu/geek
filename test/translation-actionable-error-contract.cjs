'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recovery = require('../ui/whatsapp-translation-hook-recovery.js');

const prefix = recovery.TRANSLATION_ERROR_ENVELOPE_PREFIX;
assert.equal(prefix, '__GEEK_TRANSLATION_ERROR_V1__:');

function envelope(detail) {
  return prefix + JSON.stringify(detail);
}

const quota = recovery.parseTranslationFailure(new Error(envelope({
  code: 'QUOTA_EXHAUSTED',
  message: '翻译额度已用完，请前往个人中心开通',
  category: 'quota',
  retryable: false,
  status: 402,
})));
assert.equal(quota.code, 'QUOTA_EXHAUSTED');
assert.equal(quota.category, 'quota');
assert.equal(quota.retryable, false);
assert.equal(quota.status, 402);
assert.equal(quota.message, '翻译额度已用完，请前往个人中心开通');
assert.match(recovery.translationFailureNotice(quota, false), /额度已用完.*个人中心.*原文未发送/);
assert.match(recovery.translationFailureNotice(quota, true), /额度已用完.*原文已恢复/);

const login = recovery.parseTranslationFailure(new Error(envelope({
  code: 'SUBSCRIPTION_LOGIN_REQUIRED',
  message: '请先登录',
  category: 'auth',
  retryable: false,
  status: 401,
})));
assert.match(recovery.translationFailureNotice(login, false), /重新登录.*个人中心.*原文未发送/);

const session = recovery.parseTranslationFailure(new Error(envelope({
  code: 'SUBSCRIPTION_SESSION_CHANGED',
  message: '登录状态已变化，请重试',
  category: 'auth',
  retryable: true,
})));
assert.match(recovery.translationFailureNotice(session, true), /授权状态已变化.*原文已恢复/);

const deadline = recovery.parseTranslationFailure(new Error(envelope({
  code: 'TRANSLATION_DEADLINE_EXCEEDED',
  message: '翻译请求超时，请重试',
  category: 'deadline',
  retryable: true,
  status: 504,
})));
assert.match(recovery.translationFailureNotice(deadline, false), /响应超时.*原文未发送/);

const quality = recovery.parseTranslationFailure(new Error(envelope({
  code: 'TRANSLATION_QUALITY_REJECTED',
  message: '翻译结果未通过安全校验',
  category: 'quality',
  retryable: false,
})));
assert.match(recovery.translationFailureNotice(quality, false), /质量校验.*修改原文.*原文未发送/);

const rateLimited = recovery.parseTranslationFailure(new Error(envelope({
  code: 'TRANSLATION_RATE_LIMITED',
  message: '翻译请求过于频繁，请稍后重试',
  category: 'rate-limit',
  retryable: true,
  status: 429,
})));
assert.match(recovery.translationFailureNotice(rateLimited, false), /繁忙.*原文未发送/);

const gateway = recovery.parseTranslationFailure(new Error(envelope({
  code: 'TRANSLATION_GATEWAY_RETRYABLE',
  message: 'translation_failed',
  category: 'gateway',
  retryable: true,
  status: 502,
})));
assert.match(recovery.translationFailureNotice(gateway, false), /服务暂时不可用.*原文未发送/);

const legacyPlain = recovery.parseTranslationFailure(new Error('QUOTA_EXHAUSTED'));
assert.equal(legacyPlain.code, undefined, 'legacy text must not be parsed as structured authority');
assert.equal(
  recovery.translationFailureNotice(legacyPlain, true),
  '翻译失败，原文已恢复，请重试',
  'unstructured legacy failures keep the compatibility fallback',
);

const malformed = recovery.parseTranslationFailure(new Error(prefix + '{not-json'));
assert.equal(malformed.code, undefined, 'malformed envelope must fail closed to generic UI');

const source = fs.readFileSync(path.resolve(__dirname, '../src/preload.cjs'), 'utf8');
assert.match(source, /TRANSLATION_ERROR_ENVELOPE_PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:'/);
assert.match(source, /translationErrorEnvelope\(\{ \.\.\.detail, message: humanMessage \}\)/);
assert.match(source, /error\.userMessage = humanMessage/);
assert.doesNotMatch(source, /Authorization|Bearer|api[_-]?key/i, 'preload error envelope must not add secret-bearing fields');

console.log('TRANSLATION_ACTIONABLE_ERROR_CONTRACT_OK');
