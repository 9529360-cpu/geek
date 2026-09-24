'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BASELINE_FILE,
  EXPECTED_MIGRATION,
  MANAGED_TABLE,
  PREVIOUS_MIGRATION,
  REPLAY_COLUMNS,
  REPLAY_INDEX,
  REQUIRED_PRE006_COLUMNS,
  inspect006,
  validateRepo,
} = require('../scripts/d1-migration-guard.cjs');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/d1-migrations-production.yml'), 'utf8');
const validationWorkflow = fs.readFileSync(path.join(root, '.github/workflows/cloudflare-worker-validation.yml'), 'utf8');
const config = fs.readFileSync(path.join(root, 'wrangler-d1-migrations.toml'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'scripts/d1-migrations', EXPECTED_MIGRATION), 'utf8');
const baseline = fs.readFileSync(path.join(root, BASELINE_FILE), 'utf8');
const canonical = fs.readFileSync(path.join(root, 'scripts/geek-subscription-schema.sql'), 'utf8');

assert.equal(validateRepo(root), true, 'managed D1 006 admission must be internally consistent');

assert.match(workflow, /workflow_dispatch:/, 'production D1 migration must be explicit dispatch only');
assert.doesNotMatch(workflow, /\npull_request:/, 'production D1 migration credentials must never be exposed to pull requests');
assert.doesNotMatch(workflow, /\npush:/, 'production D1 migration must never mutate schema from an automatic push');
assert.match(workflow, /if: github\.ref == 'refs\/heads\/master'/, 'production D1 migration must execute only from master');
assert.match(workflow, /permissions:\s*\n\s+contents: read/, 'production D1 migration must keep repository contents read-only');
assert.doesNotMatch(workflow, /issues: write/, 'production D1 migration does not need issue write permission');
assert.match(workflow, /secrets\.CLOUDFLARE_INFRA_API_TOKEN/, 'D1 mutation must use the scoped infrastructure credential');
assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/, 'D1 mutation must not silently broaden the Worker deploy credential');
assert.match(workflow, /APPLY 006-translation-outcome-replay\.sql/, 'apply mode must require an exact human-readable 006 confirmation token');
assert.match(workflow, /d1 migrations apply geek-subscriptions --remote --config wrangler-d1-migrations\.toml/, 'production apply must use Wrangler managed migrations');
assert.doesNotMatch(workflow, /d1 migrations list/, 'read-only preflight must not initialize or mutate the remote ledger');
assert.doesNotMatch(workflow, /wrangler[^\n]*deploy/, 'D1 migration control plane must never deploy a Worker');
assert.match(workflow, /PRAGMA table_info\(translation_usage\)/, 'preflight must inspect the live translation usage schema');
assert.match(workflow, /sqlite_schema WHERE name = 'geek_d1_migrations'/, 'preflight must inspect ledger existence');
assert.match(workflow, /inspect-006/, 'preflight must use the 006 state machine');
assert.match(workflow, /verify-006/, 'apply must finish with an exact 006 postflight');

assert.match(config, /migrations_dir = "scripts\/d1-migrations"/, 'managed epoch must use its isolated migration directory');
assert.match(config, /migrations_table = "geek_d1_migrations"/, 'managed epoch must keep the independent ledger');
assert.doesNotMatch(config, /scripts\/migrations/, 'legacy unledgered migrations must never be fed to Wrangler apply');
assert.doesNotMatch(config, /^main\s*=/m, 'D1 schema control plane must not become a deployable Worker config');

assert.match(baseline, /CREATE TABLE IF NOT EXISTS translation_usage/, '005 baseline must contain translation usage');
assert.match(baseline, /\blease_expires_at\b/, '005 baseline must contain the applied lease column');
assert.match(baseline, /idx_translation_usage_lease/, '005 baseline must contain the applied lease index');
assert.match(baseline, /trg_translation_usage_reservation_lease/, '005 baseline must contain the applied lease trigger');
assert.match(baseline, /CREATE TABLE IF NOT EXISTS geek_d1_migrations/, '005 baseline must contain the managed ledger');
assert.ok(baseline.includes(PREVIOUS_MIGRATION), '005 baseline must record the exact prior migration');
assert.doesNotMatch(baseline, /request_hash|replay_ciphertext|replay_expires_at|idx_translation_usage_replay_expiry/, '005 baseline must remain strictly pre-006');

for (const column of REPLAY_COLUMNS) {
  assert.match(migration, new RegExp(`ALTER TABLE translation_usage ADD COLUMN ${column} TEXT;`, 'i'), `006 must add ${column}`);
  assert.match(canonical, new RegExp(`\\b${column}\\s+TEXT\\b`, 'i'), `canonical schema must include ${column}`);
}
assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry/, '006 must add the replay expiry index');
assert.match(canonical, /CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry/, 'canonical schema must include the replay expiry index');
assert.doesNotMatch(migration, /lease_expires_at|idx_translation_usage_lease|trg_translation_usage_reservation_lease/, '006 must not re-own 005 lease DDL');
assert.doesNotMatch(migration, /\bDROP\b|\bVACUUM\b|\bDELETE\b|\bREPLACE\b/i, '006 must remain additive/non-destructive');

assert.match(validationWorkflow, /BASELINE='scripts\/d1-baselines\/005-translation-reservation-schema\.sql'/, 'PR validation must pin 006 to the immutable post-005 baseline');
assert.match(validationWorkflow, /--file "\$BASELINE"/, 'PR validation must initialize local D1 from the immutable baseline');
assert.doesNotMatch(validationWorkflow, /--file scripts\/geek-subscription-schema\.sql/, 'migration validation must not use the moving canonical schema as a precondition');
assert.match(validationWorkflow, /d1 migrations apply "\$DB" --local/, 'PR validation must really apply admitted migration 006');
assert.match(validationWorkflow, /verify-006/, 'PR validation must verify the 006 post-state');
assert.doesNotMatch(validationWorkflow, /CLOUDFLARE_INFRA_API_TOKEN/, 'PR validation must not receive infrastructure credentials');

const pre006Schema = REQUIRED_PRE006_COLUMNS.map((name, cid) => ({ cid, name }));
const leaseObjects = [
  { name: 'idx_translation_usage_lease', type: 'index' },
  { name: 'trg_translation_usage_reservation_lease', type: 'trigger' },
];
const replayObjects = [...leaseObjects, { name: REPLAY_INDEX, type: 'index' }];
const ledgerTable = [{ name: MANAGED_TABLE, type: 'table' }];
const ledger005 = [{ id: 1, name: PREVIOUS_MIGRATION, applied_at: '2026-09-24 00:00:00' }];
const ledger006 = [...ledger005, { id: 2, name: EXPECTED_MIGRATION, applied_at: '2026-09-24 00:10:00' }];

assert.equal(inspect006({
  schemaRows: pre006Schema,
  objectRows: leaseObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: ledger005,
}), 'ready', 'verified post-005 schema + ledger must be ready for 006');

assert.equal(inspect006({
  schemaRows: [...pre006Schema, ...REPLAY_COLUMNS.map((name, index) => ({ cid: 8 + index, name }))],
  objectRows: replayObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: ledger006,
}), 'already-applied', 'complete replay schema plus matching ledger must be recognized without reapplying');

assert.throws(() => inspect006({
  schemaRows: pre006Schema,
  objectRows: [{ name: 'trg_translation_usage_reservation_lease', type: 'trigger' }],
  ledgerTableRows: ledgerTable,
  ledgerRows: ledger005,
}), /lease index is missing/, '006 must refuse a partial 005 prerequisite');

assert.throws(() => inspect006({
  schemaRows: pre006Schema,
  objectRows: leaseObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: [],
}), /005 must be recorded/, '006 must refuse a schema that lacks the managed 005 ledger entry');

assert.throws(() => inspect006({
  schemaRows: [...pre006Schema, { cid: 8, name: 'request_hash' }],
  objectRows: leaseObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: ledger005,
}), /partial or out-of-band 006 state/, 'partial replay schema must fail closed');

assert.throws(() => inspect006({
  schemaRows: pre006Schema,
  objectRows: leaseObjects,
  ledgerTableRows: ledgerTable,
  ledgerRows: [...ledger005, { id: 2, name: '999-unexpected.sql' }],
}), /unexpected managed migration ledger entry/, 'unknown managed ledger state must fail closed');

console.log('D1_MIGRATION_CONTROL_PLANE_CONTRACT_OK');
