const AUTH_RATE_LIMIT_RULES = Object.freeze({
  '/api/register': Object.freeze({ bucketPrefix: 'reg', limit: 5, windowSec: 60 }),
  '/api/login': Object.freeze({ bucketPrefix: 'login', limit: 10, windowSec: 60 }),
  '/api/password-reset/request': Object.freeze({ bucketPrefix: 'reset-request', limit: 3, windowSec: 3600 }),
  '/api/password-reset/complete': Object.freeze({ bucketPrefix: 'reset-complete', limit: 10, windowSec: 3600 }),
});

const ATOMIC_RATE_LIMIT_SQL = `
  INSERT INTO rate_limits (bucket, count, updated_at)
  VALUES (?, 1, ?)
  ON CONFLICT(bucket) DO UPDATE SET
    count = CASE
      WHEN rate_limits.updated_at < ? THEN 1
      ELSE rate_limits.count + 1
    END,
    updated_at = ?
  WHERE rate_limits.updated_at < ? OR rate_limits.count < ?
  RETURNING count
`;

const LEGACY_RATE_LIMIT_SQL = Object.freeze({
  deleteExpired: 'DELETE FROM rate_limits WHERE updated_at < ?',
  selectCount: 'SELECT count FROM rate_limits WHERE bucket = ?',
  insertFirst: 'INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?)',
  increment: 'UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?',
});

const RATE_LIMIT_BYPASS_MARKER = Symbol.for('geek.atomicRateLimitBypass');

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const LEGACY_SQL_KIND = new Map(
  Object.entries(LEGACY_RATE_LIMIT_SQL).map(([kind, sql]) => [normalizeSql(sql), kind])
);

function sqliteTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function rateLimitRuleForRequest(request) {
  if (!request || request.method !== 'POST') return null;
  let path;
  try { path = new URL(request.url).pathname; } catch { return null; }
  return AUTH_RATE_LIMIT_RULES[path] || null;
}

async function rateLimited(db, bucket, limit, windowSec, nowMs = Date.now()) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database is required');
  if (!Number.isInteger(limit) || limit <= 0) throw new TypeError('limit must be a positive integer');
  if (!Number.isInteger(windowSec) || windowSec <= 0) throw new TypeError('windowSec must be a positive integer');

  const stamp = sqliteTimestamp(nowMs);
  const cutoff = sqliteTimestamp(nowMs - windowSec * 1000);
  const row = await db.prepare(ATOMIC_RATE_LIMIT_SQL)
    .bind(bucket, stamp, cutoff, stamp, cutoff, limit)
    .first();

  // INSERT/allowed UPDATE returns one row. When an existing live bucket is already
  // at the limit, the DO UPDATE WHERE clause becomes a no-op and RETURNING emits no
  // row, so blocked traffic neither increments count nor extends the sliding window.
  return !row;
}

async function requestRateLimited(request, db, nowMs = Date.now()) {
  const rule = rateLimitRuleForRequest(request);
  if (!rule) return false;
  const bucket = `${rule.bucketPrefix}:${clientIp(request)}`;
  return rateLimited(db, bucket, rule.limit, rule.windowSec, nowMs);
}

function createLegacyBypassStatement(kind) {
  const prepared = {
    bind() { return prepared; },
    async first() {
      // Make the legacy limiter believe a zero-count row already exists so it reaches
      // its UPDATE branch; that UPDATE is also a no-op here. The shared atomic gate
      // has already made the only authoritative decision for this request.
      return kind === 'selectCount' ? { count: 0 } : null;
    },
    async all() {
      return { results: kind === 'selectCount' ? [{ count: 0 }] : [] };
    },
    async run() {
      return { success: true, results: [], meta: { changes: 0, last_row_id: 0 } };
    },
    async raw() {
      return kind === 'selectCount' ? [[0]] : [];
    },
  };
  return prepared;
}

function isLegacyRateLimitBypass(db) {
  try { return Boolean(db?.[RATE_LIMIT_BYPASS_MARKER]); } catch { return false; }
}

function scopeLegacyRateLimitBypass(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database is required');
  if (isLegacyRateLimitBypass(db)) return db;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === RATE_LIMIT_BYPASS_MARKER) return true;
      if (property === 'prepare') {
        return (sql) => {
          const kind = LEGACY_SQL_KIND.get(normalizeSql(sql));
          if (kind) return createLegacyBypassStatement(kind);
          return target.prepare(sql);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export {
  AUTH_RATE_LIMIT_RULES,
  ATOMIC_RATE_LIMIT_SQL,
  LEGACY_RATE_LIMIT_SQL,
  RATE_LIMIT_BYPASS_MARKER,
  clientIp,
  rateLimitRuleForRequest,
  rateLimited,
  requestRateLimited,
  isLegacyRateLimitBypass,
  scopeLegacyRateLimitBypass,
};
