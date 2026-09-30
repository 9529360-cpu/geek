'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');

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
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, status, quota_chars) VALUES (42, 'active', 5000);
  `);

  function prepare(sql) {
    const text = String(sql);
    function bound(values = []) {
      return {
        sql: text,
        values,
        bind(...nextValues) { return bound(nextValues); },
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
        const results = [];
        sqlite.exec('BEGIN IMMEDIATE');
        try {
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

function tokenFor(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    aud: 'geek-translate',
    purpose: 'translate',
    iat: now,
    exp: now + 300,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function translateRequest(secret) {
  return new Request('https://translate.invalid/v1/translate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor(42, secret)}`,
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      'X-Geek-Deadline-Ms': '30000',
      'CF-Connecting-IP': '203.0.113.42',
    },
    body: JSON.stringify({
      text: '你好',
      source: 'auto',
      target: 'it',
      provider: 'auto',
      route: 'default',
    }),
  });
}

function loadWorker(fetchImpl) {
  const executable = workerSource.replace(/^export default\s*/m, 'this.__worker = ');
  const sandbox = {
    Request,
    Response,
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
  vm.createContext(sandbox);
  vm.runInContext(`${executable}\nthis.__qualityHooks = { providerQualityError, shouldAffectProviderHealth };`, sandbox, {
    filename: 'scripts/geek-translate-worker.js',
  });
  assert.equal(typeof sandbox.__worker?.fetch, 'function');
  return { worker: sandbox.__worker, hooks: sandbox.__qualityHooks };
}

(async () => {
  const secret = 'translation-health-isolation-secret';
  const { db, sqlite } = createD1();
  let geminiCalls = 0;
  let mistralCalls = 0;

  const { worker, hooks } = loadWorker(async (url) => {
    const value = String(url);
    if (value.includes('generativelanguage.googleapis.com')) {
      geminiCalls += 1;
      // Same CJK source text is a request-specific quality rejection for target=it.
      return new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value.includes('api.mistral.ai')) {
      mistralCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Ciao' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected provider URL: ${value}`);
  });

  const qualityError = hooks.providerQualityError({ id: 'gemini' }, new Error('bad output'));
  assert.equal(qualityError.code, 'provider_quality_rejected');
  assert.equal(hooks.shouldAffectProviderHealth(qualityError), false);
  assert.equal(hooks.shouldAffectProviderHealth(new Error('transport failure')), true);

  const env = {
    JWT_SECRET: secret,
    GEMINI_API_KEY: 'gemini-test-key',
    MISTRAL_API_KEY: 'mistral-test-key',
    geek_subscriptions: db,
  };

  for (let index = 0; index < 2; index += 1) {
    const response = await worker.fetch(translateRequest(secret), env);
    assert.equal(response.status, 200, `request ${index + 1} must fail over to Mistral successfully`);
    const payload = await response.json();
    assert.equal(payload.text, 'Ciao');
    assert.equal(payload.engine, 'mistral');
  }

  const healthResponse = await worker.fetch(new Request('https://translate.invalid/health'), env);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.models.gemini.failCount, 0,
    'request-specific output rejection must not increment shared Gemini health failures');
  assert.equal(health.models.gemini.healthy, true,
    'request-specific output rejection must not cool down Gemini');
  assert.equal(geminiCalls, 2,
    'Gemini must remain eligible on the next request after repeated output-quality rejection');
  assert.equal(mistralCalls, 2,
    'quality rejection may still fail over within the same request deadline');

  sqlite.close();

  assert.match(workerSource, /throw providerQualityError\(provider, error\)/,
    'quality validation must preserve a non-health-impacting fault class');
  assert.match(workerSource, /if \(shouldAffectProviderHealth\(error\)\) markProviderFail/,
    'provider health mutation must be gated by fault class');
  assert.doesNotMatch(workerSource, /export\s*\{[^}]*providerQualityError/,
    'test helpers must remain module-private in the production Worker');

  console.log('TRANSLATION_PROVIDER_HEALTH_ISOLATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
