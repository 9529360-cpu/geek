'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const runtimeOwnerSource = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');
const runtimeBaseSource = fs.readFileSync(path.join(__dirname, '../src/translation-runtime-base.cjs'), 'utf8');
const subscriptionSource = fs.readFileSync(path.join(__dirname, '../src/subscription.cjs'), 'utf8');
assert.match(runtimeOwnerSource, /translation-runtime-base\.cjs/, '公共 Translation Runtime 必须继续组合唯一 quota/gateway 事务层');
assert.match(
  runtimeBaseSource,
  /const subscriptionStore = getSubscriptionStore\(\);[\s\S]*subscriptionStore\.getQuota\(\{\s*authority:\s*true\s*\}\)/,
  '翻译热路径必须显式请求商业 authority quota，缓存命中也不得绕过授权'
);
assert.match(
  subscriptionSource,
  /const QUOTA_AUTHORITY_TTL_MS = 30 \* 1000[\s\S]*currentQuotaAuthority\(generation, now\)/,
  'Subscription authority 必须保留当前进程内的 30 秒权威 quota 缓存，避免每条翻译都访问远端 quota'
);
assert.match(
  subscriptionSource,
  /Persisted quota is a UI\/offline mirror, not a commercial entitlement[\s\S]*remaining_chars: null/,
  '持久化 quota 只能做 UI/offline mirror，网络无法验证时不得继续充当商业授权'
);
assert.match(
  runtimeBaseSource,
  /cacheAuthorized = body\.skipQuota === true \|\| \(Number\.isFinite\(quotaRemaining\) && quotaRemaining > 0\)/,
  '缓存命中必须要求当前已验证的正额度，未知 quota 只能回落到服务端 authority'
);
assert.match(
  runtimeBaseSource,
  /getRemoteAuthorizationLease\(subscriptionStore, deadlineAt\)/,
  '远程授权 lease 必须复用与 quota preflight 相同的 Subscription authority'
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

    global.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ remaining_chars: 100, email: 'quota@example.invalid' }),
      };
    };
    const verified = await store.getQuota({ authority: true });
    assert.equal(verified.remaining_chars, 100);
    assert.equal(fetchCalls, 1, '首次当前进程权威校验应请求一次 /api/quota');
    const reused = await store.getQuota({ authority: true });
    assert.equal(reused.remaining_chars, 100);
    assert.equal(fetchCalls, 1, '30 秒内当前进程权威 quota 应复用，不得每条翻译重复请求');

    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error('simulated quota network failure after restart');
    };
    const restartedStore = createSubscriptionStore({ userDataDir });
    const afterRestart = await restartedStore.getQuota({ authority: true });
    assert.equal(fetchCalls, 2, '新进程不能直接信任磁盘 quota mirror，必须尝试重新验证');
    assert.equal(afterRestart.remaining_chars, null, '重新验证失败时不得把旧磁盘正额度当作缓存授权');

    const raceDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-quota-race-'));
    try {
      await fsp.writeFile(
        path.join(raceDir, 'subscription.json'),
        JSON.stringify({ token: 'race-token', email: 'race@example.invalid' }),
        'utf8'
      );
      const raceStore = createSubscriptionStore({ userDataDir: raceDir });
      raceStore._injectCrypto({
        encrypt: value => Buffer.from(String(value)).toString('base64'),
        decrypt: value => Buffer.from(String(value), 'base64').toString(),
      });
      await raceStore.acceptAuthoritativeQuota(80);
      await raceStore.acceptAuthoritativeQuota(90);
      assert.equal(
        (await raceStore.getQuota({ authority: true })).remaining_chars,
        80,
        'out-of-order gateway snapshots must never raise the current quota authority'
      );
      await raceStore.acceptAuthoritativeQuota(0);
      await raceStore.acceptAuthoritativeQuota(20);
      assert.equal(
        (await raceStore.getQuota({ authority: true })).remaining_chars,
        0,
        'a later stale response must never reopen cache entitlement after zero balance'
      );

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ remaining_chars: 120, email: 'race@example.invalid' }),
      });
      const replenished = await raceStore.getQuota(true, { authority: true });
      assert.equal(replenished.remaining_chars, 120, 'explicit server refresh may start a new higher quota authority epoch');
    } finally {
      await fsp.rm(raceDir, { recursive: true, force: true });
    }
  } finally {
    global.fetch = originalFetch;
    await fsp.rm(userDataDir, { recursive: true, force: true });
  }

  console.log('TRANSLATION_QUOTA_HOT_PATH_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
