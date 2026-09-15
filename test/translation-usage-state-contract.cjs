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

  let throwAfterReservationCommit = Boolean(options.throwAfterReservationCommit);
  let throwBeforeReservationCommit = Boolean(options.throwBeforeReservationCommit);
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
      const isReservationBatch = statements.some((statement) =>
        /INSERT\s+INTO\s+translation_usage/i.test(statement.sql)
      ) && statements.some((statement) =>
        /SET\s+quota_chars\s*=\s*quota_chars\s*-\s*\?/i.test(statement.sql)
      );
      const isFinishBatch = statements.some((statement) =>
        /UPDATE\s+translation_usage\s+SET\s+target_chars\s*=\s*\?/i.test(statement.sql)
      );

      if (throwBeforeReservationCommit && isReservationBatch) {
        throwBeforeReservationCommit = false;
        throw new Error('simulated_d1_precommit_failure');
      }

      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        try { sqlite.exec('ROLLBACK'); } catch {}
        throw error;
      }

      if (throwAfterReservationCommit && isReservationBatch) {
        throwAfterReservationCommit = false;
        throw new Error('simulated_d1_unknown_reservation_outcome_after_commit');
      }
      if (throwAfterFinishCommit && isFinishBatch) {
        throwAfterFinishCommit = false;
        throw new Error('simulated_d1_unknown_finish_outcome_after_commit');
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

(async () => {
  // This contract deliberately uses the pre-replay schema to prove migration 006 remains backward compatible.
  // The dedicated outcome-recovery contract covers the richer post-migration replay semantics.

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

  // 2. A real upstream failure refunds only this attempt's reservation and removes its placeholder.
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
    assert.equal(usage(sqlite, requestId), null, 'failed upstream call must remove the owned reservation row');

    fail = false;
    const retried = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(retried.status, 200, 'refunded request ID must be reusable for a safe retry');
    assert.equal(quota(sqlite), 91);
    assert.equal(usage(sqlite, requestId).status, 'complete');
    assert.equal(upstreamCalls, 2);
    sqlite.close();
  }

  // 3. The reservation transaction commits, but the caller loses the response. Durable ownership proves
  //    this exact attempt already reserved source quota, so it continues instead of returning 409.
  {
    const { db, sqlite } = createD1({ throwAfterReservationCommit: true });
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(response.status, 200, 'owned reservation must reconcile an unknown post-COMMIT outcome');
    assert.equal(upstreamCalls, 1, 'reconciled reservation must make exactly one provider call');
    assert.equal(quota(sqlite), 91, 'reconciliation must not double-debit source quota');
    const row = usage(sqlite, requestId);
    assert.equal(row.status, 'complete');
    assert.equal(Number(row.reserved_chars), 5);
    assert.equal(Number(row.target_chars), 4);
    sqlite.close();
  }

  // 4. While request A owns a durable reservation, a same-ID request is classified as in progress.
  //    It must not call the provider and cannot finish/refund A's owner marker.
  {
    const { db, sqlite } = createD1();
    const providerEntered = deferred();
    const releaseProvider = deferred();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => {
      upstreamCalls += 1;
      if (upstreamCalls > 1) throw new Error('duplicate_request_reached_provider');
      providerEntered.resolve();
      await releaseProvider.promise;
      return successResponse();
    });
    const requestId = nodeCrypto.randomUUID();
    const firstPromise = worker.fetch(translateRequest(requestId), envFor(db));
    await providerEntered.promise;

    assert.equal(quota(sqlite), 95, 'first request must own the committed source reservation while provider is active');
    const inFlight = usage(sqlite, requestId);
    assert.match(String(inFlight.status), /^reserved:[0-9a-f-]{36}$/i);

    const duplicate = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error, 'request_in_progress');
    assert.equal(upstreamCalls, 1, 'in-progress reconciliation must be rejected before another provider call');
    assert.equal(quota(sqlite), 95, 'in-progress reconciliation must not mutate the first reservation');
    assert.equal(usage(sqlite, requestId).status, inFlight.status, 'same-ID request must not replace owner marker');

    releaseProvider.resolve();
    const first = await firstPromise;
    assert.equal(first.status, 200);
    assert.equal(quota(sqlite), 91);
    assert.equal(usage(sqlite, requestId).status, 'complete');
    sqlite.close();
  }

  // 5. Insufficient source quota creates no reservation row and never reaches a provider.
  {
    const { db, sqlite } = createD1();
    sqlite.prepare('UPDATE users SET quota_chars = 4 WHERE id = 42').run();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(response.status, 402);
    assert.equal((await response.json()).error, 'quota_exhausted');
    assert.equal(upstreamCalls, 0);
    assert.equal(quota(sqlite), 4);
    assert.equal(usage(sqlite, requestId), null);
    sqlite.close();
  }

  // 6. A genuine pre-COMMIT D1 failure has no durable owner row. It is a translation/storage failure,
  //    not a duplicate request, and leaves quota untouched.
  {
    const { db, sqlite } = createD1({ throwBeforeReservationCommit: true });
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'translation_failed');
    assert.equal(upstreamCalls, 0);
    assert.equal(quota(sqlite), 100);
    assert.equal(usage(sqlite, requestId), null);
    sqlite.close();
  }

  // 7. On the legacy schema, finishUsage can commit and the caller can still observe an exception.
  //    The terminal row remains charged and non-replayable until migration 006 adds encrypted outcome replay.
  {
    const { db, sqlite } = createD1({ throwAfterFinishCommit: true });
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const ambiguous = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(ambiguous.status, 502, 'legacy schema still surfaces an unknown finish outcome as request failure');
    assert.equal(quota(sqlite), 91, 'catch/refund must not mint source quota after finish already committed');
    const completed = usage(sqlite, requestId);
    assert.equal(completed.status, 'complete', 'completed idempotency row must survive the catch/refund path');
    assert.equal(Number(completed.target_chars), 4);

    const duplicate = await worker.fetch(translateRequest(requestId), envFor(db));
    assert.equal(duplicate.status, 409, 'legacy terminal request ID must stay reserved against unsafe replay');
    assert.equal((await duplicate.json()).error, 'duplicate_request');
    assert.equal(quota(sqlite), 91, 'legacy duplicate must not debit or credit quota again');
    assert.equal(usage(sqlite, requestId).status, 'complete');
    assert.equal(upstreamCalls, 1, 'legacy duplicate terminal request must be rejected before another provider call');
    sqlite.close();
  }

  // Production SQL must bind recovery/refund/finalization to one attempt-owned reservation marker.
  assert.match(workerSource, /const owner = `reserved:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(workerSource, /SELECT user_id, reserved_chars, status FROM translation_usage WHERE request_id = \?/);
  assert.match(workerSource, /String\(row\.status\) === owner/);
  assert.match(workerSource, /DELETE FROM translation_usage WHERE request_id = \? AND user_id = \? AND reserved_chars = \? AND status = \?/);
  assert.match(workerSource, /UPDATE translation_usage SET target_chars = \?, status = 'complete',[^\n]+WHERE request_id = \? AND user_id = \? AND status = \?/);
  assert.match(workerSource, /reservationOwner = reservation\.owner/);
  assert.match(
    workerSource,
    /finishUsage\([\s\S]*?requestId,[\s\S]*?countChars\(result\),[\s\S]*?reservationOwner/,
    'terminal settlement must still bind target billing to the owned reservation'
  );
  assert.match(workerSource, /refundUsage\(db, auth\.uid, requestId, reserved, reservationOwner\)/);
  assert.doesNotMatch(workerSource, /status = 'reserved'[^\n]*\)\.bind\(requestId, userId, chars\)/, 'attempt cleanup must not rely on a shared reserved state');

  console.log('TRANSLATION_USAGE_STATE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
