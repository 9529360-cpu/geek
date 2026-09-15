'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/whatsapp-direct-composer-controller.js');
const recoveryPath = path.join(__dirname, '../ui/whatsapp-translation-hook-recovery.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const controller = require(controllerPath);
const recovery = require(recoveryPath);

const PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';

function envelopedError(detail) {
  return new Error(PREFIX + JSON.stringify({
    message: 'safe diagnostic',
    retryable: false,
    ...detail,
  }));
}

const cases = [
  {
    detail: { code: 'QUOTA_EXHAUSTED', category: 'quota', status: 402 },
    expected: /额度已用完.*个人中心.*原文未发送/,
  },
  {
    detail: { code: 'SUBSCRIPTION_LOGIN_REQUIRED', category: 'auth', status: 401 },
    expected: /需要重新登录.*个人中心.*原文未发送/,
  },
  {
    detail: { code: 'SUBSCRIPTION_SESSION_CHANGED', category: 'auth', status: 401, retryable: true },
    expected: /授权状态已变化.*重新登录.*原文未发送/,
  },
  {
    detail: { code: 'TRANSLATION_DEADLINE_EXCEEDED', category: 'deadline', status: 504, retryable: true },
    expected: /响应超时.*稍后重试.*原文未发送/,
  },
  {
    detail: { code: 'TRANSLATION_QUALITY_REJECTED', category: 'quality', status: 422 },
    expected: /质量校验.*修改原文.*原文未发送/,
  },
  {
    detail: { code: 'TRANSLATION_RATE_LIMITED', category: 'rate-limit', status: 429, retryable: true },
    expected: /请求繁忙.*稍后重试.*原文未发送/,
  },
  {
    detail: { code: 'TRANSLATION_GATEWAY_RETRYABLE', category: 'gateway', status: 503, retryable: true },
    expected: /服务暂时不可用.*稍后重试.*原文未发送/,
  },
];

assert.equal(controller.CONTROLLER_VERSION, 2, 'actionable diagnostics must force a fresh direct-composer generation');
assert.equal(controller.TRANSLATION_ERROR_ENVELOPE_PREFIX, PREFIX);

for (const fixture of cases) {
  const direct = controller.parseTranslationFailure(envelopedError(fixture.detail));
  const legacy = recovery.parseTranslationFailure(envelopedError(fixture.detail));

  assert.equal(direct.code, fixture.detail.code);
  assert.equal(direct.category, fixture.detail.category);
  assert.equal(direct.status, fixture.detail.status);
  assert.equal(direct.retryable, fixture.detail.retryable === true);
  assert.equal(direct.message, 'safe diagnostic');

  const directNotice = controller.translationFailureNotice(direct, false);
  const recoveryNotice = recovery.translationFailureNotice(legacy, false);
  assert.match(directNotice, fixture.expected);
  assert.equal(directNotice, recoveryNotice, `direct composer failure semantics drifted for ${fixture.detail.code}`);
}

{
  const quota = controller.parseTranslationFailure(envelopedError({
    code: 'QUOTA_EXHAUSTED', category: 'quota', status: 402,
  }));
  assert.match(controller.translationFailureNotice(quota, true), /原文已恢复，请处理后重试/);
}

{
  const legacy = new Error('plain legacy failure');
  assert.equal(controller.parseTranslationFailure(legacy), legacy);
  assert.equal(controller.translationFailureNotice(legacy, false), '翻译失败，原文未发送');
}

{
  const malformed = new Error(PREFIX + '{bad-json');
  assert.equal(controller.parseTranslationFailure(malformed), malformed);
  assert.equal(controller.translationFailureNotice(malformed, false), '翻译失败，原文未发送');
}

assert.match(
  controllerSource,
  /function parseTranslationFailure\(error\)\s*\{[\s\S]*const prefix = '__GEEK_TRANSLATION_ERROR_V1__:'/,
  'page-injected error parser must be self-contained',
);
assert.match(
  controllerSource,
  /installPageController\.toString\(\)[\s\S]*parseTranslationFailure\.toString\(\)[\s\S]*translationFailureNotice\.toString\(\)/,
  'shell injection must carry the pure error parser and notice mapper into the WhatsApp guest',
);
assert.match(controllerSource, /lastCode:\s*''[\s\S]*lastCategory:\s*''[\s\S]*lastStatus:\s*0/, 'bounded direct-composer diagnostics must retain typed failure class');
assert.doesNotMatch(controllerSource, /diagnostics\.chatId|diagnostics\.text|diagnostics\.token|diagnostics\.authorization/i, 'diagnostics must not retain chat/message/auth secrets');

console.log('WHATSAPP_DIRECT_COMPOSER_ACTIONABLE_ERRORS_CONTRACT_OK');
