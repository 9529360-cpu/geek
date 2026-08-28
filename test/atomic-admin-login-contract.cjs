'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const policyPath = path.join(root, 'scripts', 'atomic-admin-login.mjs');
const outerEntryPath = path.join(root, 'scripts', 'geek-subscription-atomic-entry.js');
const corePath = path.join(root, 'scripts', 'geek-subscription-worker-core.js');

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

(async () => {
  const policy = await import(`${pathToFileURL(policyPath).href}?contract=${Date.now()}`);
  const outerEntry = fs.readFileSync(outerEntryPath, 'utf8');
  const core = fs.readFileSync(corePath, 'utf8');

  assert.equal(policy.ADMIN_FAILURE_LIMIT, 5);
  assert.equal(policy.ADMIN_LOCK_MS, 15 * 60 * 1000);
  assert.match(policy.ATOMIC_ADMIN_LOGIN_SQL, /INSERT INTO admin_login_attempts/i);
  assert.match(policy.ATOMIC_ADMIN_LOGIN_SQL, /ON CONFLICT\(ip\) DO UPDATE/i);
  assert.match(policy.ATOMIC_ADMIN_LOGIN_SQL, /RETURNING fails, locked_until/i);
  assert.doesNotMatch(policy.ATOMIC_ADMIN_LOGIN_SQL, /SELECT\s+fails/i, 'admin admission must not use a check-then-increment read');

  assert.ok(
    normalizeSql(core).includes(normalizeSql(policy.LEGACY_ADMIN_LOGIN_SQL.select)),
    'legacy admin SELECT must stay pinned to the bypass contract'
  );
  assert.ok(
    normalizeSql(core).includes(normalizeSql(policy.LEGACY_ADMIN_LOGIN_SQL.lock)),
    'legacy admin lock UPDATE must stay pinned to the bypass contract'
  );
  assert.match(
    core,
    /"INSERT INTO admin_login_attempts \(ip, fails, locked_until\) VALUES \(\?, 1, NULL\) "\s*\+/,
    'legacy failure INSERT prefix must stay pinned to the bypass contract'
  );
  assert.match(
    core,
    /"ON CONFLICT\(ip\) DO UPDATE SET fails = fails \+ 1"/,
    'legacy failure UPSERT suffix must stay pinned to the bypass contract'
  );

  const reserveAt = outerEntry.indexOf('reserveAdminLoginAttempt(db, clientIp(request))');
  const delegateAt = outerEntry.indexOf('productionEntry.fetch(request, scopedEnv, ctx)');
  assert.ok(reserveAt >= 0 && delegateAt > reserveAt, 'atomic admin admission must run before password verification delegation');
  assert.match(outerEntry, /if \(admission\.blocked\) return json\(\{ error: 'too_many_attempts' \}, 429\)/);
  assert.match(outerEntry, /scopeLegacyAdminLoginBypass\(db\)/);
  assert.doesNotMatch(outerEntry, /ADMIN_PASSWORD\s*=|JWT_SECRET\s*=/, 'outer guard must not embed credentials');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE admin_login_attempts (
      ip TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );
  `);
  const db = createD1Adapter(sqlite);
  const start = Date.UTC(2026, 7, 28, 20, 0, 0);
  const ip = '203.0.113.44';

  const burst = await Promise.all(
    Array.from({ length: 6 }, () => policy.reserveAdminLoginAttempt(db, ip, start))
  );
  assert.deepEqual(
    burst.map((result) => result.blocked),
    [false, false, false, false, false, true],
    'only five concurrent reservations may reach the admin password verifier'
  );
  assert.equal(burst[4].thresholdReached, true, 'fifth reservation must arm the 15-minute lock for later requests');

  const lockedRow = sqlite.prepare('SELECT fails, locked_until FROM admin_login_attempts WHERE ip = ?').get(ip);
  assert.equal(lockedRow.fails, 0, 'threshold transition stores the same reset counter shape used by the legacy lock state');
  assert.ok(lockedRow.locked_until, 'fifth reservation must persist a lock deadline');

  assert.equal(
    (await policy.reserveAdminLoginAttempt(db, ip, start + policy.ADMIN_LOCK_MS - 1000)).blocked,
    true,
    'request before the 15-minute deadline must remain blocked'
  );
  assert.equal(
    (await policy.reserveAdminLoginAttempt(db, ip, start + policy.ADMIN_LOCK_MS)).blocked,
    false,
    'expired lock must atomically reset and admit the next request'
  );
  const resetRow = sqlite.prepare('SELECT fails, locked_until FROM admin_login_attempts WHERE ip = ?').get(ip);
  assert.equal(resetRow.fails, 1);
  assert.equal(resetRow.locked_until, null);

  sqlite.prepare('INSERT OR REPLACE INTO admin_login_attempts (ip, fails, locked_until) VALUES (?, 5, NULL)')
    .run('198.51.100.9');
  const legacy = await policy.reserveAdminLoginAttempt(db, '198.51.100.9', start);
  assert.equal(legacy.blocked, true, 'legacy fails>=5 state must fail closed instead of granting one extra password check');
  const legacyRow = sqlite.prepare('SELECT fails, locked_until FROM admin_login_attempts WHERE ip = ?').get('198.51.100.9');
  assert.equal(legacyRow.fails, 5);
  assert.ok(legacyRow.locked_until, 'legacy threshold state must be converted to an active lock');

  sqlite.prepare('INSERT OR REPLACE INTO admin_login_attempts (ip, fails, locked_until) VALUES (?, 2, NULL)')
    .run('192.0.2.7');
  const bypass = policy.scopeLegacyAdminLoginBypass(db);
  assert.equal(policy.isLegacyAdminLoginBypass(bypass), true);
  assert.equal(policy.scopeLegacyAdminLoginBypass(bypass), bypass, 'admin bypass scoping must be idempotent');
  assert.equal(
    await bypass.prepare(policy.LEGACY_ADMIN_LOGIN_SQL.select).bind('192.0.2.7').first(),
    null,
    'legacy pre-check must not make a second admission decision'
  );
  const failNoop = await bypass.prepare(policy.LEGACY_ADMIN_LOGIN_SQL.fail).bind('192.0.2.7').run();
  assert.equal(failNoop.meta.changes, 0, 'legacy failure increment must not double-count the atomic reservation');

  // Success cleanup is intentionally not bypassed: the existing core DELETE must
  // remain real so a correct admin password resets all prior failure/lock state.
  await bypass.prepare('DELETE FROM admin_login_attempts WHERE ip = ?').bind('192.0.2.7').run();
  assert.equal(sqlite.prepare('SELECT fails FROM admin_login_attempts WHERE ip = ?').get('192.0.2.7'), undefined);

  assert.equal(policy.isAdminLoginRequest(new Request('https://admin.bbnba.com/api/admin/login', { method: 'POST' })), true);
  assert.equal(policy.isAdminLoginRequest(new Request('https://admin.bbnba.com/api/admin/users', { method: 'GET' })), false);

  sqlite.close();
  console.log('ATOMIC_ADMIN_LOGIN_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
