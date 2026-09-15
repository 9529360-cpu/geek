'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');

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
      lease_expires_at TEXT
    );
    INSERT INTO users (id, status, quota_chars) VALUES (42, 'active', 100), (43, 'active', 100);
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
          return { success: true, meta: { changes: Number(result.changes) }, results: [] };
        },
      };
    }
    return bound();
  }

  let batchTail = Promise.resolve();
  return {
    sqlite,
    db: {
      prepare,
      batch(statements) {
        const run = batchTail.then(async () => {
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
        });
        batchTail = run.then(() => undefined, () => undefined);
        return run;
      },
    },
  };
}

function addReservation(sqlite, { requestId, userId = 42, chars = 5, status = 'reserved:test', stale = true }) {
  sqlite.prepare('UPDATE users SET quota_chars = quota_chars - ? WHERE id = ?').run(chars, userId);
  sqlite.prepare(`INSERT INTO translation_usage
    (request_id, user_id, reserved_chars, status, created_at, lease_expires_at)
    VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`)
    .run(requestId, userId, chars, status, stale ? '-5 minutes' : '0 minutes', stale ? '-3 minutes' : '+2 minutes');
}

(async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'scripts', 'translation-reservation-recovery.mjs')).href;
  const { recoverStaleTranslationReservations, staleTranslationReservationSummary, TRANSLATION_RESERVATION_LEASE_SECONDS } = await import(moduleUrl);
  assert.equal(TRANSLATION_RESERVATION_LEASE_SECONDS, 120, 'lease must remain safely above the 30s translation request budget');

  {
    const { db, sqlite } = createD1();
    addReservation(sqlite, { requestId: 'stale-a' });
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 95);
    const first = await recoverStaleTranslationReservations(db, { userId: 42, limit: 8 });
    assert.equal(first.recovered, 1);
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 100, 'stale source debit must be refunded exactly once');
    assert.equal(sqlite.prepare('SELECT 1 FROM translation_usage WHERE request_id = ?').get('stale-a'), undefined, 'recovered owner row must be deleted so the request can safely retry');
    const second = await recoverStaleTranslationReservations(db, { userId: 42, limit: 8 });
    assert.equal(second.recovered, 0);
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 100, 'repeat cleanup must not double-refund');
    sqlite.close();
  }

  {
    const { db, sqlite } = createD1();
    addReservation(sqlite, { requestId: 'race-a' });
    const [left, right] = await Promise.all([
      recoverStaleTranslationReservations(db, { userId: 42, limit: 8 }),
      recoverStaleTranslationReservations(db, { userId: 42, limit: 8 }),
    ]);
    assert.equal(left.recovered + right.recovered, 1, 'concurrent recovery passes must claim one stale owner exactly once');
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 100, 'concurrent recovery must refund the source debit exactly once');
    assert.equal(sqlite.prepare('SELECT 1 FROM translation_usage WHERE request_id = ?').get('race-a'), undefined, 'the winning recovery transaction must remove the stale owner row');
    sqlite.close();
  }

  {
    const { db, sqlite } = createD1();
    addReservation(sqlite, { requestId: 'live-a', stale: false });
    const result = await recoverStaleTranslationReservations(db, { userId: 42 });
    assert.equal(result.recovered, 0, 'live reservation must never be reclaimed');
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 95);
    assert.ok(sqlite.prepare('SELECT 1 FROM translation_usage WHERE request_id = ?').get('live-a'));
    sqlite.close();
  }

  {
    const { db, sqlite } = createD1();
    addReservation(sqlite, { requestId: 'user-42', userId: 42 });
    addReservation(sqlite, { requestId: 'user-43', userId: 43 });
    const result = await recoverStaleTranslationReservations(db, { userId: 42 });
    assert.equal(result.recovered, 1);
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 42').get().quota_chars, 100);
    assert.equal(sqlite.prepare('SELECT quota_chars FROM users WHERE id = 43').get().quota_chars, 95, 'user-scoped cleanup must not touch another user');
    assert.ok(sqlite.prepare('SELECT 1 FROM translation_usage WHERE request_id = ?').get('user-43'));
    const summary = await staleTranslationReservationSummary(db);
    assert.equal(summary.count, 1, 'non-sensitive observability must expose remaining stale count');
    assert.ok(summary.oldestAgeSeconds >= 120);
    sqlite.close();
  }

  const migration = fs.readFileSync(path.join(root, 'scripts', 'migrations', '005-translation-reservation-lease.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-schema.sql'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-entry.js'), 'utf8');
  assert.match(migration, /ALTER TABLE translation_usage ADD COLUMN lease_expires_at TEXT/);
  assert.match(migration, /datetime\('now', '\+2 minutes'\)/, 'migration trigger must issue a bounded durable lease');
  assert.match(schema, /trg_translation_usage_reservation_lease/, 'fresh schema and migration must agree on lease ownership');
  assert.match(entry, /verifiedTranslationUserId[\s\S]*recoverStaleTranslationReservations\(workerDb, \{ userId, limit: 8 \}\)/, 'request-path recovery must only run after trusted JWT identity is known');
  assert.match(entry, /recoverStaleTranslationReservations\(scopedEnv\.geek_subscriptions, \{ limit: 50 \}\)/, 'scheduled maintenance path must stay bounded');

  console.log('TRANSLATION_RESERVATION_RECOVERY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
