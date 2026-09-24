const DEFAULT_RECOVERY_LIMIT = 8;

function stalePredicate() {
  return `(status = 'reserved' OR status LIKE 'reserved:%')
    AND COALESCE(lease_expires_at, datetime(created_at, '+2 minutes')) <= datetime('now')`;
}

async function reclaimOne(db, row) {
  const requestId = String(row?.request_id || '');
  const userId = Number(row?.user_id);
  const reservedChars = Number(row?.reserved_chars);
  const status = String(row?.status || '');
  if (!requestId || !Number.isInteger(userId) || !Number.isFinite(reservedChars) || reservedChars < 0 || !status) return false;

  const stale = stalePredicate();
  const results = await db.batch([
    db.prepare(`UPDATE users
      SET quota_chars = quota_chars + ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM translation_usage
          WHERE request_id = ? AND user_id = ? AND reserved_chars = ? AND status = ?
            AND ${stale}
        )`).bind(reservedChars, userId, requestId, userId, reservedChars, status),
    db.prepare(`DELETE FROM translation_usage
      WHERE request_id = ? AND user_id = ? AND reserved_chars = ? AND status = ?
        AND ${stale}`).bind(requestId, userId, reservedChars, status),
  ]);
  return Boolean(results?.[1]?.meta?.changes);
}

export async function recoverStaleTranslationReservations(db, options = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') return { recovered: 0 };
  const rawLimit = Number(options.limit);
  const limit = Math.max(1, Math.min(50, Number.isInteger(rawLimit) ? rawLimit : DEFAULT_RECOVERY_LIMIT));
  const userId = Number(options.userId);
  const hasUser = Number.isInteger(userId) && userId > 0;
  const stale = stalePredicate();
  const query = hasUser
    ? `SELECT request_id, user_id, reserved_chars, status FROM translation_usage
       WHERE user_id = ? AND ${stale}
       ORDER BY created_at ASC LIMIT ?`
    : `SELECT request_id, user_id, reserved_chars, status FROM translation_usage
       WHERE ${stale}
       ORDER BY created_at ASC LIMIT ?`;
  const statement = hasUser ? db.prepare(query).bind(userId, limit) : db.prepare(query).bind(limit);
  const rows = await statement.all();
  let recovered = 0;
  for (const row of rows?.results || []) {
    if (await reclaimOne(db, row)) recovered += 1;
  }
  return { recovered };
}

export async function staleTranslationReservationSummary(db) {
  if (!db || typeof db.prepare !== 'function') return { count: 0, oldestAgeSeconds: 0 };
  const row = await db.prepare(`SELECT
      COUNT(*) AS count,
      COALESCE(MAX(CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER)), 0) AS oldest_age_seconds
    FROM translation_usage
    WHERE ${stalePredicate()}`).first();
  return {
    count: Math.max(0, Number(row?.count) || 0),
    oldestAgeSeconds: Math.max(0, Number(row?.oldest_age_seconds) || 0),
  };
}

export const TRANSLATION_RESERVATION_LEASE_SECONDS = 120;
