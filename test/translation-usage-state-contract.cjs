'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const workerPath = path.join(root, 'scripts', 'geek-translate-worker.js');
const workerSource = fs.readFileSync(workerPath, 'utf8');

function loadWorker(fetchImpl) {
  const code = workerSource.replace(/^export default\s*/m, 'this.__export = ');
  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    crypto: globalThis.crypto,
    btoa,
    atob,
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
  };
  const vm = require('node:vm');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: workerPath });
  assert.ok(typeof sandbox.__export?.fetch === 'function', 'translation Worker must export fetch');
  return sandbox.__export;
}

function createD1(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      quota_chars INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE translation_usage (
      request_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      reserved_chars INTEGER NOT NULL,
      target_chars INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reserved',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, status, quota_chars) VALUES (42, 'active', 100);
  `);

  let throwAfterFinishCommit = Boolean(options.throwAfterFinishCommit);

  function prepare(sql) {
    const text = String(sql);
    function bound(values = []) {
      return {
        sql: text,
        values,
        bind(...nextValues) { return bound(nextValues); },
        async first() {
          return sqlite.prepare(text).get(...values) || null;
        },
        async all() {
          return { results: sqlite.prepare(text).all(...values) };
        },
        async run() {
          const result = sqlite.prepare(text).run(...values);
          return {
            success: true,
            results: [],
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        },
      };
    }
    return bound();
  }

  const db = {
    prepare,
    async batch(statements) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        try { sqlite.exec('ROLLBACK'); } catch {}
        throw error;
      }

      const isFinishBatch = statements.some((statement) =>
        /UPDATE\s+translation_usage\s+SET\s+target_chars\s*=\s*\?/i.test(statement.sql)
      );
      if (throwAfterFinishCommit && isFinishBatch) {
        throwAfterFinishCommit = false;
        throw new Error('simulated_d1_unknown_outcome_after_commit');
      }
      return results;
    },
  };

  return { db, sqlite };
}

function tokenFor(userId = 42, secret = 'translation-test-secret') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    aud: 'geek-translate',
    purpose: 'translate',
    iat: now,
    exp: now + 300,
  })).toString('base64url');
  const signature = nodeCrypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function translateRequest(requestId, secret = 'translation-test-secret') {
  return new Request('https://translate.invalid/v1/translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor(42, secret)}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'CF-Connecting-IP': '203.0.113.42',
    },
    body: JSON.stringify({ text: 'hello', target: 'it', provider: 'auto', route: 'default' }),
  });
}

function envFor(db, secret = 'translation-test-secret') {
  return {
    JWT_SECRET: secret,
    GEMINI_API_KEY: 'configured-for-contract',
    geek_subscriptions: db,
  };
}

function quota(sqlite) {
  return Number(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars);
}

function usage(sqlite, requestId) {
  return sqlite.prepare(`
    SELECT request_id, user_id, reserved_chars, target_chars, status, completed_at
    FROM translation_usage WHERE request_id = ?
  `).get(requestId) || null;
}

function successResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ciao' } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

(async () => {
  // 1. Success keeps the documented source + target charging rule and closes the ledger row.
  {
    const { db, sqlite } = createD1();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, 'ciao');
    assert.equal(upstreamCalls, 1);
    assert.equal(quota(sqlite), 91, '5 source chars + 4 target chars must be charged');
    const row = usage(sqlite, requestId);
    assert.equal(row.status, 'complete');
    assert.equal(Number(row.reserved_chars), 5);
    assert.equal(Number(row.target_chars), 4);
    assert.ok(row.completed_at, 'completed usage must retain terminal timestamp');
    sqlite.close();
  }

  // 2. A real upstream failure refunds only the still-reserved source charge and removes the placeholder.
  {
    const { db, sqlite } = createD1();
    let fail = true;
    let upstreamCalls = 0;
    const worker = loadWorker(async () => {
      upstreamCalls += 1;
      if (fail) return new Response('provider unavailable', { status: 503 });
      return successResponse();
    });
    const requestId = nodeCrypto.randomUUID();
    const failed = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(failed.status, 502);
    assert.equal(quota(sqlite), 100, 'failed upstream call must restore the source reservation');
    assert.equal(usage(sqlite, requestId), null, 'failed upstream call must remove the reserved placeholder');

    fail = false;
    const retried = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(retried.status, 200, 'refunded request ID must be reusable for a safe retry');
    assert.equal(quota(sqlite), 91);
    assert.equal(usage(sqlite, requestId).status, 'complete');
    assert.equal(upstreamCalls, 2);
    sqlite.close();
  }

  // 3. Simulate the hard case: D1 commits finishUsage, then the caller observes an exception.
  //    The outer catch will call refundUsage, which must see the terminal row and do nothing.
  {
    const { db, sqlite } = createD1({ throwAfterFinishCommit: true });
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const ambiguous = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(ambiguous.status, 502, 'unknown finish outcome is surfaced as a request failure');
    assert.equal(quota(sqlite), 91, 'catch/refund must not mint source quota after finish already committed');
    const completed = usage(sqlite, requestId);
    assert.equal(completed.status, 'complete', 'completed idempotency row must survive the catch/refund path');
    assert.equal(Number(completed.target_chars), 4);

    const duplicate = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(duplicate.status, 409, 'terminal request ID must stay reserved against replay');
    assert.equal((await duplicate.json()).error, 'duplicate_request');
    assert.equal(quota(sqlite), 91, 'replay must not debit or credit quota again');
    assert.equal(usage(sqlite, requestId).status, 'complete');
    assert.equal(upstreamCalls, 1, 'duplicate terminal request must be rejected before another provider call');
    sqlite.close();
  }

  // The production SQL itself must bind terminal transitions to the exact user/request and reserved state.
  assert.match(workerSource, /DELETE FROM translation_usage WHERE request_id = \? AND user_id = \? AND reserved_chars = \? AND status = 'reserved'/);
  assert.match(workerSource, /UPDATE translation_usage SET target_chars = \?, status = 'complete',[^\n]+WHERE request_id = \? AND user_id = \? AND status = 'reserved'/);

  console.log('TRANSLATION_USAGE_STATE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
