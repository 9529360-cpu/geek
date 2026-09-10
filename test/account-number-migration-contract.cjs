'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const migration003 = fs.readFileSync(path.join(root, 'scripts/migrations/003-account-number.sql'), 'utf8');
const migration004 = fs.readFileSync(path.join(root, 'scripts/migrations/004-account-number-repair.sql'), 'utf8');
const accountNoPattern = /^GK-[0-9a-f]{32}$/;

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  quota_chars INTEGER NOT NULL DEFAULT 20000,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

const insertOld = db.prepare('INSERT INTO users (email, password_hash, password_salt, quota_chars) VALUES (?, ?, ?, ?)');
insertOld.run('one@example.test', 'hash-1', 'salt-1', 12345);
insertOld.run('two@example.test', 'hash-2', 'salt-2', 23456);
insertOld.run('three@example.test', 'hash-3', 'salt-3', 34567);
db.prepare('INSERT INTO orders (user_id, plan, amount) VALUES (?, ?, ?)').run(2, 'basic', 25);

const before = db.prepare('SELECT id, email, quota_chars FROM users ORDER BY id').all()
  .map(({ id, email, quota_chars }) => ({ id, email, quota_chars }));
const beforeOrder = db.prepare('SELECT id, user_id, plan, amount FROM orders ORDER BY id').all()
  .map(({ id, user_id, plan, amount }) => ({ id, user_id, plan, amount }));

db.exec(migration003);

const after003 = db.prepare('SELECT id, email, quota_chars, account_no FROM users ORDER BY id').all();
assert.deepEqual(after003.map(({ id, email, quota_chars }) => ({ id, email, quota_chars })), before,
  '003 must preserve existing user id/email/quota');
assert.deepEqual(db.prepare('SELECT id, user_id, plan, amount FROM orders ORDER BY id').all()
  .map(({ id, user_id, plan, amount }) => ({ id, user_id, plan, amount })), beforeOrder,
  '003 must preserve order foreign-key data');
assert.equal(after003.length, 3);
assert.ok(after003.every((row) => accountNoPattern.test(row.account_no)), '003 must backfill every old user');
assert.equal(new Set(after003.map((row) => row.account_no)).size, after003.length, '003 backfill must be unique');

const duplicate = after003[0].account_no;
assert.throws(
  () => db.prepare('INSERT INTO users (email, password_hash, password_salt, account_no) VALUES (?, ?, ?, ?)')
    .run('duplicate@example.test', 'hash', 'salt', duplicate),
  /UNIQUE constraint failed: users\.account_no/,
  'database unique index must reject duplicate account_no'
);

// Simulate 003 already applied while an old Worker still inserts its old column list.
const oldWriter = db.prepare('INSERT INTO users (email, password_hash, password_salt, quota_chars) VALUES (?, ?, ?, ?)')
  .run('cutover@example.test', 'hash-4', 'salt-4', 45678);
const cutoverId = Number(oldWriter.lastInsertRowid);
assert.equal(db.prepare('SELECT account_no FROM users WHERE id = ?').get(cutoverId).account_no, null,
  '003 must remain compatible with the old writer during cutover');

db.exec(migration004);
const repaired = db.prepare('SELECT id, email, quota_chars, account_no FROM users WHERE id = ?').get(cutoverId);
assert.equal(repaired.id, cutoverId);
assert.equal(repaired.email, 'cutover@example.test');
assert.equal(repaired.quota_chars, 45678);
assert.match(repaired.account_no, accountNoPattern, '004 must repair cutover NULL account_no');

const finalRows = db.prepare('SELECT id, account_no FROM users ORDER BY id').all();
assert.ok(finalRows.every((row) => accountNoPattern.test(row.account_no)), 'post-rollout users must all have account_no');
assert.equal(new Set(finalRows.map((row) => row.account_no)).size, finalRows.length, 'post-rollout account_no values must be unique');

// New account-number-aware writer still works after both migrations.
const explicitAccountNo = 'GK-0123456789abcdef0123456789abcdef';
const newWriter = db.prepare(
  'INSERT INTO users (email, password_hash, password_salt, quota_chars, account_no) VALUES (?, ?, ?, ?, ?)'
).run('new@example.test', 'hash-5', 'salt-5', 56789, explicitAccountNo);
const created = db.prepare('SELECT id, email, quota_chars, account_no FROM users WHERE id = ?').get(Number(newWriter.lastInsertRowid));
assert.equal(created.account_no, explicitAccountNo);
assert.equal(created.email, 'new@example.test');
assert.equal(created.quota_chars, 56789);

console.log('ACCOUNT_NUMBER_MIGRATION_CONTRACT_OK');
