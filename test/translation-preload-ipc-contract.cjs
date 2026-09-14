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
      && /额度已用完/.test(error.message),
    'preload must reconstruct typed main-process translation errors instead of losing metadata through Electron invoke',
  );

  translationResponse = { text: 'legacy-direct-result' };
  const legacy = await exposedApi.translation.translate({ text: 'legacy', target: 'it' });
  assert.equal(legacy.text, 'legacy-direct-result', 'preload must tolerate old-main direct result during a mixed restart boundary');

  console.log('TRANSLATION_PRELOAD_IPC_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
