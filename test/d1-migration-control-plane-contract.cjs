'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EXPECTED_MIGRATION,
  MANAGED_TABLE,
  REQUIRED_BASE_COLUMNS,
  inspect005,
  validateRepo,
} = require('../scripts/d1-migration-guard.cjs');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/d1-migrations-production.yml'), 'utf8');
const validationWorkflow = fs.readFileSync(path.join(root, '.github/workflows/cloudflare-worker-validation.yml'), 'utf8');
const config = fs.readFileSync(path.join(root, 'wrangler-d1-migrations.toml'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'scripts/d1-migrations', EXPECTED_MIGRATION), 'utf8');

assert.equal(validateRepo(root), true, 'managed D1 repo admission must be internally consistent');

assert.match(workflow, /workflow_dispatch:/, 'production D1 migration must be explicit dispatch only');
assert.doesNotMatch(workflow, /\npull_request:/, 'production D1 migration credentials must never be exposed to pull requests');
assert.doesNotMatch(workflow, /\npush:/, 'production D1 migration must never mutate schema from an automatic push');
assert.match(workflow, /if: github\.ref == 'refs\/heads\/master'/, 'production D1 migration must execute only from master');
assert.match(workflow, /permissions:\s*\n\s+contents: read/, 'production D1 migration must keep repository contents read-only');
assert.doesNotMatch(workflow, /issues: write/, 'production D1 migration does not need issue write permission');
assert.match(workflow, /secrets\.CLOUDFLARE_INFRA_API_TOKEN/, 'D1 mutation must use the scoped infrastructure credential');
assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/, 'D1 mutation must not silently broaden the Worker deploy credential');
assert.match(workflow, /APPLY 005-translation-reservation-lease\.sql/, 'apply mode must require an exact human-readable confirmation token');
assert.match(workflow, /d1 migrations apply geek-subscriptions --remote --config wrangler-d1-migrations\.toml/, 'production apply must use Wrangler managed migrations');
assert.doesNotMatch(workflow, /d1 migrations list/, 'read-only preflight must not initialize the remote managed ledger');
assert.doesNotMatch(workflow, /wrangler[^\n]*deploy/, 'D1 migration control plane must never deploy a Worker');
assert.match(workflow, /PRAGMA table_info\(translation_usage\)/, 'preflight must inspect the live translation usage schema');
assert.match(workflow, /sqlite_schema WHERE name = 'geek_d1_migrations'/, 'preflight must inspect ledger existence without creating it');
assert.match(workflow, /verify-005/, 'apply must finish with an exact managed-schema postflight');

assert.match(config, /migrations_dir = "scripts\/d1-migrations"/, 'managed epoch must use its own migration directory');
assert.match(config, /migrations_table = "geek_d1_migrations"/, 'managed epoch must use an independent migration ledger');
assert.doesNotMatch(config, /scripts\/migrations/, 'legacy unledgered migrations must never be fed to Wrangler apply');
assert.doesNotMatch(config, /^main\s*=/m, 'D1 schema control plane must not become a deployable Worker config');

assert.match(migration, /ALTER TABLE translation_usage ADD COLUMN lease_expires_at TEXT;/, '005 must add only the reservation lease column');
assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_translation_usage_lease/, '005 must add its lease index');
assert.match(migration, /CREATE TRIGGER IF NOT EXISTS trg_translation_usage_reservation_lease/, '005 must add its lease trigger');
assert.doesNotMatch(migration, /request_hash|replay_ciphertext|replay_expires_at/, '006 replay schema must stay outside the 005 admission');
assert.doesNotMatch(migration, /\bDROP\b|\bVACUUM\b|\bDELETE\b/i, '005 must remain additive/non-destructive');

assert.match(validationWorkflow, /wrangler-d1-migrations\.toml/, 'PR validation must exercise the dedicated D1 config without production credentials');
assert.match(validationWorkflow, /d1 migrations apply "\$DB" --local/, 'PR validation must really apply admitted migrations to the shared local D1 baseline');
assert.doesNotMatch(validationWorkflow, /CLOUDFLARE_INFRA_API_TOKEN/, 'PR validation must not receive infrastructure credentials');

const baseSchema = REQUIRED_BASE_COLUMNS.map((name, cid) => ({ cid, name }));
const leaseObjects = [
  { name: 'idx_translation_usage_lease', type: 'index' },
  { name: 'trg_translation_usage_reservation_lease', type: 'trigger' },
];
const ledgerTable = [{ name: MANAGED_TABLE, type: 'table' }];
const ledger005 = [{ id: 1, name: EXPECTED_MIGRATION, applied_at: '2026-09-16 00:00:00' }];

assert.equal(inspect005({
  schemaRows: baseSchema,
  objectRows: [],
  ledgerTableRows: [],
  ledgerRows: [],
}), 'ready', 'clean legacy schema must be ready for 005');

assert.equal(inspect005({
  schemaRows: baseSchema,
  objectRows: [],
  ledgerTableRows: ledgerTable,
  ledgerRows: [],
}), 'ready', 'an empty managed ledger left by an interrupted attempt must remain safely retryable');

assert.equal(inspect005({
  schemaRows: [...baseSchema, { cid: 7, name: 'lease_expires_at' }],
  objectRows: leaseObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: ledger005,
}), 'already-applied', 'complete schema plus matching ledger must be recognized without reapplying');

assert.throws(() => inspect005({
  schemaRows: [...baseSchema, { cid: 7, name: 'lease_expires_at' }],
  objectRows: [],
  ledgerTableRows: [],
  ledgerRows: [],
}), /partial or out-of-band 005 state/, 'partial schema must fail closed');

assert.throws(() => inspect005({
  schemaRows: [...baseSchema, { cid: 7, name: 'request_hash' }],
  objectRows: [],
  ledgerTableRows: [],
  ledgerRows: [],
}), /future 006 column present/, '005 workflow must refuse to cross a future migration boundary');

assert.throws(() => inspect005({
  schemaRows: baseSchema,
  objectRows: [],
  ledgerTableRows: ledgerTable,
  ledgerRows: [{ id: 1, name: '999-unexpected.sql' }],
}), /unexpected managed migration ledger entry/, 'unknown managed ledger state must fail closed');

console.log('D1_MIGRATION_CONTROL_PLANE_CONTRACT_OK');
