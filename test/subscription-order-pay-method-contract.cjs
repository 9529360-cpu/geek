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
  assert.ok(
    normalizeSql(coreSource).includes(normalizeSql(policy.LEGACY_ORDER_INSERT_SQL)),
    '原子订单兼容层锁定的旧订单 INSERT 必须继续对应核心 Worker 的实际写路径'
  );
  assert.match(wrapperSource, /hasOwnProperty\.call\(body, 'pay_method'\)/, '必须区分省略字段与显式非法值');
  assert.match(
    wrapperSource,
    /scopePendingOrderReuse\(scopedEnv\.geek_subscriptions, payMethod\)/,
    '支付方式兼容层必须叠加在当前请求已经建立的安全 D1 scope 上'
  );
  assert.match(
    wrapperSource,
    /scopeUsdtOrderAmountAllocation\(scopedDb, payMethod\)/,
    'USDT 金额原子分配必须叠加在 pending 复用 scope 之后'
  );
  assert.match(wrapperSource, /const reuseReplayRequest = request\.clone\(\)/, '并发丢失 admission 的请求必须预留一次可重放的请求体');
  assert.match(wrapperSource, /error\?\.code === PENDING_ORDER_ALREADY_EXISTS/, '并发 pending admission 冲突必须有独立恢复分支');
  assert.match(
    wrapperSource,
    /return coreWorker\.fetch\(reuseReplayRequest, scopedRequestEnv, ctx\)/,
    '并发 admission 冲突只能重放核心读取/复用路径，不能手工制造订单响应'
  );
  assert.match(wrapperSource, /payment_slots_exhausted/, '100 个金额槽耗尽时必须返回稳定错误');
  assert.match(wrapperSource, /new URL\('\/api\/me', request\.url\)/, '非法支付方式不得绕过原有用户鉴权');
  assert.doesNotMatch(wrapperSource, /release-client-version|package\.json/, '后端修复不得触碰客户端发布边界');
  assert.match(
    policy.ATOMIC_PENDING_ORDER_INSERT_SQL,
    /WHERE NOT EXISTS/,
    'pending 订单最终 admission 必须在单条 INSERT 内完成存在性判定'
  );
  assert.match(
    policy.ATOMIC_PENDING_ORDER_INSERT_SQL,
    /COALESCE\(NULLIF\(pay_method, ''\), 'manual'\) = \?/,
    '原子 pending admission 必须保持旧 NULL/空字符串 manual 兼容语义'
  );
  assert.match(
    policy.ATOMIC_USDT_ORDER_INSERT_SQL,
    /status IN \('pending', 'processing'\)/,
    'pending 与 processing USDT 金额都必须视为活跃占用'
  );
  assert.match(
    policy.ATOMIC_USDT_ORDER_INSERT_SQL,
    /user_id = \? AND plan = \? AND status = 'pending'/,
    'USDT 金额 admission 必须同时原子守住同用户同套餐 pending 订单唯一性'
  );

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

  const allocationSqlite = new DatabaseSync(':memory:');
  allocationSqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pay_method TEXT NOT NULL,
      amount_cents INTEGER
    );
  `);
  const allocationDb = createD1Adapter(allocationSqlite);
  const productionScopedDb = (payMethod) => policy.scopeUsdtOrderAmountAllocation(
    policy.scopePendingOrderReuse(allocationDb, payMethod),
    payMethod
  );
  const scopedAllocationDb = productionScopedDb('usdt');
  const insertOrder = (db, userId, preferredAmountCents, payMethod = 'usdt', plan = 'basic') => db
    .prepare(policy.LEGACY_ORDER_INSERT_SQL)
    .bind(userId, plan, plan === 'standard' ? 48 : 25, 'USD', payMethod, preferredAmountCents)
    .run();
  const orderById = (id) => allocationSqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);

  const first = await insertOrder(scopedAllocationDb, 101, 2499);
  assert.equal(orderById(first.meta.last_row_id).amount_cents, 2499, '首选 USDT 唯一金额空闲时必须原样使用');

  const second = await insertOrder(scopedAllocationDb, 102, 2499);
  assert.equal(orderById(second.meta.last_row_id).amount_cents, 2498, '并发同首选金额冲突时必须原子换到下一个合法槽');

  allocationSqlite.prepare(
    "INSERT INTO orders (user_id, plan, amount, currency, status, pay_method, amount_cents) VALUES (?, 'basic', 25, 'USD', 'processing', 'usdt', ?)"
  ).run(103, 2497);
  const afterProcessing = await insertOrder(scopedAllocationDb, 104, 2497);
  assert.equal(orderById(afterProcessing.meta.last_row_id).amount_cents, 2496, 'processing 金额必须继续保留，不能被新订单复用');

  allocationSqlite.prepare(
    "INSERT INTO orders (user_id, plan, amount, currency, status, pay_method, amount_cents) VALUES (?, 'basic', 25, 'USD', 'paid', 'usdt', ?)"
  ).run(105, 2495);
  const afterPaid = await insertOrder(scopedAllocationDb, 106, 2495);
  assert.equal(orderById(afterPaid.meta.last_row_id).amount_cents, 2495, 'paid 金额不再活跃，应允许后续订单复用');

  // 模拟两个请求都已经在旧的 read-then-insert precheck 里看到“无 pending”。
  // 最终写入 admission 仍必须由单条 SQL 决定，只允许一个 logical pending 获胜。
  const manualAtomicDb = productionScopedDb('manual');
  assert.equal(await findPending(manualAtomicDb, 300, 'basic'), null);
  assert.equal(await findPending(manualAtomicDb, 300, 'basic'), null);
  const manualWinner = await insertOrder(manualAtomicDb, 300, null, 'manual');
  await assert.rejects(
    () => insertOrder(manualAtomicDb, 300, null, 'manual'),
    (error) => error?.code === policy.PENDING_ORDER_ALREADY_EXISTS,
    '并发 manual 请求即使都看到 stale empty precheck，最终也只能插入一个 pending'
  );
  const manualPendingRows = allocationSqlite.prepare(
    "SELECT * FROM orders WHERE user_id = 300 AND plan = 'basic' AND status = 'pending' AND pay_method = 'manual'"
  ).all();
  assert.equal(manualPendingRows.length, 1);
  assert.equal(manualPendingRows[0].id, manualWinner.meta.last_row_id);

  const user300Usdt = await insertOrder(productionScopedDb('usdt'), 300, 2494, 'usdt');
  assert.equal(orderById(user300Usdt.meta.last_row_id).pay_method, 'usdt', '同套餐不同支付方式仍允许独立 pending');

  const usdtAtomicDb = productionScopedDb('usdt');
  assert.equal(await findPending(usdtAtomicDb, 400, 'basic'), null);
  assert.equal(await findPending(usdtAtomicDb, 400, 'basic'), null);
  const usdtWinner = await insertOrder(usdtAtomicDb, 400, 2493, 'usdt');
  await assert.rejects(
    () => insertOrder(usdtAtomicDb, 400, 2492, 'usdt'),
    (error) => error?.code === policy.PENDING_ORDER_ALREADY_EXISTS,
    '并发 USDT 请求必须先按 logical pending ownership 收敛，不能换一个金额再建第二张单'
  );
  const usdtPendingRows = allocationSqlite.prepare(
    "SELECT * FROM orders WHERE user_id = 400 AND plan = 'basic' AND status = 'pending' AND pay_method = 'usdt'"
  ).all();
  assert.equal(usdtPendingRows.length, 1);
  assert.equal(usdtPendingRows[0].id, usdtWinner.meta.last_row_id);

  const differentPlan = await insertOrder(usdtAtomicDb, 400, 4799, 'usdt', 'standard');
  assert.equal(orderById(differentPlan.meta.last_row_id).plan, 'standard', '同用户不同套餐必须保持独立 admission');
  const differentUser = await insertOrder(usdtAtomicDb, 401, 2492, 'usdt');
  assert.equal(orderById(differentUser.meta.last_row_id).user_id, 401, '不同用户必须保持独立 admission');

  const manualAllocationDb = policy.scopeUsdtOrderAmountAllocation(allocationDb, 'manual');
  const passthroughManualInsert = await allocationDb
    .prepare(policy.LEGACY_ORDER_INSERT_SQL)
    .bind(500, 'standard', 48, 'USD', 'manual', null)
    .run();
  const manualInsert = await manualAllocationDb
    .prepare(policy.LEGACY_ORDER_INSERT_SQL)
    .bind(501, 'standard', 48, 'USD', 'manual', null)
    .run();
  assert.equal(orderById(manualInsert.meta.last_row_id).pay_method, 'manual', 'USDT 金额 scope 在 manual 模式必须保持透传');
  assert.notEqual(manualInsert.meta.last_row_id, passthroughManualInsert.meta.last_row_id);
  allocationSqlite.close();

  const fullSqlite = new DatabaseSync(':memory:');
  fullSqlite.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pay_method TEXT NOT NULL,
      amount_cents INTEGER
    );
  `);
  const fill = fullSqlite.prepare(
    "INSERT INTO orders (user_id, plan, amount, currency, status, pay_method, amount_cents) VALUES (?, 'basic', 25, 'USD', ?, 'usdt', ?)"
  );
  for (let discount = 1; discount <= 100; discount += 1) {
    fill.run(200 + discount, discount % 2 === 0 ? 'pending' : 'processing', 2500 - discount);
  }
  const fullAdapter = createD1Adapter(fullSqlite);
  const fullDb = policy.scopeUsdtOrderAmountAllocation(policy.scopePendingOrderReuse(fullAdapter, 'usdt'), 'usdt');
  await assert.rejects(
    () => insertOrder(fullDb, 999, 2399),
    (error) => error?.code === policy.USDT_PAYMENT_SLOTS_EXHAUSTED,
    '100 个合法金额槽全部占用时必须显式失败'
  );
  const fullStats = fullSqlite.prepare('SELECT COUNT(*) AS c, MIN(amount_cents) AS min_amount FROM orders').get();
  assert.equal(fullStats.c, 100, '金额槽耗尽不得额外插入订单');
  assert.equal(fullStats.min_amount, 2400, '金额槽耗尽不得越过最大 $1.00 优惠边界');
  fullSqlite.close();

  console.log('SUBSCRIPTION_ORDER_PAY_METHOD_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});