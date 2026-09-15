'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
let exposedApi = null;
let translationResponse = { ok: true, result: { text: 'ciao', requestId: 'send-intent-1' } };
const invocations = [];
const electron = {
  contextBridge: {
    exposeInMainWorld(name, value) {
      assert.equal(name, 'api');
      exposedApi = value;
    },
  },
  ipcRenderer: {
    async invoke(channel, payload) {
      invocations.push({ channel, payload });
      if (channel === 'translation:translate') return translationResponse;
      return null;
    },
    on() {},
  },
};

vm.runInNewContext(source, {
  require(specifier) {
    if (specifier === 'electron') return electron;
    throw new Error(`preload attempted unexpected dependency: ${specifier}`);
  },
  console,
  Object,
  String,
  Number,
  Set,
  Error,
  Promise,
}, { filename: 'preload.cjs' });

(async () => {
  assert.ok(exposedApi?.translation, 'preload must expose translation capability');

  const result = await exposedApi.translation.translate({ text: 'hello', target: 'it' });
  assert.equal(result.text, 'ciao');
  assert.equal(result.requestId, 'send-intent-1');
  assert.equal(invocations.at(-1).channel, 'translation:translate');

  translationResponse = {
    ok: false,
    error: {
      code: 'QUOTA_EXHAUSTED',
      message: '翻译额度已用完，请前往个人中心开通',
      category: 'quota',
      retryable: false,
      status: 402,
    },
  };
  await assert.rejects(
    () => exposedApi.translation.translate({ text: 'hello', target: 'it' }),
    error => error?.code === 'QUOTA_EXHAUSTED'
      && error?.category === 'quota'
      && error?.retryable === false
      && error?.status === 402
      && error?.userMessage === '翻译额度已用完，请前往个人中心开通'
      && error?.message.startsWith('__GEEK_TRANSLATION_ERROR_V1__:')
      && /额度已用完/.test(error.message),
    'preload must preserve typed error metadata and carry a privacy-safe WebView envelope in the message',
  );

  translationResponse = {
    ok: false,
    error: {
      code: 'SECURE_STORAGE_UNAVAILABLE',
      message: '登录状态安全存储暂不可用',
      retryable: false,
    },
  };
  await assert.rejects(
    () => exposedApi.translation.translate({ text: 'hello', target: 'it' }),
    error => error?.code === 'SECURE_STORAGE_UNAVAILABLE'
      && error?.category === 'auth'
      && error?.retryable === false
      && error?.userMessage === '登录状态安全存储暂不可用'
      && error?.message.startsWith('__GEEK_TRANSLATION_ERROR_V1__:')
      && /"category":"auth"/.test(error.message),
    'local credential recovery errors must stay in the auth domain instead of masquerading as gateway failures',
  );

  translationResponse = {
    ok: false,
    error: {
      code: 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED',
      message: '登录状态解密失败',
      category: 'gateway',
      retryable: false,
    },
  };
  await assert.rejects(
    () => exposedApi.translation.translate({ text: 'hello', target: 'it' }),
    error => error?.code === 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED'
      && error?.category === 'auth'
      && /"category":"auth"/.test(error.message),
    'known auth-recovery codes must override a generic/default gateway category',
  );

  translationResponse = { text: 'legacy-direct-result' };
  const legacy = await exposedApi.translation.translate({ text: 'legacy', target: 'it' });
  assert.equal(legacy.text, 'legacy-direct-result', 'preload must tolerate old-main direct result during a mixed restart boundary');

  console.log('TRANSLATION_PRELOAD_IPC_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});