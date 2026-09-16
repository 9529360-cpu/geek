'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createGatewayPool } = require('../src/gateway-failover.cjs');
const { createTranslationRuntime, unwrapTranslationIpcResponse } = require('../src/translation-runtime.cjs');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const PRIMARY = 'https://primary.example.test';
const BACKUP = 'https://backup.example.test';
const SECRET = 'runtime-outcome-reconciliation-secret';

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

function loadWorker(providerFetch) {
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
    fetch: providerFetch,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(workerSource.replace(/^export default\s*/m, 'this.__worker = '), sandbox, {
    filename: 'scripts/geek-translate-worker.js',
  });
  return sandbox.__worker;
}

(async () => {
  const { db, sqlite } = createD1();
  let providerCalls = 0;
  const worker = loadWorker(async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ciao' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const workerEnv = {
    JWT_SECRET: SECRET,
    GEMINI_API_KEY: 'test-provider-key',
    geek_subscriptions: db,
  };

  const gatewayCalls = [];
  let dropFirstCommittedResponse = true;
  const fetchImpl = async (url, options = {}) => {
    const endpoint = String(url).startsWith(PRIMARY) ? PRIMARY : BACKUP;
    const requestId = String(options.headers?.['X-Request-ID'] || '');
    const payload = JSON.parse(String(options.body || '{}'));
    gatewayCalls.push({ endpoint, requestId, payload });

    const request = new Request(`https://worker.invalid/v1/translate`, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });
    const response = await worker.fetch(request, workerEnv);
    if (dropFirstCommittedResponse) {
      dropFirstCommittedResponse = false;
      assert.equal(response.status, 200, 'fault injection must drop only an already-committed successful response');
      throw new Error('simulated_transport_loss_after_worker_commit');
    }
    return response;
  };

  const handlers = new Map();
  const runtime = createTranslationRuntime({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    fs: {
      async readFile() { throw Object.assign(new Error('missing cache'), { code: 'ENOENT' }); },
      async appendFile() {},
      async mkdir() {},
      async rename() {},
      async writeFile() {},
      async rm() {},
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(String(value)),
      decryptString: value => Buffer.from(value).toString(),
    },
    getUserDataDir: () => '/tmp/geek-translation-runtime-outcome-reconciliation',
    accountState: { findById: () => ({ partition: 'persist:runtime-outcome-reconciliation' }) },
    createGatewayPool,
    assertSafeTranslationOutput: ({ output }) => output,
    assertTrustedSender() {},
    assertValidAccountId() {},
    getSubscriptionStore: () => ({
      async getQuota() { return { remaining_chars: null }; },
      async getTranslationToken() { return tokenFor(); },
    }),
    fetchImpl,
    env: { GEEK_TRANSLATION_GATEWAY_URL: `${PRIMARY},${BACKUP}` },
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
  });
  runtime.install();

  const rawTranslate = handlers.get('translation:translate');
  const mainFrame = {};
  const sender = { id: 7, mainFrame };
  const result = unwrapTranslationIpcResponse(await rawTranslate({ sender, senderFrame: mainFrame }, {
    accountId: 'account-a',
    text: 'hello',
    source: 'en',
    target: 'it',
    route: 'default',
    refresh: true,
    skipQuota: true,
  }));

  assert.equal(result.text, 'ciao', 'desktop must recover the already-paid translation through endpoint failover');
  assert.equal(providerCalls, 1, 'reconciliation must replay the committed outcome instead of invoking the provider twice');
  assert.equal(gatewayCalls.length, 2, 'unknown primary outcome must reconcile through the next configured endpoint');
  assert.deepEqual(gatewayCalls.map(call => call.endpoint), [PRIMARY, BACKUP]);
  assert.deepEqual(
    gatewayCalls.map(call => call.requestId),
    ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'],
    'desktop endpoint failover must reuse one X-Request-ID for the logical operation'
  );
  assert.deepEqual(
    gatewayCalls.map(call => call.payload.operationRoute),
    ['default', 'default'],
    'desktop endpoint failover must keep the stable semantic route while the physical endpoint changes'
  );
  assert.deepEqual(
    gatewayCalls.map(call => call.payload.route),
    ['primary', 'backup'],
    'physical route metadata must still describe the endpoint actually attempted'
  );

  const quota = sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars;
  assert.equal(Number(quota), 91, 'source and target quota must be charged exactly once despite response loss');
  const usage = sqlite.prepare('SELECT status, target_chars, replay_ciphertext FROM translation_usage').get();
  assert.equal(usage.status, 'complete');
  assert.equal(Number(usage.target_chars), 4);
  assert.match(String(usage.replay_ciphertext), /^v1\./, 'committed outcome must remain recoverable as encrypted replay material');

  runtime.dispose();
  sqlite.close();
  console.log('TRANSLATION_RUNTIME_OUTCOME_RECONCILIATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
