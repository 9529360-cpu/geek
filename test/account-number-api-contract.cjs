'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  async run() { const result = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }; }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.params) }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const out = []; for (const statement of statements) out.push(await statement.run()); this.db.exec('COMMIT'); return out; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

(async () => {
  const root = path.join(__dirname, '..');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(fs.readFileSync(path.join(root, 'scripts/geek-subscription-schema.sql'), 'utf8'));
  const d1 = new D1Database(sqlite);
  const env = { geek_subscriptions: d1, JWT_SECRET: 'test-secret-not-for-production', ADMIN_PASSWORD: 'admin-test-password' };

  const production = (await import(pathToFileURL(path.join(root, 'scripts/geek-subscription-entry.js')).href + `?api=${Date.now()}`)).default;
  const core = (await import(pathToFileURL(path.join(root, 'scripts/geek-subscription-worker-core.js')).href + `?core=${Date.now()}`)).default;
  const email = 'account-no-api@example.test';
  const password = 'correct-horse-battery-staple';

  const registerResponse = await production.fetch(new Request('https://subscription.example/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }, body: JSON.stringify({ email, password }),
  }), env, {});
  assert.equal(registerResponse.status, 200);
  const registered = await registerResponse.json();
  assert.ok(Number.isSafeInteger(Number(registered.userId)) && Number(registered.userId) > 0, 'register keeps userId');
  assert.match(registered.account_no, /^GK-[0-9a-f]{32}$/);

  const loginResponse = await production.fetch(new Request('https://subscription.example/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.11' }, body: JSON.stringify({ email, password }),
  }), env, {});
  assert.equal(loginResponse.status, 200);
  const loggedIn = await loginResponse.json();
  assert.equal(loggedIn.user.id, registered.userId);
  assert.equal(loggedIn.user.email, email);
  assert.equal(loggedIn.user.account_no, registered.account_no, 'register/login account_no must agree');
  assert.ok(loggedIn.token, 'login keeps bearer token');

  const meRequest = () => new Request('https://subscription.example/api/me', { headers: { Authorization: `Bearer ${loggedIn.token}` } });
  const meResponse = await production.fetch(meRequest(), env, {});
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json();
  assert.equal(me.user.account_no, registered.account_no, 'register/login/me account_no must agree');
  assert.equal(me.user.id, registered.userId);
  assert.equal('password_hash' in me.user, false);
  assert.equal('password_salt' in me.user, false);
  assert.equal('token' in me.user, false);
  const meAgain = await (await production.fetch(meRequest(), env, {})).json();
  assert.equal(meAgain.user.account_no, registered.account_no, 'account_no must remain stable across reads');

  const knownAccountNo = 'GK-0123456789abcdef0123456789abcdef';
  sqlite.prepare('INSERT INTO users (email, password_hash, password_salt, quota_chars, account_no) VALUES (?, ?, ?, ?, ?)')
    .run('searchable@example.test', 'not-a-login-hash', 'salt', 777, knownAccountNo);

  const adminLogin = await core.fetch(new Request('https://subscription.example/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.12' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  }), env);
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie');
  assert.match(adminCookie || '', /geek_admin_session=/);

  async function adminGet(pathname) {
    const response = await core.fetch(new Request(`https://subscription.example${pathname}`, { headers: { Cookie: adminCookie } }), env);
    assert.equal(response.status, 200, pathname);
    return response.json();
  }

  const exact = await adminGet('/api/admin/users?q=' + knownAccountNo);
  assert.equal(exact.users.length, 1, 'full account_no must match exactly');
  assert.equal(exact.users[0].email, 'searchable@example.test');
  assert.equal(exact.users[0].account_no, knownAccountNo);
  assert.equal('password_hash' in exact.users[0], false);
  assert.equal('password_salt' in exact.users[0], false);

  const partial = await adminGet('/api/admin/users?q=GK-0123456789abcdef');
  assert.equal(partial.users.length, 0, 'partial account_no must not produce account-number matches');
  const byEmail = await adminGet('/api/admin/users?q=searchable');
  assert.equal(byEmail.users.length, 1, 'existing email LIKE search must keep working');
  assert.equal(byEmail.users[0].account_no, knownAccountNo);
  const detail = await adminGet(`/api/admin/users/${byEmail.users[0].id}`);
  assert.equal(detail.user.account_no, knownAccountNo);
  assert.equal('password_hash' in detail.user, false);
  assert.equal('password_salt' in detail.user, false);

  const adminHtml = await (await core.fetch(new Request('https://subscription.example/admin'), env)).text();
  assert.match(adminHtml, /账号号/);
  assert.match(adminHtml, /内部 ID/);

  console.log('ACCOUNT_NUMBER_API_CONTRACT_OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
