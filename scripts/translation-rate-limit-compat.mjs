import { rateLimited as atomicRateLimited } from './atomic-rate-limit.mjs';

export const TRANSLATION_RATE_LIMIT_SQL = Object.freeze({
  select: 'SELECT count, updated_at FROM rate_limits WHERE bucket = ?',
  reset: 'INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, updated_at = excluded.updated_at',
  increment: 'UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?',
});

const TRANSLATION_RULES = Object.freeze([
  Object.freeze({ prefix: 'translate:user:', limit: 30, windowSec: 60 }),
  Object.freeze({ prefix: 'translate:ip:', limit: 60, windowSec: 60 }),
]);

// Background display translation is intentionally admitted below the existing
// total limits. This reserves nominal headroom for user-triggered outgoing sends
// without raising the abuse ceiling or creating a second billing authority.
const TRANSLATION_BACKGROUND_RULES = Object.freeze([
  Object.freeze({ sourcePrefix: 'translate:user:', prefix: 'translate:bg:user:', limit: 20, windowSec: 60 }),
  Object.freeze({ sourcePrefix: 'translate:ip:', prefix: 'translate:bg:ip:', limit: 40, windowSec: 60 }),
]);

function normalizeTranslationIntent(value) {
  return value === 'outgoing-send' ? 'outgoing-send' : 'message-display';
}

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const NORMALIZED_SQL = Object.freeze({
  select: normalizeSql(TRANSLATION_RATE_LIMIT_SQL.select),
  reset: normalizeSql(TRANSLATION_RATE_LIMIT_SQL.reset),
  increment: normalizeSql(TRANSLATION_RATE_LIMIT_SQL.increment),
});

function ruleForBucket(bucket) {
  const value = String(bucket || '');
  return TRANSLATION_RULES.find((rule) => value.startsWith(rule.prefix)) || null;
}

function backgroundRuleForBucket(bucket) {
  const value = String(bucket || '');
  const rule = TRANSLATION_BACKGROUND_RULES.find((candidate) => value.startsWith(candidate.sourcePrefix));
  if (!rule) return null;
  return Object.freeze({
    ...rule,
    bucket: rule.prefix + value.slice(rule.sourcePrefix.length),
  });
}

function sqliteTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function noopPreparedStatement() {
  const prepared = {
    bind() { return prepared; },
    async first() { return null; },
    async all() { return { results: [] }; },
    async run() {
      return { success: true, results: [], meta: { changes: 0, last_row_id: 0 } };
    },
    async raw() { return []; },
  };
  return prepared;
}

function authoritativeSelectStatement(db, now, intent) {
  return {
    bind(bucket) {
      const rule = ruleForBucket(bucket);
      if (!rule) return db.prepare(TRANSLATION_RATE_LIMIT_SQL.select).bind(bucket);
      return {
        async first() {
          const nowMs = Number(now());
          if (intent === 'message-display') {
            const backgroundRule = backgroundRuleForBucket(bucket);
            if (backgroundRule) {
              const backgroundBlocked = await atomicRateLimited(
                db,
                backgroundRule.bucket,
                backgroundRule.limit,
                backgroundRule.windowSec,
                nowMs,
              );
              if (backgroundBlocked) {
                return {
                  count: rule.limit,
                  updated_at: sqliteTimestamp(nowMs),
                };
              }
            }
          }
          const blocked = await atomicRateLimited(db, String(bucket), rule.limit, rule.windowSec, nowMs);
          return {
            count: blocked ? rule.limit : 0,
            updated_at: sqliteTimestamp(nowMs),
          };
        },
        async all() {
          const row = await this.first();
          return { results: row ? [row] : [] };
        },
      };
    },
  };
}

function compatibilityWriteStatement(db, sql, bucketIndex) {
  return {
    bind(...values) {
      const bucket = values[bucketIndex];
      if (!ruleForBucket(bucket)) return db.prepare(sql).bind(...values);
      return noopPreparedStatement();
    },
  };
}

export function scopeTranslationRateLimitAuthority(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database is required');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const intent = normalizeTranslationIntent(options.intent);

  return new Proxy(db, {
    get(target, property) {
      if (property !== 'prepare') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (sql) => {
        const normalized = normalizeSql(sql);
        if (normalized === NORMALIZED_SQL.select) return authoritativeSelectStatement(target, now, intent);
        if (normalized === NORMALIZED_SQL.reset) return compatibilityWriteStatement(target, sql, 0);
        if (normalized === NORMALIZED_SQL.increment) return compatibilityWriteStatement(target, sql, 1);
        return target.prepare(sql);
      };
    },
  });
}

export {
  TRANSLATION_RULES,
  TRANSLATION_BACKGROUND_RULES,
  normalizeTranslationIntent,
  backgroundRuleForBucket,
};
