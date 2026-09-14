'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const workerPath = path.join(root, 'scripts', 'geek-translate-worker.js');
const workerSource = fs.readFileSync(workerPath, 'utf8');

function createD1(quota = 1000) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT NOT NULL, quota_chars INTEGER NOT NULL);
    CREATE TABLE translation_usage (
      request_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, reserved_chars INTEGER NOT NULL,
      target_chars INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
    );
    CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO users (id, status, quota_chars) VALUES (42, 'active', ${quota});
  `);
  function prepare(sql) {
    const text = String(sql);
    function stmt(values = []) {
      return {
        sql: text,
        bind(...next) { return stmt(next); },
        async first() { return sqlite.prepare(text).get(...values) || null; },
        async run() {
          const result = sqlite.prepare(text).run(...values);
          return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }, results: [] };
        },
      };
    }
    return stmt();
  }
  return {
    sqlite,
    db: {
      prepare,
      async batch(statements) {
        const out = [];
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          for (const statement of statements) out.push(await statement.run());
          sqlite.exec('COMMIT');
          return out;
        } catch (error) {
          try { sqlite.exec('ROLLBACK'); } catch {}
          throw error;
        }
      },
    },
  };
}

function token(secret, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ uid: 42, aud: 'geek-translate', purpose: 'translate', iat: now, exp: now + 300 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function loadWorker(fetchImpl, options = {}) {
  const source = workerSource.replace(/^export default\s*/m, 'this.__worker = ');
  let fakeNow = options.fakeNow || Date.now();
  const NativeDate = Date;
  class FakeDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fakeNow])); }
    static now() { return fakeNow; }
  }
  const timers = new Map();
  let timerId = 0;
  const fakeSetTimeout = (fn, ms) => {
    const id = ++timerId;
    timers.set(id, true);
    queueMicrotask(() => {
      if (!timers.has(id)) return;
      fakeNow += Math.max(0, Number(ms) || 0);
      fn();
    });
    return id;
  };
  const fakeClearTimeout = id => timers.delete(id);
  const sandbox = {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
    crypto: globalThis.crypto, btoa, atob, console,
    fetch: fetchImpl,
    setTimeout: options.fakeTimers ? fakeSetTimeout : setTimeout,
    clearTimeout: options.fakeTimers ? fakeClearTimeout : clearTimeout,
    Date: options.fakeTimers ? FakeDate : Date,
    queueMicrotask,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'geek-translate-worker.js' });
  return { worker: sandbox.__worker, now: () => fakeNow };
}

function request({ secret, requestId = crypto.randomUUID(), text = '你好', target = 'it', deadlineMs, nowMs = Date.now() }) {
  const headers = {
    Authorization: `Bearer ${token(secret, nowMs)}`,
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    'CF-Connecting-IP': '203.0.113.42',
  };
  if (deadlineMs !== undefined) headers['X-Geek-Deadline-Ms'] = String(deadlineMs);
  return new Request('https://translate.invalid/v1/translate', {
    method: 'POST', headers,
    body: JSON.stringify({ text, source: 'auto', target, provider: 'auto', route: 'default' }),
  });
}

function env(db, secret) {
  return { geek_subscriptions: db, JWT_SECRET: secret, GEMINI_API_KEY: 'g', MISTRAL_API_KEY: 'm', ZAI_API_KEY: 'z' };
}

(async () => {
  const secret = 'test-secret';

  // Caller budget must cap the whole provider rotation: when the first attempt consumes
  // the remaining deadline, the Worker must stop and never start provider #2.
  {
    const { db, sqlite } = createD1();
    let calls = 0;
    const start = Date.now();
    const { worker } = loadWorker((_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }, { fakeTimers: true, fakeNow: start });
    const response = await worker.fetch(request({ secret, deadlineMs: 25, nowMs: start }), env(db, secret));
    const payload = await response.json();
    assert.equal(response.status, 408);
    assert.equal(payload.code, 'TRANSLATION_DEADLINE_EXCEEDED');
    assert.equal(payload.category, 'deadline');
    assert.equal(calls, 1, 'deadline exhaustion must prevent fallback provider #2');
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 1000, 'deadline failure must refund reserved source quota');
    sqlite.close();
  }

  // A content/quality rejection belongs to the request, not shared provider health.
  // Repeating it must not cool down Gemini for unrelated callers.
  {
    const { db, sqlite } = createD1(5000);
    let geminiCalls = 0;
    let mistralCalls = 0;
    const { worker } = loadWorker(async url => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        geminiCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      mistralCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Ciao' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    for (let i = 0; i < 2; i += 1) {
      const response = await worker.fetch(request({ secret, requestId: crypto.randomUUID(), deadlineMs: 30000 }), env(db, secret));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).text, 'Ciao');
    }
    const health = await worker.fetch(new Request('https://translate.invalid/health'), env(db, secret));
    const healthPayload = await health.json();
    assert.equal(healthPayload.models.gemini.failCount, 0, 'quality rejection must not increment shared provider fail count');
    assert.equal(healthPayload.models.gemini.healthy, true);
    assert.equal(geminiCalls, 2, 'Gemini must remain eligible after repeated request-specific quality rejection');
    assert.equal(mistralCalls, 2);
    sqlite.close();
  }

  // Missing deadline header remains compatible with existing clients.
  {
    const { db, sqlite } = createD1();
    const { worker } = loadWorker(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Ciao' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const response = await worker.fetch(request({ secret, deadlineMs: undefined }), env(db, secret));
    assert.equal(response.status, 200);
    sqlite.close();
  }

  assert.match(workerSource, /X-Geek-Deadline-Ms/);
  assert.match(workerSource, /Math\.min\(PROVIDER_TIMEOUT_MS, beforeAttempt\)/);
  assert.match(workerSource, /if \(error\?\.healthImpact === true\) markProviderFail/);
  console.log('TRANSLATION_WORKER_DEADLINE_FAULT_CLASS_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
