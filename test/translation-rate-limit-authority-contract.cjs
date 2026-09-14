'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const compatPath = path.join(root, 'scripts', 'translation-rate-limit-compat.mjs');
const workerPath = path.join(root, 'scripts', 'geek-translate-worker.js');
const entryPath = path.join(root, 'scripts', 'geek-translate-entry.js');
const wranglerPath = path.join(root, 'wrangler-translate.toml');
const deployPath = path.join(root, '.github', 'workflows', 'deploy-translate.yml');

function createD1Adapter(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const prepared = (values = []) => ({
        bind(...nextValues) { return prepared(nextValues); },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values) }; },
        async run() {
          const result = statement.run(...values);
          return {
            success: true,
            results: [],
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

async function legacyTranslationRateLimited(db, policy, bucket, limit, windowSec, nowMs) {
  const stamp = new Date(nowMs).toISOString().slice(0, 19).replace('T', ' ');
  const cutoff = new Date(nowMs - windowSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await db.prepare(policy.TRANSLATION_RATE_LIMIT_SQL.select).bind(bucket).first();
  if (!row || row.updated_at < cutoff) {
    await db.prepare(policy.TRANSLATION_RATE_LIMIT_SQL.reset).bind(bucket, stamp).run();
    return false;
  }
  if (row.count >= limit) return true;
  await db.prepare(policy.TRANSLATION_RATE_LIMIT_SQL.increment).bind(stamp, bucket).run();
  return false;
}

(async () => {
  const policy = await import(`${pathToFileURL(compatPath).href}?contract=${Date.now()}`);
  const worker = fs.readFileSync(workerPath, 'utf8');
  const entry = fs.readFileSync(entryPath, 'utf8');
  const wrangler = fs.readFileSync(wranglerPath, 'utf8');
  const deploy = fs.readFileSync(deployPath, 'utf8');

  for (const sql of Object.values(policy.TRANSLATION_RATE_LIMIT_SQL)) {
    assert.ok(
      normalizeSql(worker).includes(normalizeSql(sql)),
      `compatibility owner must match the live translation limiter SQL: ${sql}`
    );
  }
  assert.match(worker, /rateLimited\(db, `translate:user:\$\{auth\.uid\}`, 30, 60\)/, 'user limit must remain 30 per 60 seconds');
  assert.match(worker, /rateLimited\(db, `translate:ip:\$\{clientIp\(request\)\}`, 60, 60\)/, 'IP limit must remain 60 per 60 seconds');
  assert.match(worker, /return json\(\{ error: 'rate_limited' \}, 429/, 'blocked translation requests must remain HTTP 429');

  assert.match(entry, /scopeTranslationRateLimitAuthority\(db\)/, 'production entry must scope D1 through the atomic translation rate-limit authority');
  assert.match(
    entry,
    /const workerEnv = db && typeof db\.prepare === 'function'\s*\? withTranslationDatabase\(env, scopeTranslationRateLimitAuthority\(db\)\)\s*:\s*env;/,
    'entry must derive the base Worker environment from the atomic translation rate-limit scope'
  );
  assert.match(
    entry,
    /const response = await baseWorker\.fetch\(request, workerEnv, ctx\);/,
    'entry must preserve the existing translation Worker behind the scoped D1 binding before any response projection'
  );
  assert.match(wrangler, /^main = "scripts\/geek-translate-entry\.js"$/m, 'Wrangler must deploy the atomic translation entry');
  for (const requiredPath of [
    "'scripts/geek-translate-entry.js'",
    "'scripts/geek-translate-worker.js'",
    "'scripts/translation-rate-limit-compat.mjs'",
    "'scripts/atomic-rate-limit.mjs'",
    "'wrangler-translate.toml'",
  ]) {
    assert.ok(deploy.includes(requiredPath), `deploy-translate must track production dependency ${requiredPath}`);
  }

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  const rawDb = createD1Adapter(sqlite);
  let nowMs = Date.UTC(2026, 8, 13, 18, 10, 0);
  const db = policy.scopeTranslationRateLimitAuthority(rawDb, { now: () => nowMs });

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    nowMs += 500;
    assert.equal(
      await legacyTranslationRateLimited(db, policy, 'translate:user:42', 30, 60, nowMs),
      false,
      `user attempt ${attempt} must be allowed`
    );
  }
  const userAtLimit = sqlite.prepare('SELECT count, updated_at FROM rate_limits WHERE bucket = ?').get('translate:user:42');
  assert.equal(userAtLimit.count, 30, 'authoritative user bucket must reach exactly the configured limit');
  nowMs += 500;
  assert.equal(
    await legacyTranslationRateLimited(db, policy, 'translate:user:42', 30, 60, nowMs),
    true,
    'user attempt 31 must be blocked atomically'
  );
  assert.deepEqual(
    sqlite.prepare('SELECT count, updated_at FROM rate_limits WHERE bucket = ?').get('translate:user:42'),
    userAtLimit,
    'blocked user traffic must not increment count or extend the window'
  );

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    nowMs += 250;
    assert.equal(
      await legacyTranslationRateLimited(db, policy, 'translate:ip:203.0.113.77', 60, 60, nowMs),
      false,
      `IP attempt ${attempt} must be allowed`
    );
  }
  const ipAtLimit = sqlite.prepare('SELECT count FROM rate_limits WHERE bucket = ?').get('translate:ip:203.0.113.77');
  assert.equal(ipAtLimit.count, 60, 'authoritative IP bucket must reach exactly the configured limit');
  nowMs += 250;
  assert.equal(
    await legacyTranslationRateLimited(db, policy, 'translate:ip:203.0.113.77', 60, 60, nowMs),
    true,
    'IP attempt 61 must be blocked atomically'
  );

  nowMs += 61 * 1000;
  assert.equal(
    await legacyTranslationRateLimited(db, policy, 'translate:user:42', 30, 60, nowMs),
    false,
    'expired user bucket must reset and allow a new request'
  );
  assert.equal(
    sqlite.prepare('SELECT count FROM rate_limits WHERE bucket = ?').get('translate:user:42').count,
    1,
    'expired bucket must restart from one'
  );

  const passthroughInsert = await db.prepare('INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, ?, ?)')
    .bind('unrelated:test', 7, '2026-09-13 18:10:00')
    .run();
  assert.equal(passthroughInsert.meta.changes, 1, 'unrelated D1 statements must pass through untouched');

  await db.prepare(policy.TRANSLATION_RATE_LIMIT_SQL.reset)
    .bind('unrelated:legacy', '2026-09-13 18:11:00')
    .run();
  await db.prepare(policy.TRANSLATION_RATE_LIMIT_SQL.increment)
    .bind('2026-09-13 18:11:01', 'unrelated:legacy')
    .run();
  assert.equal(
    sqlite.prepare('SELECT count FROM rate_limits WHERE bucket = ?').get('unrelated:legacy').count,
    2,
    'legacy-shaped SQL for unrelated buckets must pass through instead of being neutralized'
  );

  sqlite.close();
  console.log('TRANSLATION_RATE_LIMIT_AUTHORITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
