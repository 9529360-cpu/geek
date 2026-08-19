const ALLOWED_ORDER_PAY_METHODS = new Set(['manual', 'usdt']);

export const LEGACY_PENDING_ORDER_SQL =
  "SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' ORDER BY id DESC LIMIT 1";

export const SCOPED_PENDING_ORDER_SQL =
  "SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' " +
  "AND COALESCE(NULLIF(pay_method, ''), 'manual') = ? ORDER BY id DESC LIMIT 1";

export function normalizeRequestedPayMethod(value, provided = false) {
  if (!provided) return 'manual';
  return ALLOWED_ORDER_PAY_METHODS.has(value) ? value : null;
}

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const NORMALIZED_LEGACY_PENDING_ORDER_SQL = normalizeSql(LEGACY_PENDING_ORDER_SQL);

export function isLegacyPendingOrderQuery(sql) {
  return normalizeSql(sql) === NORMALIZED_LEGACY_PENDING_ORDER_SQL;
}

export function scopePendingOrderReuse(db, payMethod) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database binding is required');
  if (!ALLOWED_ORDER_PAY_METHODS.has(payMethod)) throw new TypeError('Unsupported order pay method');

  return new Proxy(db, {
    get(target, property) {
      if (property !== 'prepare') {
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (sql) => {
        if (!isLegacyPendingOrderQuery(sql)) return target.prepare(sql);

        const statement = target.prepare(SCOPED_PENDING_ORDER_SQL);
        return new Proxy(statement, {
          get(prepared, method) {
            if (method === 'bind') {
              return (...values) => prepared.bind(...values, payMethod);
            }
            const value = prepared[method];
            return typeof value === 'function' ? value.bind(prepared) : value;
          },
        });
      };
    },
  });
}
