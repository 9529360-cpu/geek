'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/whatsapp-direct-composer-controller.js');
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const controller = require(controllerPath);
const PREFIX = '__GEEK_TRANSLATION_ERROR_V1__:';

function envelopedError(detail) {
  return new Error(PREFIX + JSON.stringify({ message: 'safe diagnostic', retryable: false, ...detail }));
}
function wrappedEnvelopedError(detail) {
  return new Error(`Error invoking remote method 'translation:translate': Error: ${PREFIX}${JSON.stringify({ message: 'safe diagnostic', retryable: false, ...detail })}`);
}

assert.equal(controller.CONTROLLER_VERSION, 6, 'thin native-send adapter identity hardening must force a fresh guest generation');
assert.equal(controller.TRANSLATION_ERROR_ENVELOPE_PREFIX, PREFIX);

const cases = [
  [{ code: 'QUOTA_EXHAUSTED', category: 'quota', status: 402 }, /额度已用完.*原文未发送/],
  [{ code: 'SUBSCRIPTION_LOGIN_REQUIRED', category: 'auth', status: 401 }, /需要重新登录.*原文未发送/],
  [{ code: 'SUBSCRIPTION_SESSION_CHANGED', category: 'auth', status: 401 }, /授权状态已变化.*原文未发送/],
  [{ code: 'TRANSLATION_DEADLINE_EXCEEDED', category: 'deadline', status: 504 }, /响应超时.*原文未发送/],
  [{ code: 'TRANSLATION_QUALITY_REJECTED', category: 'quality', status: 422 }, /质量校验.*原文未发送/],
  [{ code: 'TRANSLATION_RATE_LIMITED', category: 'rate-limit', status: 429 }, /请求繁忙.*原文未发送/],
  [{ code: 'TRANSLATION_GATEWAY_RETRYABLE', category: 'gateway', status: 503 }, /服务暂时不可用.*原文未发送/],
  [{ code: 'TRANSLATION_TARGET_INVALID', category: 'input', status: 400 }, /目标语言配置无效.*原文未发送/],
  [{ code: 'invalid_route', category: 'input', status: 400 }, /请求参数无效.*invalid_route.*原文未发送/],
  [{ code: 'TRANSLATION_ACCOUNT_MISSING', category: 'account' }, /账号状态异常.*原文未发送/],
  [{ code: 'TRANSLATION_REQUEST_CONFLICT', category: 'conflict', status: 409 }, /状态冲突.*原文未发送/],
];

for (const [detail, expected] of cases) {
  const parsed = controller.parseTranslationFailure(envelopedError(detail));
  assert.equal(parsed.code, detail.code);
  assert.equal(parsed.category, detail.category);
  if (detail.status) assert.equal(parsed.status, detail.status);
  assert.equal(parsed.message, 'safe diagnostic');
  assert.match(controller.translationFailureNotice(parsed, false), expected);
}

{
  const wrapped = controller.parseTranslationFailure(wrappedEnvelopedError({ code: 'SUBSCRIPTION_LOGIN_REQUIRED', category: 'auth', status: 401 }));
  assert.equal(wrapped.code, 'SUBSCRIPTION_LOGIN_REQUIRED');
  assert.match(controller.translationFailureNotice(wrapped, false), /需要重新登录.*原文未发送/);
}
{
  const timeout = controller.parseTranslationFailure(new Error('翻译请求超时'));
  assert.equal(timeout.code, 'TRANSLATION_DEADLINE_EXCEEDED');
  assert.equal(timeout.category, 'deadline');
  assert.equal(timeout.status, 504);
}
for (const message of ['翻译请求令牌不匹配', '翻译账号沙箱不存在']) {
  const bridge = controller.parseTranslationFailure(new Error(message));
  assert.match(bridge.code, /^TRANSLATION_BRIDGE_/);
  assert.equal(bridge.category, 'bridge');
  assert.match(controller.translationFailureNotice(bridge, false), /翻译连接状态异常.*原文未发送/);
}
{
  const legacy = new Error('plain legacy failure');
  assert.equal(controller.parseTranslationFailure(legacy), legacy);
  assert.equal(controller.translationFailureNotice(legacy, false), '翻译失败（未分类），原文未发送');
}

assert.match(controllerSource, /rawMessage\.indexOf\(prefix\)/, 'Electron-wrapped envelopes must remain recoverable');
assert.match(controllerSource, /lastCode:\s*''[\s\S]*lastCategory:\s*''[\s\S]*lastStatus:\s*0/, 'bounded diagnostics must retain typed failure class');
assert.match(controllerSource, /TRANSLATION_EMPTY_RESULT/, 'empty translations must fail closed');
assert.doesNotMatch(controllerSource, /diagnostics\.chatId|diagnostics\.text|diagnostics\.token|diagnostics\.authorization/i, 'diagnostics must not retain chat/message/auth secrets');

console.log('WHATSAPP_DIRECT_COMPOSER_ACTIONABLE_ERRORS_CONTRACT_OK');