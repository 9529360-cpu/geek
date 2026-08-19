'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');
const { runAccountDataStoreCases } = require('../test-support/account-data-store-cases.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-secure-storage-'));
  const store = createSubscriptionStore({ userDataDir: dir });
  store._injectCrypto({ encrypt() { throw new Error('dpapi unavailable'); }, decrypt() { return ''; } });

  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).endsWith('/api/login')
      ? { token: 'SECRET_TOKEN_MUST_NOT_REACH_DISK', user: { email: 'test@example.invalid' } }
      : { remaining_chars: 10 },
  });
  try {
    await assert.rejects(() => store.login('test@example.invalid', 'password'), /加密失败/);
  } finally {
    global.fetch = originalFetch;
  }

  const file = path.join(dir, 'subscription.json');
  const disk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  assert.doesNotMatch(disk, /SECRET_TOKEN_MUST_NOT_REACH_DISK/, '加密失败时绝不能把 token 明文写盘');

  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  assert.doesNotMatch(main, /safeStorage\.encryptString[^\n]*catch\s*\{\s*return text/, '主进程敏感字段不得降级明文');
  assert.doesNotMatch(main, /lineTokenEncrypt[\s\S]{0,300}catch\s*\{\s*return text/, 'LINE token 不得降级明文');
  assert.match(main, /配置敏感字段迁移失败，保留原文件/, '配置迁移失败必须保留原文件');
  assert.match(main, /账号敏感字段迁移失败，保留原文件/, '账号迁移失败必须保留原文件');

  await runAccountDataStoreCases();

  console.log('SECURE_STORAGE_FAIL_CLOSED_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
