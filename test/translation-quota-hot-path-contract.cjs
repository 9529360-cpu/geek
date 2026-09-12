'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const runtimeSource = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');
assert.match(
  runtimeSource,
  /getSubscriptionStore\(\)\.getQuota\(\{\s*network:\s*false\s*\}\)/,
  '翻译热路径必须继续明确请求 quota 本地只读模式'
);

(async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-quota-hot-path-'));
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be used');
  };

  try {
    const store = createSubscriptionStore({ userDataDir });
    const quota = await store.getQuota({ network: false });
    assert.equal(fetchCalls, 0, 'getQuota({ network:false }) 不得访问 /api/quota');
    assert.equal(quota.remaining_chars, null, '本地无 quota 缓存时应返回未知额度并交给服务端兜底');
  } finally {
    global.fetch = originalFetch;
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }

  console.log('TRANSLATION_QUOTA_HOT_PATH_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
