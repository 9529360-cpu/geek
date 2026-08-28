'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const policyPath = path.join(root, 'scripts', 'atomic-rate-limit.mjs');
const outerEntryPath = path.join(root, 'scripts', 'geek-subscription-atomic-entry.js');
const entryPath = path.join(root, 'scripts', 'geek-subscription-entry.js');
const wrapperPath = path.join(root, 'scripts', 'geek-subscription-worker.js');
const wranglerPath = path.join(root, 'wrangler-subscription.toml');

function createD1Adapter(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const prepared = (values = []) => ({
        bind(...nextValues) {
          return prepared(nextValues);
        },
        async first() {
          return statement.get(...values) || null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
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

(async () => {
  const policy = await import(`${pathToFileURL(policyPath).href}?contract=${Date.now()}`);
  const outerEntrySource = fs.readFileSync(outerEntryPath, 'utf8');
  const entrySource = fs.readFileSync(entryPath, 'utf8');
  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  const wranglerSource = fs.readFileSync(wranglerPath, 'utf8');

  assert.match(policy.ATOMIC_RATE_LIMIT_SQL, /INSERT INTO rate_limits/i);
  assert.match(policy.ATOMIC_RATE_LIMIT_SQL, /ON CONFLICT\(bucket\) DO UPDATE/i);
  assert.match(policy.ATOMIC_RATE_LIMIT_SQL, /WHERE rate_limits\.updated_at < \? OR rate_limits\.count < \?/i);
  assert.match(policy.ATOMIC_RATE_LIMIT_SQL, /RETURNING count/i);
  assert.doesNotMatch(policy.ATOMIC_RATE_LIMIT_SQL, /SELECT\s+count/i, 'authoritative gate must be one statement, not read-modify-write');

  assert.match(wranglerSource, /main\s*=\s*"scripts\/geek-subscription-atomic-entry\.js"/);
  assert.match(outerEntrySource, /requestRateLimited\(request, db\)/, 'production outer entry must enforce shared atomic gate');
  assert.match(outerEntrySource, /scopeLegacyRateLimitBypass\(db\)/, 'production outer entry must suppress legacy double counting');
  assert.match(wrapperSource, /requestRateLimited\(request, db\)/, 'direct core wrapper path must use same atomic gate');
  assert.match(wrapperSource, /isLegacyRateLimitBypass\(db\)/, 'nested production path must not consume a second attempt');
  assert.match(entrySource, /HASH_PREFIX = 'v4\$'/, 'Free Worker v4 HMAC password path must remain intact');
  assert.doesNotMatch(outerEntrySource, /PBKDF2|Argon2|bcrypt/i, 'outer gate must not add high-CPU password work');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  const db = createD1Adapter(sqlite);
  const start = Date.UTC(2026, 7, 28, 20, 0, 0);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(
      await policy.rateLimited(db, 'reset-request:203.0.113.8', 3, 3600, start + attempt * 1000),
      false,
      `attempt ${attempt} must be allowed`
    );
  }

  const beforeBlocked = sqlite.prepare('SELECT count, updated_at FROM rate_limits WHERE bucket = ?')
    .get('reset-request:203.0.113.8');
  assert.equal(beforeBlocked.count, 3);

  assert.equal(
    await policy.rateLimited(db, 'reset-request:203.0.113.8', 3, 3600, start + 4000),
    true,
    'N+1 attempt must be rejected atomically'
  );
  const afterBlocked = sqlite.prepare('SELECT count, updated_at FROM rate_limits WHERE bucket = ?')
    .get('reset-request:203.0.113.8');
  assert.deepEqual(afterBlocked, beforeBlocked, 'blocked traffic must not increment count or extend the window');

  assert.equal(
    await policy.rateLimited(db, 'reset-request:203.0.113.8', 3, 3600, start + 3604 * 1000),
    false,
    'expired window must atomically reset and allow the next request'
  );
  const resetRow = sqlite.prepare('SELECT count FROM rate_limits WHERE bucket = ?')
    .get('reset-request:203.0.113.8');
  assert.equal(resetRow.count, 1, 'expired bucket must restart from one');

  const request = new Request('https://admin.bbnba.com/api/register', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.7' },
  });
  assert.deepEqual(policy.rateLimitRuleForRequest(request), policy.AUTH_RATE_LIMIT_RULES['/api/register']);
  assert.equal(policy.clientIp(request), '198.51.100.7');
  assert.equal(policy.rateLimitRuleForRequest(new Request('https://admin.bbnba.com/health')), null);

  const bypassDb = policy.scopeLegacyRateLimitBypass(db);
  assert.equal(policy.isLegacyRateLimitBypass(bypassDb), true);
  assert.equal(policy.scopeLegacyRateLimitBypass(bypassDb), bypassDb, 'bypass scoping must be idempotent');
  const legacyRow = await bypassDb.prepare(policy.LEGACY_RATE_LIMIT_SQL.selectCount).bind('anything').first();
  assert.deepEqual(legacyRow, { count: 0 });
  const legacyUpdate = await bypassDb.prepare(policy.LEGACY_RATE_LIMIT_SQL.increment).bind('2026-08-28 20:00:00', 'anything').run();
  assert.equal(legacyUpdate.meta.changes, 0);

  const brandedDb = {
    prepare() { throw new Error('not used'); },
    async batch(value) {
      assert.equal(this, brandedDb, 'proxied D1 methods must keep the original binding receiver');
      return value;
    },
  };
  const brandedProxy = policy.scopeLegacyRateLimitBypass(brandedDb);
  assert.deepEqual(await brandedProxy.batch(['ok']), ['ok']);

  sqlite.close();
  console.log('ATOMIC_RATE_LIMIT_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
