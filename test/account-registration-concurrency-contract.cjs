'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'scripts', 'geek-subscription-schema.sql'), 'utf8');

function normalizeSql(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

class D1Statement {
  constructor(owner, sql, params = []) {
    this.owner = owner;
    this.sql = String(sql);
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.owner, this.sql, params);
  }

  async first() {
    return this.owner.first(this.sql, this.params);
  }

  async all() {
    return { success: true, results: this.owner.sqlite.prepare(this.sql).all(...this.params) };
  }

  async run() {
    return this.owner.run(this.sql, this.params);
  }
}

class RegistrationD1 {
  constructor(sqlite, options = {}) {
    this.sqlite = sqlite;
    this.emailBarrierTarget = Number(options.emailBarrierTarget || 0);
    this.emailBarrierSeen = 0;
    this.emailBarrierWaiters = [];
    this.accountNoCollisionsRemaining = Number(options.accountNoCollisions || 0);
    this.genericUserInsertFailuresRemaining = Number(options.genericUserInsertFailures || 0);
    this.userInsertAttempts = 0;
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

  async first(sql, params) {
    const normalized = normalizeSql(sql);
    if (normalized === 'SELECT * FROM users WHERE email = ?' && this.emailBarrierSeen < this.emailBarrierTarget) {
      this.emailBarrierSeen += 1;
      return new Promise((resolve) => {
        this.emailBarrierWaiters.push(resolve);
        if (this.emailBarrierWaiters.length === this.emailBarrierTarget) {
          const captured = this.sqlite.prepare(sql).get(...params) || null;
          const waiters = this.emailBarrierWaiters.splice(0);
          for (const release of waiters) release(captured);
        }
      });
    }
    return this.sqlite.prepare(sql).get(...params) || null;
  }

  async run(sql, params) {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith('INSERT INTO users (email, password_hash, password_salt, quota_chars, account_no)')) {
      this.userInsertAttempts += 1;
      if (this.accountNoCollisionsRemaining > 0) {
        this.accountNoCollisionsRemaining -= 1;
        throw new Error('D1_EXEC_ERROR: UNIQUE constraint failed: users.account_no');
      }
      if (this.genericUserInsertFailuresRemaining > 0) {
        this.genericUserInsertFailuresRemaining -= 1;
        throw new Error('D1_EXEC_ERROR: simulated unrelated storage failure');
      }
    }
    const result = this.sqlite.prepare(sql).run(...params);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

function setup(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  const db = new RegistrationD1(sqlite, options);
  return {
    sqlite,
    db,
    env: {
      geek_subscriptions: db,
      JWT_SECRET: 'registration-concurrency-contract-secret',
    },
  };
}

async function loadProduction() {
  const url = pathToFileURL(path.join(root, 'scripts', 'geek-subscription-entry.js')).href;
  return (await import(`${url}?registration-concurrency=${Date.now()}-${Math.random()}`)).default;
}

function registerRequest(email, password, ip) {
  return new Request('https://subscription.example/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

function loginRequest(email, password, ip) {
  return new Request('https://subscription.example/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

(async () => {
  const production = await loadProduction();

  // 1. Deterministically force two same-email requests past the friendly pre-check.
  //    The UNIQUE constraint is the final authority: one 200 winner, one stable 409 loser.
  {
    const state = setup({ emailBarrierTarget: 2 });
    const email = 'race-registration@example.test';
    const passwords = ['winner-candidate-password-A', 'winner-candidate-password-B'];
    const responses = await Promise.all([
      production.fetch(registerRequest(' Race-Registration@Example.Test ', passwords[0], '203.0.113.101'), state.env, {}),
      production.fetch(registerRequest('race-registration@example.test', passwords[1], '203.0.113.102'), state.env, {}),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort((a, b) => a - b),
      [200, 409],
      'concurrent duplicate registration must produce exactly one success and one conflict'
    );
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const winnerIndex = responses.findIndex((response) => response.status === 200);
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    assert.equal(payloads[loserIndex].error, 'email_exists', 'database UNIQUE loser must map to the existing duplicate-email contract');
    assert.match(String(payloads[winnerIndex].account_no || ''), /^GK-[0-9a-f]{32}$/);

    const stored = state.sqlite.prepare(`
      SELECT id, email, quota_chars, account_no
      FROM users WHERE email = ?
    `).all(email);
    assert.equal(stored.length, 1, 'only one normalized email row may exist');
    assert.equal(stored[0].email, email);
    assert.equal(Number(stored[0].quota_chars), 20000);
    assert.equal(state.db.userInsertAttempts, 2, 'both requests must reach the authoritative INSERT boundary');

    const winnerLogin = await production.fetch(
      loginRequest(email, passwords[winnerIndex], '203.0.113.103'),
      state.env,
      {}
    );
    assert.equal(winnerLogin.status, 200, 'the committed winner password must authenticate');

    const loserLogin = await production.fetch(
      loginRequest(email, passwords[loserIndex], '203.0.113.104'),
      state.env,
      {}
    );
    assert.equal(loserLogin.status, 401, 'the losing registration password must never overwrite the existing user');
    assert.equal((await loserLogin.json()).error, 'invalid_credentials');
    state.sqlite.close();
  }

  // 2. Account-number UNIQUE collisions must remain owned by insertWithAccountNo and retry normally.
  {
    const state = setup({ accountNoCollisions: 1 });
    const response = await production.fetch(
      registerRequest('account-no-retry@example.test', 'account-number-retry-password', '203.0.113.105'),
      state.env,
      {}
    );
    assert.equal(response.status, 200, 'account-number collision must not be misclassified as duplicate email');
    assert.equal(state.db.userInsertAttempts, 2, 'account-number helper must retry after its own UNIQUE collision');
    assert.equal(
      state.sqlite.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get('account-no-retry@example.test').c,
      1
    );
    state.sqlite.close();
  }

  // 3. Only users.email UNIQUE is translated. Unrelated storage failures must still fail loudly.
  {
    const state = setup({ genericUserInsertFailures: 1 });
    await assert.rejects(
      () => production.fetch(
        registerRequest('storage-failure@example.test', 'storage-failure-password', '203.0.113.106'),
        state.env,
        {}
      ),
      /simulated unrelated storage failure/
    );
    assert.equal(
      state.sqlite.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').get('storage-failure@example.test').c,
      0,
      'unrelated insert failures must not create a partial user'
    );
    state.sqlite.close();
  }

  console.log('ACCOUNT_REGISTRATION_CONCURRENCY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
