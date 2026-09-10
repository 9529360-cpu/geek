'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = path.join(__dirname, '..');
  const modulePath = path.join(root, 'scripts/account-number.mjs');
  const account = await import(pathToFileURL(modulePath).href + `?test=${Date.now()}`);

  const first = account.generateAccountNo();
  const second = account.generateAccountNo();
  assert.match(first, /^GK-[0-9a-f]{32}$/);
  assert.match(second, /^GK-[0-9a-f]{32}$/);
  assert.notEqual(first, second, 'independent generations must not derive from a numeric user id');
  for (const bad of ['', 'GK-000001', 'gk-' + 'a'.repeat(32), 'GK-' + 'A'.repeat(32), 'GK-' + 'a'.repeat(31)]) {
    assert.equal(account.isAccountNo(bad), false, `must reject ${bad || '<empty>'}`);
  }

  const source = fs.readFileSync(modulePath, 'utf8');
  assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(ACCOUNT_NO_RANDOM_BYTES\)\)/);
  assert.doesNotMatch(source, /Math\.random|Date\.now|userId|user_id|email.*hash/i);

  let attempts = 0;
  const inserted = await account.insertWithAccountNo(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('D1_ERROR: UNIQUE constraint failed: users.account_no: SQLITE_CONSTRAINT');
    return { meta: { last_row_id: 88 } };
  }, { maxAttempts: 5 });
  assert.equal(attempts, 3);
  assert.equal(inserted.result.meta.last_row_id, 88);
  assert.match(inserted.accountNo, /^GK-[0-9a-f]{32}$/);

  let otherUniqueAttempts = 0;
  await assert.rejects(account.insertWithAccountNo(async () => {
    otherUniqueAttempts += 1;
    throw new Error('D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT');
  }), /users\.email/);
  assert.equal(otherUniqueAttempts, 1, 'non-account_no uniqueness errors must not retry');

  let exhaustedAttempts = 0;
  await assert.rejects(account.insertWithAccountNo(async () => {
    exhaustedAttempts += 1;
    throw new Error('UNIQUE constraint failed: users.account_no');
  }, { maxAttempts: 3 }), (error) => error?.code === 'ACCOUNT_NO_GENERATION_EXHAUSTED');
  assert.equal(exhaustedAttempts, 3);

  const stable = 'GK-11111111111111111111111111111111';
  let touched = false;
  const unchanged = await account.ensureAccountNo({ prepare() { touched = true; } }, { id: 7, account_no: stable });
  assert.equal(unchanged.account_no, stable);
  assert.equal(touched, false, 'existing account_no must remain immutable');

  let stored = null;
  const repairDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              assert.match(sql, /UPDATE users SET account_no = \? WHERE id = \? AND account_no IS NULL/);
              const [candidate, id] = args;
              assert.equal(id, 42);
              if (stored !== null) return { meta: { changes: 0 } };
              stored = candidate;
              return { meta: { changes: 1 } };
            },
            async first() { return stored === null ? { account_no: null } : { account_no: stored }; },
          };
        },
      };
    },
  };
  const repaired = await account.ensureAccountNo(repairDb, { id: 42, account_no: null, email: 'old@example.test' });
  assert.match(repaired.account_no, /^GK-[0-9a-f]{32}$/);
  assert.equal(stored, repaired.account_no);
  const reread = await account.ensureAccountNo(repairDb, repaired);
  assert.equal(reread.account_no, repaired.account_no);

  console.log('ACCOUNT_NUMBER_CONTRACT_OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
