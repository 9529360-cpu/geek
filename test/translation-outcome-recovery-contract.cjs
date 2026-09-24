'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const workerPath = path.join(root, 'scripts', 'geek-translate-worker.js');
const workerSource = fs.readFileSync(workerPath, 'utf8');

function loadWorker(fetchImpl) {
  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    DOMException,
    crypto: globalThis.crypto,
    btoa,
    atob,
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(workerSource.replace(/^export default\s*/m, 'this.__worker = '), sandbox, { filename: workerPath });
  return sandbox.__worker;
}

function createD1(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
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
      lease_expires_at TEXT,
      request_hash TEXT,
      replay_ciphertext TEXT,
      replay_expires_at TEXT
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
        bind(...next) { return bound(next); },
        async first() { return sqlite.prepare(text).get(...values) || null; },
        async all() { return { results: sqlite.prepare(text).all(...values) }; },
        async run() {
          if (/^\s*SELECT\b/i.test(text)) {
            return { success: true, results: sqlite.prepare(text).all(...values), meta: { changes: 0, last_row_id: 0 } };
          }
          const result = sqlite.prepare(text).run(...values);
          return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    }
    return bound();
  }

  const db = {
    prepare,
    async batch(statements) {
      const isFinish = statements.some(statement => /replay_ciphertext\s*=\s*\?/i.test(statement.sql));
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        try { sqlite.exec('ROLLBACK'); } catch {}
        throw error;
      }
      if (throwAfterFinishCommit && isFinish) {
        throwAfterFinishCommit = false;
        throw new Error('simulated_response_loss_after_finish_commit');
      }
      return results;
    },
  };
  return { db, sqlite };
}

function tokenFor(secret = 'translation-test-secret') {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ uid: 42, aud: 'geek-translate', purpose: 'translate', iat: now, exp: now + 300 })).toString('base64url');
  const signature = nodeCrypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function requestFor(requestId, overrides = {}, secret = 'translation-test-secret', signal = undefined) {
  const body = {
    text: 'hello',
    source: 'en',
    target: 'it',
    provider: 'auto',
    route: 'primary',
    operationRoute: 'default',
    ...overrides,
  };
  return new Request('https://translate.invalid/v1/translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor(secret)}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'CF-Connecting-IP': '203.0.113.42',
    },
    body: JSON.stringify(body),
    signal,
  });
}

function envFor(db, secret = 'translation-test-secret') {
  return { JWT_SECRET: secret, GEMINI_API_KEY: 'configured-for-contract', geek_subscriptions: db };
}

function quota(sqlite) {
  return Number(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars);
}

function usage(sqlite, requestId) {
  return sqlite.prepare(`SELECT request_id, user_id, reserved_chars, target_chars, status,
    request_hash, replay_ciphertext, replay_expires_at, completed_at
    FROM translation_usage WHERE request_id = ?`).get(requestId) || null;
}

function successResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ciao' } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

(async () => {
  // Normal completion stores only encrypted replay material and settles value once.
  {
    const { db, sqlite } = createD1();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(response.status, 200);
    const responsePayload = await response.json();
    assert.equal(responsePayload.text, 'ciao');
    assert.equal(responsePayload.remaining_chars, 91, 'normal completion must return the post-commit authoritative balance');
    assert.equal(upstreamCalls, 1);
    assert.equal(quota(sqlite), 91);
    const row = usage(sqlite, requestId);
    assert.equal(row.status, 'complete');
    assert.match(String(row.request_hash), /^[0-9a-f]{64}$/);
    const plainCanonical = JSON.stringify({
      version: 'translation-op-v1',
      requestId,
      userId: 42,
      text: 'hello',
      source: 'en',
      target: 'it',
      provider: 'auto',
      route: 'default',
    });
    const plainDigest = nodeCrypto.createHash('sha256').update(plainCanonical).digest('hex');
    assert.notEqual(row.request_hash, plainDigest, 'request identity must be keyed, not a dictionary-friendly plain text digest');
    assert.match(String(row.replay_ciphertext), /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(String(row.replay_ciphertext).includes('ciao'), false, 'D1 must not persist plaintext translation output');
    assert.ok(row.replay_expires_at);
    sqlite.close();
  }

  // Equal message semantics under a different request ID must not create a cross-row equality oracle.
  {
    const { db, sqlite } = createD1();
    const worker = loadWorker(async () => successResponse());
    const firstId = nodeCrypto.randomUUID();
    const secondId = nodeCrypto.randomUUID();
    assert.equal((await worker.fetch(requestFor(firstId), envFor(db))).status, 200);
    assert.equal((await worker.fetch(requestFor(secondId), envFor(db))).status, 200);
    assert.notEqual(
      usage(sqlite, firstId).request_hash,
      usage(sqlite, secondId).request_hash,
      'request ID must be part of the keyed semantic binding so identical messages do not correlate across D1 rows'
    );
    sqlite.close();
  }

  // Hard case: billing + encrypted outcome commit, but the response is lost. Retry replays without charging/provider work.
  {
    const { db, sqlite } = createD1({ throwAfterFinishCommit: true });
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    const first = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(first.status, 502, 'the original caller can still observe an unknown transport/storage outcome');
    assert.equal(quota(sqlite), 91, 'committed value must remain charged exactly once');
    assert.equal(usage(sqlite, requestId).status, 'complete');

    sqlite.prepare('UPDATE users SET quota_chars = 80 WHERE id = 42').run();
    const retry = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(retry.status, 200, 'same logical operation must recover the committed result');
    const payload = await retry.json();
    assert.equal(payload.text, 'ciao');
    assert.equal(payload.replayed, true);
    assert.equal(payload.remaining_chars, 80, 'replay must project the current D1 balance, not a stale encrypted snapshot');
    assert.equal(upstreamCalls, 1, 'recovery must not call the provider a second time');
    assert.equal(quota(sqlite), 80, 'recovery must not debit or refund quota again');
    sqlite.close();
  }

  // Same request ID cannot be rebound to different semantics, even when source length is identical.
  {
    const { db, sqlite } = createD1();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    assert.equal((await worker.fetch(requestFor(requestId), envFor(db))).status, 200);
    const conflict = await worker.fetch(requestFor(requestId, { text: 'world' }), envFor(db));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'request_conflict');
    assert.equal(upstreamCalls, 1);
    assert.equal(quota(sqlite), 91);
    sqlite.close();
  }

  // Explicit stable operation route is part of the semantic hash; transport endpoint route may vary separately.
  {
    const { db, sqlite } = createD1();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    assert.equal((await worker.fetch(requestFor(requestId, { operationRoute: 'primary' }), envFor(db))).status, 200);
    const conflict = await worker.fetch(requestFor(requestId, { operationRoute: 'backup', route: 'backup' }), envFor(db));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'request_conflict');
    assert.equal(upstreamCalls, 1);
    sqlite.close();
  }

  // Client cancellation after reservation must abort provider work, refund exactly once and not poison provider health.
  {
    const { db, sqlite } = createD1();
    const controller = new AbortController();
    let started;
    const providerStarted = new Promise(resolve => { started = resolve; });
    const worker = loadWorker((_url, options = {}) => new Promise((_resolve, reject) => {
      started();
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const requestId = nodeCrypto.randomUUID();
    const pending = worker.fetch(requestFor(requestId, {}, 'translation-test-secret', controller.signal), envFor(db));
    await providerStarted;
    controller.abort(new Error('client canceled'));
    const response = await pending;
    assert.equal(response.status, 499);
    assert.equal((await response.json()).error, 'request_aborted');
    assert.equal(quota(sqlite), 100, 'cancellation before terminal commit must refund the reserved source debit');
    assert.equal(usage(sqlite, requestId), null, 'canceled reservation must not remain as durable debt');
    const health = await worker.fetch(new Request('https://translate.invalid/health'), envFor(db));
    assert.equal((await health.json()).models.gemini.failCount, 0, 'caller cancellation must not count as provider failure');
    sqlite.close();
  }

  // Cancellation observed after provider success but before finalization must still compensate the reservation.
  {
    const { db, sqlite } = createD1();
    const controller = new AbortController();
    const worker = loadWorker(async () => {
      controller.abort(new Error('client closed after provider result'));
      return successResponse();
    });
    const requestId = nodeCrypto.randomUUID();
    const response = await worker.fetch(requestFor(requestId, {}, 'translation-test-secret', controller.signal), envFor(db));
    assert.equal(response.status, 499);
    assert.equal(quota(sqlite), 100);
    assert.equal(usage(sqlite, requestId), null, 'provider result must not become a charge when cancellation is observed before finalization');
    sqlite.close();
  }

  // Replay material has a bounded privacy lifetime and is erased when an expired outcome is revisited.
  {
    const { db, sqlite } = createD1();
    let upstreamCalls = 0;
    const worker = loadWorker(async () => { upstreamCalls += 1; return successResponse(); });
    const requestId = nodeCrypto.randomUUID();
    assert.equal((await worker.fetch(requestFor(requestId), envFor(db))).status, 200);
    sqlite.prepare("UPDATE translation_usage SET replay_expires_at = datetime('now', '-1 second') WHERE request_id = ?").run(requestId);
    const expired = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(expired.status, 409);
    assert.equal((await expired.json()).error, 'completed_result_expired');
    assert.equal(usage(sqlite, requestId).replay_ciphertext, null, 'expired encrypted replay must be deleted on access');
    assert.equal(upstreamCalls, 1);
    assert.equal(quota(sqlite), 91);
    sqlite.close();
  }

  const schema = fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-schema.sql'), 'utf8');
  assert.match(schema, /\brequest_hash\s+TEXT\b/);
  assert.match(schema, /\breplay_ciphertext\s+TEXT\b/);
  assert.match(schema, /\breplay_expires_at\s+TEXT\b/);
  assert.match(schema, /idx_translation_usage_replay_expiry/);
  assert.match(workerSource, /AES-GCM/, 'replay data must be encrypted before D1 persistence');
  assert.match(workerSource, /OPERATION_HASH_DOMAIN/, 'operation identity must use a purpose-separated keyed domain');
  assert.match(workerSource, /REPLAY_KEY_DOMAIN/, 'replay encryption key derivation must use a distinct purpose domain');
  assert.match(workerSource, /requestId:\s*String\(requestId\)/, 'request ID must be bound into keyed semantic identity');
  assert.match(workerSource, /if \(shouldAffectProviderHealth\(error\)\) markProviderFail/, 'replay work must preserve provider-health fault classification');
  assert.match(workerSource, /callerSignal\?\.addEventListener\?\.\('abort'/, 'provider work must observe incoming request cancellation');
  assert.match(workerSource, /request_hash = \?/, 'finalization must stay bound to the semantic request hash');
  assert.match(workerSource, /replay_ciphertext = \?, replay_expires_at = datetime\('now', \?\)/, 'billing finalization and encrypted replay metadata must share one terminal update');

  console.log('TRANSLATION_OUTCOME_RECOVERY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
