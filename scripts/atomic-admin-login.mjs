const ADMIN_LOGIN_PATH = '/api/admin/login';
const ADMIN_FAILURE_LIMIT = 5;
const ADMIN_LOCK_MS = 15 * 60 * 1000;

const ATOMIC_ADMIN_LOGIN_SQL = `
  INSERT INTO admin_login_attempts (ip, fails, locked_until)
  VALUES (?, 1, NULL)
  ON CONFLICT(ip) DO UPDATE SET
    fails = CASE
      WHEN admin_login_attempts.locked_until IS NOT NULL
        AND admin_login_attempts.locked_until <= ? THEN 1
      WHEN admin_login_attempts.locked_until IS NULL
        AND admin_login_attempts.fails < 4 THEN admin_login_attempts.fails + 1
      WHEN admin_login_attempts.locked_until IS NULL
        AND admin_login_attempts.fails = 4 THEN 0
      ELSE admin_login_attempts.fails
    END,
    locked_until = CASE
      WHEN admin_login_attempts.locked_until IS NOT NULL
        AND admin_login_attempts.locked_until <= ? THEN NULL
      WHEN admin_login_attempts.locked_until IS NULL
        AND admin_login_attempts.fails = 4 THEN ?
      WHEN admin_login_attempts.locked_until IS NULL
        AND admin_login_attempts.fails >= 5 THEN ?
      ELSE admin_login_attempts.locked_until
    END
  WHERE admin_login_attempts.locked_until IS NULL
    OR admin_login_attempts.locked_until <= ?
  RETURNING fails, locked_until
`;

const LEGACY_ADMIN_LOGIN_SQL = Object.freeze({
  select: 'SELECT fails, locked_until FROM admin_login_attempts WHERE ip = ?',
  lock: 'UPDATE admin_login_attempts SET locked_until = ?, fails = 0 WHERE ip = ?',
  fail: 'INSERT INTO admin_login_attempts (ip, fails, locked_until) VALUES (?, 1, NULL) ON CONFLICT(ip) DO UPDATE SET fails = fails + 1',
});

const ADMIN_LOGIN_BYPASS_MARKER = Symbol.for('geek.atomicAdminLoginBypass');

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const LEGACY_ADMIN_SQL_KIND = new Map(
  Object.entries(LEGACY_ADMIN_LOGIN_SQL).map(([kind, sql]) => [normalizeSql(sql), kind])
);

function sqliteTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function isAdminLoginRequest(request) {
  if (!request || request.method !== 'POST') return false;
  try { return new URL(request.url).pathname === ADMIN_LOGIN_PATH; } catch { return false; }
}

async function reserveAdminLoginAttempt(db, ip, nowMs = Date.now()) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database is required');
  const now = sqliteTimestamp(nowMs);
  const lockedUntil = sqliteTimestamp(nowMs + ADMIN_LOCK_MS);
  const row = await db.prepare(ATOMIC_ADMIN_LOGIN_SQL)
    .bind(ip, now, now, lockedUntil, lockedUntil, now)
    .first();

  if (!row) return Object.freeze({ blocked: true, thresholdReached: false });

  // Normal fifth reservation deliberately stores fails=0 plus a future lock. That
  // lets the current fifth attempt finish while every later request is rejected.
  // A legacy row with fails>=5 and no lock is converted to a lock and rejected now.
  const legacyThreshold = Number(row.fails) >= ADMIN_FAILURE_LIMIT;
  return Object.freeze({
    blocked: legacyThreshold,
    thresholdReached: !legacyThreshold && Boolean(row.locked_until),
  });
}

function createLegacyAdminBypassStatement(kind) {
  const prepared = {
    bind() { return prepared; },
    async first() {
      // The outer atomic admission gate already decided whether this request may
      // enter password verification. Returning null prevents the old SELECT/check
      // from making a second, racy decision.
      return kind === 'select' ? null : null;
    },
    async all() { return { results: [] }; },
    async run() {
      return { success: true, results: [], meta: { changes: 0, last_row_id: 0 } };
    },
    async raw() { return []; },
  };
  return prepared;
}

function isLegacyAdminLoginBypass(db) {
  try { return Boolean(db?.[ADMIN_LOGIN_BYPASS_MARKER]); } catch { return false; }
}

function scopeLegacyAdminLoginBypass(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database is required');
  if (isLegacyAdminLoginBypass(db)) return db;
  return new Proxy(db, {
    get(target, property) {
      if (property === ADMIN_LOGIN_BYPASS_MARKER) return true;
      if (property === 'prepare') {
        return (sql) => {
          const kind = LEGACY_ADMIN_SQL_KIND.get(normalizeSql(sql));
          if (kind) return createLegacyAdminBypassStatement(kind);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export {
  ADMIN_FAILURE_LIMIT,
  ADMIN_LOCK_MS,
  ADMIN_LOGIN_PATH,
  ATOMIC_ADMIN_LOGIN_SQL,
  LEGACY_ADMIN_LOGIN_SQL,
  isAdminLoginRequest,
  reserveAdminLoginAttempt,
  isLegacyAdminLoginBypass,
  scopeLegacyAdminLoginBypass,
};
