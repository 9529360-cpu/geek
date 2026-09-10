export const ACCOUNT_NO_PATTERN = /^GK-[0-9a-f]{32}$/;
export const ACCOUNT_NO_RANDOM_BYTES = 16;
export const ACCOUNT_NO_MAX_ATTEMPTS = 5;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateAccountNo() {
  const bytes = crypto.getRandomValues(new Uint8Array(ACCOUNT_NO_RANDOM_BYTES));
  return `GK-${bytesToHex(bytes)}`;
}

export function isAccountNo(value) {
  return typeof value === 'string' && ACCOUNT_NO_PATTERN.test(value);
}

export function isAccountNoUniqueConstraintError(error) {
  const message = String(error?.message || error || '');
  return /(?:unique|constraint)/i.test(message) && /(?:users\.)?account_no/i.test(message);
}

function validAttemptCount(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : ACCOUNT_NO_MAX_ATTEMPTS;
}

export async function insertWithAccountNo(insert, options = {}) {
  if (typeof insert !== 'function') throw new TypeError('insert must be a function');
  const maxAttempts = validAttemptCount(options.maxAttempts);
  let lastCollision = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const accountNo = generateAccountNo();
    try {
      const result = await insert(accountNo);
      return { accountNo, result };
    } catch (error) {
      if (!isAccountNoUniqueConstraintError(error)) throw error;
      lastCollision = error;
    }
  }

  const error = new Error('account_no_generation_exhausted');
  error.code = 'ACCOUNT_NO_GENERATION_EXHAUSTED';
  if (lastCollision) error.cause = lastCollision;
  throw error;
}

export async function ensureAccountNo(db, user, options = {}) {
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) {
    throw new TypeError('valid user.id required');
  }
  if (isAccountNo(user.account_no)) return user;
  if (user.account_no !== null && user.account_no !== undefined) {
    const error = new Error('invalid_existing_account_no');
    error.code = 'INVALID_EXISTING_ACCOUNT_NO';
    throw error;
  }

  const maxAttempts = validAttemptCount(options.maxAttempts);
  let lastCollision = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const accountNo = generateAccountNo();
    try {
      const result = await db.prepare(
        'UPDATE users SET account_no = ? WHERE id = ? AND account_no IS NULL'
      ).bind(accountNo, Number(user.id)).run();
      if (Number(result?.meta?.changes || 0) === 1) return { ...user, account_no: accountNo };
    } catch (error) {
      if (!isAccountNoUniqueConstraintError(error)) throw error;
      lastCollision = error;
      continue;
    }

    const row = await db.prepare('SELECT account_no FROM users WHERE id = ?').bind(Number(user.id)).first();
    if (!row) {
      const error = new Error('user_not_found_during_account_no_repair');
      error.code = 'ACCOUNT_NO_USER_NOT_FOUND';
      throw error;
    }
    if (isAccountNo(row.account_no)) return { ...user, account_no: row.account_no };
    if (row.account_no !== null && row.account_no !== undefined) {
      const error = new Error('invalid_existing_account_no');
      error.code = 'INVALID_EXISTING_ACCOUNT_NO';
      throw error;
    }
  }

  const error = new Error('account_no_generation_exhausted');
  error.code = 'ACCOUNT_NO_GENERATION_EXHAUSTED';
  if (lastCollision) error.cause = lastCollision;
  throw error;
}
