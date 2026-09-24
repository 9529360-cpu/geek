'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const SECRET = 'translation-idempotent-entitlement-secret';

function createD1() {
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
            return {
              success: true,
              results: sqlite.prepare(text).all(...values),
              meta: { changes: 0, last_row_id: 0 },
            };
          }
          const result = sqlite.prepare(text).run(...values);
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
      };
    }
    return bound();
  }

  return {
    sqlite,
    db: {
      prepare,
      async batch(statements) {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          try { sqlite.exec('ROLLBACK'); } catch {}
          throw error;
        }
      },
    },
  };
}

function loadWorker(fetchImpl) {
  const sandbox = {
    Request,
    Response,
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
  vm.runInContext(workerSource.replace(/^export default\s*/m, 'this.__worker = '), sandbox, {
    filename: 'scripts/geek-translate-worker.js',
  });
  return sandbox.__worker;
}

function tokenFor() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    uid: 42,
    aud: 'geek-translate',
    purpose: 'translate',
    iat: now,
    exp: now + 300,
  })).toString('base64url');
  const signature = nodeCrypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function requestFor(requestId) {
  return new Request('https://translate.invalid/v1/translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor()}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'CF-Connecting-IP': '203.0.113.42',
    },
    body: JSON.stringify({
      text: 'hello',
      source: 'en',
      target: 'it',
      provider: 'auto',
      route: 'default',
      operationRoute: 'default',
    }),
  });
}

function envFor(db) {
  return {
    JWT_SECRET: SECRET,
    GEMINI_API_KEY: 'configured-for-contract',
    geek_subscriptions: db,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function rateLimitRows(sqlite) {
  return Number(sqlite.prepare('SELECT COUNT(*) AS count FROM rate_limits').get().count || 0);
}

(async () => {
  const { db, sqlite } = createD1();
  const providerEntered = deferred();
  const releaseProvider = deferred();
  let providerCalls = 0;
  const worker = loadWorker(async () => {
    providerCalls += 1;
    providerEntered.resolve();
    await releaseProvider.promise;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ciao' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const requestId = nodeCrypto.randomUUID();
  const firstPromise = worker.fetch(requestFor(requestId), envFor(db));
  await providerEntered.promise;

  assert.equal(rateLimitRows(sqlite), 0, 'translation entitlement must not consume user/IP request-limit buckets');

  for (let poll = 1; poll <= 35; poll += 1) {
    const response = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(response.status, 409, `in-progress reconciliation poll ${poll} must not become rate limited`);
    assert.equal((await response.json()).error, 'request_in_progress');
  }
  assert.equal(rateLimitRows(sqlite), 0, 'in-progress reconciliation must remain independent from request-limit buckets');
  assert.equal(providerCalls, 1, 'duplicate reconciliation must never invoke the provider again');

  releaseProvider.resolve();
  const first = await firstPromise;
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.text, 'ciao');
  assert.equal(firstPayload.remaining_chars, 91, 'first completion must project the authoritative post-commit quota');

  for (let replay = 1; replay <= 35; replay += 1) {
    const response = await worker.fetch(requestFor(requestId), envFor(db));
    assert.equal(response.status, 200, `completed replay ${replay} must not become rate limited`);
    const payload = await response.json();
    assert.equal(payload.text, 'ciao');
    assert.equal(payload.replayed, true);
    assert.equal(payload.remaining_chars, 91, 'replay must project current D1 quota without a second debit');
  }
  assert.equal(rateLimitRows(sqlite), 0, 'completed replays must never revive the removed product request limiter');
  assert.equal(providerCalls, 1);
  assert.equal(Number(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars), 91);

  sqlite.close();
  console.log('TRANSLATION_IDEMPOTENT_ENTITLEMENT_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
