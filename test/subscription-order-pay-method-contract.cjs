'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const policyPath = path.join(root, 'scripts', 'subscription-order-pay-method.mjs');
const wrapperPath = path.join(root, 'scripts', 'geek-subscription-worker.js');
const corePath = path.join(root, 'scripts', 'geek-subscription-worker-core.js');

function createD1Adapter(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const prepared = (values = []) => ({
        bind(...nextValues) {
          return prepared(nextValues);
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async first() {
          return statement.get(...values) || null;
        },
        async run() {
          const result = statement.run(...values);
          return {
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        },
      });
      return prepared();
    },
  };
}

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

(async () => {
  const policy = await import(`${pathToFileURL(policyPath).href}?contract=${Date.now()}`);
  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  const coreSource = fs.readFileSync(corePath, 'utf8');

  assert.equal(policy.normalizeRequestedPayMethod(undefined, false), 'manual', '未传支付方式必须兼容为 manual');
  assert.equal(policy.normalizeRequestedPayMethod('manual', true), 'manual');
  assert.equal(policy.normalizeRequestedPayMethod('usdt', true), 'usdt');
  for (const invalid of [undefined, null, '', 'card', 'USDT', ' usdt', 0, false, {}]) {
    assert.equal(
      policy.normalizeRequestedPayMethod(invalid, true),
      null,
      `显式非法支付方式必须拒绝: ${String(invalid)}`
    );
  }

  assert.ok(
    normalizeSql(coreSource).includes(normalizeSql(policy.LEGACY_PENDING_ORDER_SQL)),
    '兼容层锁定的旧 pending 查询必须继续对应核心 Worker 的实际查询'
  );
  assert.match(wrapperSource, /hasOwnProperty\.call\(body, 'pay_method'\)/, '必须区分省略字段与显式非法值');
  assert.match(wrapperSource, /scopePendingOrderReuse\(env\.geek_subscriptions, payMethod\)/);
  assert.match(wrapperSource, /new URL\('\/api\/me', request\.url\)/, '非法支付方式不得绕过原有用户鉴权');
  assert.doesNotMatch(wrapperSource, /release-client-version|package\.json/, '后端修复不得触碰客户端发布边界');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL,
      pay_method TEXT
    );
  `);
  const insert = sqlite.prepare(
    'INSERT INTO orders (id, user_id, plan, status, pay_method) VALUES (?, ?, ?, ?, ?)'
  );
  const rows = [
    [1, 1, 'basic', 'pending', 'manual'],
    [2, 1, 'basic', 'pending', 'usdt'],
    [3, 1, 'basic', 'pending', 'manual'],
    [4, 2, 'basic', 'pending', null],
    [5, 3, 'basic', 'pending', ''],
    [6, 4, 'basic', 'pending', 'card'],
    [7, 5, 'basic', 'paid', 'manual'],
    [8, 6, 'standard', 'pending', 'usdt'],
    [9, 7, 'basic', 'pending', 'manual'],
    [10, 7, 'basic', 'pending', 'usdt'],
    [11, 8, 'basic', 'pending', 'usdt'],
    [12, 8, 'basic', 'pending', 'manual'],
  ];
  for (const row of rows) insert.run(...row);

  const d1 = createD1Adapter(sqlite);
  const findPending = async (db, userId, plan) => {
    const { results } = await db
      .prepare(policy.LEGACY_PENDING_ORDER_SQL)
      .bind(userId, plan)
      .all();
    return results[0] || null;
  };

  const manualDb = policy.scopePendingOrderReuse(d1, 'manual');
  const usdtDb = policy.scopePendingOrderReuse(d1, 'usdt');

  assert.equal((await findPending(manualDb, 1, 'basic')).id, 3, '同支付方式必须复用最新 manual pending');
  assert.equal((await findPending(usdtDb, 1, 'basic')).id, 2, '同支付方式必须复用最新 usdt pending');
  assert.equal((await findPending(manualDb, 7, 'basic')).id, 9, '较新的 usdt 不得遮挡已有 manual pending');
  assert.equal((await findPending(usdtDb, 8, 'basic')).id, 11, '较新的 manual 不得遮挡已有 usdt pending');
  assert.equal((await findPending(manualDb, 2, 'basic')).id, 4, '旧 NULL pending 必须仅按 manual 兼容');
  assert.equal((await findPending(manualDb, 3, 'basic')).id, 5, '旧空字符串 pending 必须仅按 manual 兼容');
  assert.equal(await findPending(usdtDb, 2, 'basic'), null, '旧 NULL pending 不得跨到 usdt');
  assert.equal(await findPending(usdtDb, 3, 'basic'), null, '旧空字符串 pending 不得跨到 usdt');
  assert.equal(await findPending(manualDb, 4, 'basic'), null, '未知历史支付方式必须 fail closed');
  assert.equal(await findPending(usdtDb, 4, 'basic'), null, '未知历史支付方式不得伪装成 usdt');
  assert.equal(await findPending(manualDb, 5, 'basic'), null, '非 pending 订单不得复用');
  assert.equal(await findPending(usdtDb, 6, 'basic'), null, '不同套餐不得复用');

  const passthrough = await manualDb
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id ASC')
    .bind(1)
    .all();
  assert.deepEqual(passthrough.results.map((row) => row.id), [1, 2, 3], '无关 D1 查询不得被兼容层改写');
  assert.throws(() => policy.scopePendingOrderReuse(d1, 'card'), /Unsupported order pay method/);

  sqlite.close();
  console.log('SUBSCRIPTION_ORDER_PAY_METHOD_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
