'use strict';
const assert = require('node:assert/strict');
const controller = require('../ui/whatsapp-direct-composer-controller.js');
const PREFIX='__GEEK_TRANSLATION_ERROR_V1__:';

function envelop(detail, wrapped=false) {
  const payload=PREFIX+JSON.stringify({message:'safe diagnostic',retryable:false,...detail});
  return new Error(wrapped ? "Error invoking remote method 'translation:translate': Error: "+payload : payload);
}

assert.equal(controller.CONTROLLER_VERSION, 9);
assert.equal(controller.TRANSLATION_ERROR_ENVELOPE_PREFIX, PREFIX);

for (const [detail, fragment] of [
  [{code:'QUOTA_EXHAUSTED',category:'quota',status:402}, /额度/],
  [{code:'SUBSCRIPTION_LOGIN_REQUIRED',category:'auth',status:401}, /登录/],
  [{code:'TRANSLATION_DEADLINE_EXCEEDED',category:'deadline',status:504}, /超时/],
  [{code:'TRANSLATION_QUALITY_REJECTED',category:'quality',status:422}, /质量/],
  [{code:'TRANSLATION_RATE_LIMITED',category:'rate-limit',status:429}, /繁忙|不可用/],
  [{code:'TRANSLATION_TARGET_INVALID',category:'input',status:400}, /目标语言/],
  [{code:'TRANSLATION_ACCOUNT_MISSING',category:'account'}, /账号/],
  [{code:'TRANSLATION_REQUEST_CONFLICT',category:'conflict',status:409}, /冲突/],
]) {
  const parsed=controller.parseTranslationFailure(envelop(detail));
  assert.equal(parsed.code,detail.code);
  assert.equal(parsed.category,detail.category);
  if(detail.status) assert.equal(parsed.status,detail.status);
  assert.match(controller.translationFailureNotice(parsed,false),fragment);
}

const wrapped=controller.parseTranslationFailure(envelop({code:'SUBSCRIPTION_LOGIN_REQUIRED',category:'auth',status:401},true));
assert.equal(wrapped.code,'SUBSCRIPTION_LOGIN_REQUIRED');
assert.match(controller.translationFailureNotice(wrapped,false),/登录/);

const timeout=controller.parseTranslationFailure(new Error('翻译请求超时'));
assert.equal(timeout.code,'TRANSLATION_DEADLINE_EXCEEDED');
assert.equal(timeout.status,504);

const legacy=new Error('plain legacy failure');
assert.equal(controller.parseTranslationFailure(legacy),legacy);
assert.match(controller.translationFailureNotice(legacy,false),/未发/);

console.log('WHATSAPP_DIRECT_COMPOSER_ACTIONABLE_ERRORS_CONTRACT_OK');
