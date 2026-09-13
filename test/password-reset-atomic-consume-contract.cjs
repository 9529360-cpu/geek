'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-schema.sql'), 'utf8');
const entrySource = fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-entry.js'), 'utf8');

class D1Statement {
  constructor(owner, sql, params = []) {
    this.owner = owner;
    this.sql = String(sql);
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.owner, this.sql, params);
  }

  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.params) || null;
  }

  async all() {
    return { success: true, results: this.owner.sqlite.prepare(this.sql).all(...this.params) };
  }
}

class D1Database {
  constructor(sqlite, options = {}) {
    this.sqlite = sqlite;
    this.failInsideBatchAt = Number.isInteger(options.failInsideBatchAt) ? options.failInsideBatchAt : null;
    this.throwAfterBatchCommit = Boolean(options.throwAfterBatchCommit);
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

  async batch(statements) {
    const execute = async () => {
      let committed = false;
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (let index = 0; index < statements.length; index += 1) {
          if (this.failInsideBatchAt === index) {
            this.failInsideBatchAt = null;
            throw new Error('simulated_password_reset_batch_failure');
          }
          out.push(await statements[index].run());
        }
        this.sqlite.exec('COMMIT');
        committed = true;
        if (this.throwAfterBatchCommit) {
          this.throwAfterBatchCommit = false;
          throw new Error('simulated_password_reset_unknown_outcome_after_commit');
        }
        return out;
      } catch (error) {
        if (!committed) {
          try { this.sqlite.exec('ROLLBACK'); } catch {}
        }
        throw error;
      }
    };

    const run = this.batchTail.then(execute, execute);
    this.batchTail = run.catch(() => {});
    return run;
  }
}

function setup(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);

  const email = options.email || 'reset-atomic@example.test';
  const accountNo = options.accountNo || 'GK-0123456789abcdef0123456789abcdef';
  const originalHash = `v4$${'1'.repeat(64)}`;
  const originalSalt = '2'.repeat(32);
  const user = sqlite.prepare(`
    INSERT INTO users (account_no, email, password_hash, password_salt, quota_chars, token_version)
    VALUES (?, ?, ?, ?, 20000, 0)
    RETURNING id
  `).get(accountNo, email, originalHash, originalSalt);

  const token = options.token || Buffer.alloc(32, options.tokenByte || 7).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const reset = sqlite.prepare(`
    INSERT INTO password_reset_requests (user_id, email, status, token_hash, expires_at)
    VALUES (?, ?, 'issued', ?, '2099-01-01 00:00:00')
    RETURNING id
  `).get(user.id, email, tokenHash);

  const db = new D1Database(sqlite, options);
  const env = {
    geek_subscriptions: db,
    JWT_SECRET: 'password-reset-contract-secret',
  };

  return {
    sqlite,
    db,
    env,
    email,
    userId: Number(user.id),
    resetId: Number(reset.id),
    token,
    originalHash,
    originalSalt,
  };
}

async function loadProduction() {
  const url = pathToFileURL(path.join(root, 'scripts', 'geek-subscription-entry.js')).href;
  return (await import(`${url}?password-reset-contract=${Date.now()}-${Math.random()}`)).default;
}

function resetRequest(token, password, ip = '203.0.113.80') {
  return new Request('https://subscription.example/api/password-reset/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ token, password }),
  });
}

function userState(sqlite, userId) {
  return sqlite.prepare(`
    SELECT password_hash, password_salt, token_version
    FROM users WHERE id = ?
  `).get(userId);
}

function resetState(sqlite, resetId) {
  const row = sqlite.prepare(`
    SELECT status, used_at
    FROM password_reset_requests WHERE id = ?
  `).get(resetId);
  return row ? { status: row.status, used_at: row.used_at ?? null } : null;
}

async function login(production, env, email, password, ip = '203.0.113.90') {
  return production.fetch(new Request('https://subscription.example/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ email, password }),
  }), env, {});
}

(async () => {
  const production = await loadProduction();
  const newPassword = 'new-correct-horse-battery-staple';

  // 1. Normal success: password + session version + one-time token commit together.
  {
    const state = setup();
    const response = await production.fetch(resetRequest(state.token, newPassword), state.env, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const cookie = response.headers.get('set-cookie') || '';
    assert.match(cookie, /geek_session=;/, 'successful reset must clear the old session cookie');
    assert.match(cookie, /Max-Age=0/i, 'successful reset cookie must expire immediately');

    const after = userState(state.sqlite, state.userId);
    assert.match(after.password_hash, /^v4\$[0-9a-f]{64}$/);
    assert.notEqual(after.password_hash, state.originalHash);
    assert.notEqual(after.password_salt, state.originalSalt);
    assert.equal(Number(after.token_version), 1, 'password reset must revoke existing sessions exactly once');

    const reset = resetState(state.sqlite, state.resetId);
    assert.equal(reset.status, 'used');
    assert.ok(reset.used_at, 'consumed token must keep a used timestamp');
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS c FROM password_reset_requests WHERE status = 'processing'").get().c, 0);

    const loginResponse = await login(production, state.env, state.email, newPassword);
    assert.equal(loginResponse.status, 200, 'new password must authenticate through the real production login owner');

    const beforeReplay = userState(state.sqlite, state.userId);
    const replay = await production.fetch(
      resetRequest(state.token, 'another-valid-password-value', '203.0.113.81'),
      state.env,
      {}
    );
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'invalid_or_expired_token');
    assert.deepEqual(userState(state.sqlite, state.userId), beforeReplay, 'replay must not mutate password or token version again');
    assert.equal(resetState(state.sqlite, state.resetId).status, 'used');
    state.sqlite.close();
  }

  // 2. Statement failure after the issued->processing claim must roll back the whole batch.
  {
    const state = setup({
      email: 'reset-rollback@example.test',
      accountNo: 'GK-11111111111111111111111111111111',
      tokenByte: 8,
      failInsideBatchAt: 1,
    });
    const beforeUser = userState(state.sqlite, state.userId);

    await assert.rejects(
      () => production.fetch(resetRequest(state.token, newPassword, '203.0.113.82'), state.env, {}),
      /simulated_password_reset_batch_failure/
    );

    assert.deepEqual(userState(state.sqlite, state.userId), beforeUser, 'failed transaction must not mutate the password/session version');
    assert.deepEqual(resetState(state.sqlite, state.resetId), { status: 'issued', used_at: null }, 'failed transaction must restore the token to issued via rollback, not recovery SQL');
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS c FROM password_reset_requests WHERE status = 'processing'").get().c, 0);

    const retry = await production.fetch(resetRequest(state.token, newPassword, '203.0.113.83'), state.env, {});
    assert.equal(retry.status, 200, 'rolled-back token must remain retryable');
    assert.equal(Number(userState(state.sqlite, state.userId).token_version), 1);
    assert.equal(resetState(state.sqlite, state.resetId).status, 'used');
    state.sqlite.close();
  }

  // 3. Unknown caller outcome after COMMIT may surface as an exception, but durable state must already be final.
  {
    const state = setup({
      email: 'reset-unknown@example.test',
      accountNo: 'GK-22222222222222222222222222222222',
      tokenByte: 9,
      throwAfterBatchCommit: true,
    });

    await assert.rejects(
      () => production.fetch(resetRequest(state.token, newPassword, '203.0.113.84'), state.env, {}),
      /simulated_password_reset_unknown_outcome_after_commit/
    );

    const after = userState(state.sqlite, state.userId);
    assert.match(after.password_hash, /^v4\$[0-9a-f]{64}$/);
    assert.notEqual(after.password_hash, state.originalHash);
    assert.equal(Number(after.token_version), 1);
    const reset = resetState(state.sqlite, state.resetId);
    assert.equal(reset.status, 'used', 'commit-then-error must leave the token terminal, never stranded in processing');
    assert.ok(reset.used_at);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS c FROM password_reset_requests WHERE status = 'processing'").get().c, 0);

    const replay = await production.fetch(resetRequest(state.token, 'another-valid-password-value', '203.0.113.85'), state.env, {});
    assert.equal(replay.status, 400);
    assert.equal(Number(userState(state.sqlite, state.userId).token_version), 1, 'unknown outcome replay must not revoke sessions twice');
    assert.equal(resetState(state.sqlite, state.resetId).status, 'used');
    state.sqlite.close();
  }

  // 4. Concurrent/replayed token use must have at most one committed winner.
  {
    const state = setup({
      email: 'reset-race@example.test',
      accountNo: 'GK-33333333333333333333333333333333',
      tokenByte: 10,
    });
    const firstPassword = 'race-password-first-0001';
    const secondPassword = 'race-password-second-0002';
    const [first, second] = await Promise.all([
      production.fetch(resetRequest(state.token, firstPassword, '203.0.113.86'), state.env, {}),
      production.fetch(resetRequest(state.token, secondPassword, '203.0.113.87'), state.env, {}),
    ]);
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 400], 'exactly one concurrent reset attempt may commit');
    assert.equal(Number(userState(state.sqlite, state.userId).token_version), 1);
    assert.equal(resetState(state.sqlite, state.resetId).status, 'used');
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS c FROM password_reset_requests WHERE status = 'processing'").get().c, 0);
    state.sqlite.close();
  }

  assert.doesNotMatch(entrySource, /const claim = await db\.prepare\([\s\S]{0,220}status = 'processing'/, 'reset claim must not be durably committed before the transaction');
  assert.doesNotMatch(entrySource, /SET status = 'issued' WHERE id = \? AND status = 'processing'/, 'transactional reset must not rely on best-effort processing->issued recovery');
  assert.match(entrySource, /db\.batch\(\[[\s\S]*status = 'processing'[\s\S]*token_version = token_version \+ 1[\s\S]*status = 'used'/, 'claim, password mutation and consume must share one D1 batch transaction');

  console.log('PASSWORD_RESET_ATOMIC_CONSUME_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
