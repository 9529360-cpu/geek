const ALLOWED_ORDER_PAY_METHODS = new Set(['manual', 'usdt']);

export const LEGACY_PENDING_ORDER_SQL =
  "SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' ORDER BY id DESC LIMIT 1";

export const SCOPED_PENDING_ORDER_SQL =
  "SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status = 'pending' " +
  "AND COALESCE(NULLIF(pay_method, ''), 'manual') = ? ORDER BY id DESC LIMIT 1";

export const LEGACY_ORDER_INSERT_SQL =
  'INSERT INTO orders (user_id, plan, amount, currency, pay_method, amount_cents) VALUES (?, ?, ?, ?, ?, ?)';

export const ATOMIC_USDT_ORDER_INSERT_SQL =
  "INSERT INTO orders (user_id, plan, amount, currency, pay_method, amount_cents) " +
  "SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
  "SELECT 1 FROM orders WHERE pay_method = 'usdt' " +
  "AND status IN ('pending', 'processing') AND amount_cents = ?" +
  ")";

export const USDT_PAYMENT_SLOTS_EXHAUSTED = 'USDT_PAYMENT_SLOTS_EXHAUSTED';
const USDT_DISCOUNT_SLOTS = 100;

export function normalizeRequestedPayMethod(value, provided = false) {
  if (!provided) return 'manual';
  return ALLOWED_ORDER_PAY_METHODS.has(value) ? value : null;
}

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const NORMALIZED_LEGACY_PENDING_ORDER_SQL = normalizeSql(LEGACY_PENDING_ORDER_SQL);
const NORMALIZED_LEGACY_ORDER_INSERT_SQL = normalizeSql(LEGACY_ORDER_INSERT_SQL);

export function isLegacyPendingOrderQuery(sql) {
  return normalizeSql(sql) === NORMALIZED_LEGACY_PENDING_ORDER_SQL;
}

export function isLegacyOrderInsert(sql) {
  return normalizeSql(sql) === NORMALIZED_LEGACY_ORDER_INSERT_SQL;
}

function usdtAmountCandidates(amountUsd, preferredAmountCents) {
  const priceCents = Math.round(Number(amountUsd) * 100);
  if (!Number.isSafeInteger(priceCents) || priceCents <= USDT_DISCOUNT_SLOTS) {
    throw new TypeError('Invalid USDT order amount');
  }

  const preferred = Number(preferredAmountCents);
  const preferredDiscount = priceCents - preferred;
  const firstDiscount = Number.isSafeInteger(preferredDiscount) &&
    preferredDiscount >= 1 && preferredDiscount <= USDT_DISCOUNT_SLOTS
    ? preferredDiscount
    : 1;

  const candidates = [];
  for (let index = 0; index < USDT_DISCOUNT_SLOTS; index += 1) {
    const discount = ((firstDiscount - 1 + index) % USDT_DISCOUNT_SLOTS) + 1;
    candidates.push(priceCents - discount);
  }
  return candidates;
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

export function scopeUsdtOrderAmountAllocation(db, payMethod) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 database binding is required');
  if (!ALLOWED_ORDER_PAY_METHODS.has(payMethod)) throw new TypeError('Unsupported order pay method');
  if (payMethod !== 'usdt') return db;

  return new Proxy(db, {
    get(target, property) {
      if (property !== 'prepare') {
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (sql) => {
        if (!isLegacyOrderInsert(sql)) return target.prepare(sql);

        return {
          bind(...values) {
            if (values[4] !== 'usdt') throw new TypeError('Unexpected order pay method');
            const candidates = usdtAmountCandidates(values[2], values[5]);
            return {
              async run() {
                for (const amountCents of candidates) {
                  const result = await target
                    .prepare(ATOMIC_USDT_ORDER_INSERT_SQL)
                    .bind(values[0], values[1], values[2], values[3], values[4], amountCents, amountCents)
                    .run();
                  if (Number(result?.meta?.changes) === 1) return result;
                }

                const error = new Error('USDT payment amount slots exhausted');
                error.code = USDT_PAYMENT_SLOTS_EXHAUSTED;
                throw error;
              },
            };
          },
        };
      };
    },
  });
}
