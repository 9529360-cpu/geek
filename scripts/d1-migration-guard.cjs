'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_MIGRATION = '005-translation-reservation-lease.sql';
const MANAGED_DIR = 'scripts/d1-migrations';
const MANAGED_TABLE = 'geek_d1_migrations';
const BASELINE_FILE = 'scripts/d1-baselines/004-subscription-schema.sql';
const DATABASE_NAME = 'geek-subscriptions';
const DATABASE_ID = '1e78a93a-36de-43db-88aa-4551f9991200';
const REQUIRED_BASE_COLUMNS = Object.freeze([
  'request_id',
  'user_id',
  'reserved_chars',
  'target_chars',
  'status',
  'created_at',
  'completed_at',
]);
const FUTURE_COLUMNS = Object.freeze(['request_hash', 'replay_ciphertext', 'replay_expires_at']);
const LEASE_INDEX = 'idx_translation_usage_lease';
const LEASE_TRIGGER = 'trg_translation_usage_reservation_lease';
const FUTURE_INDEX = 'idx_translation_usage_replay_expiry';

function rowsFromPayload(payload) {
  const rows = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (Array.isArray(value.results)) {
      rows.push(...value.results);
    }
  };
  visit(payload);
  return rows;
}

function rowsFromFile(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return rowsFromPayload(JSON.parse(raw));
}

function fail(message) {
  const error = new Error(message);
  error.code = 'D1_MIGRATION_GUARD_FAILED';
  throw error;
}

function validateRepo(root = path.resolve(__dirname, '..')) {
  const configPath = path.join(root, 'wrangler-d1-migrations.toml');
  const config = fs.readFileSync(configPath, 'utf8');
  if (!config.includes(`database_name = "${DATABASE_NAME}"`)) fail('managed config database name drifted');
  if (!config.includes(`database_id = "${DATABASE_ID}"`)) fail('managed config database id drifted');
  if (!config.includes(`migrations_dir = "${MANAGED_DIR}"`)) fail('managed migrations_dir drifted');
  if (!config.includes(`migrations_table = "${MANAGED_TABLE}"`)) fail('managed migrations table drifted');
  if (config.includes('scripts/migrations')) fail('legacy migration directory must never be managed by Wrangler');
  if (/^main\s*=/m.test(config)) fail('schema control-plane config must not become a Worker deployment config');

  const baselinePath = path.join(root, BASELINE_FILE);
  const baseline = fs.readFileSync(baselinePath, 'utf8');
  const usageMatch = baseline.match(/CREATE TABLE IF NOT EXISTS translation_usage\s*\(([\s\S]*?)\n\);/i);
  if (!usageMatch) fail('004 baseline translation_usage table missing');
  for (const column of REQUIRED_BASE_COLUMNS) {
    if (!new RegExp(`\\b${column}\\b`, 'i').test(usageMatch[1])) fail(`004 baseline is missing translation_usage.${column}`);
  }
  if (!/\baccount_no\b/i.test(baseline) || !/\btoken_version\b/i.test(baseline) || !/CREATE TABLE IF NOT EXISTS password_reset_requests/i.test(baseline)) {
    fail('004 baseline does not include the proven legacy 002-004 schema effects');
  }
  if (/\blease_expires_at\b|idx_translation_usage_lease|trg_translation_usage_reservation_lease/i.test(baseline)) {
    fail('004 baseline must remain strictly pre-005');
  }
  if (/\b(?:request_hash|replay_ciphertext|replay_expires_at)\b|idx_translation_usage_replay_expiry/i.test(baseline)) {
    fail('004 baseline must remain strictly pre-006');
  }

  const managedPath = path.join(root, MANAGED_DIR);
  const files = fs.readdirSync(managedPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => entry.name)
    .sort();
  if (files.length !== 1 || files[0] !== EXPECTED_MIGRATION) {
    fail(`005 admission must expose exactly one managed migration: ${EXPECTED_MIGRATION}`);
  }

  const sql = fs.readFileSync(path.join(managedPath, EXPECTED_MIGRATION), 'utf8');
  if (!/ALTER TABLE translation_usage ADD COLUMN lease_expires_at TEXT;/i.test(sql)) fail('005 lease column DDL missing');
  if (!/CREATE INDEX IF NOT EXISTS idx_translation_usage_lease/i.test(sql)) fail('005 lease index DDL missing');
  if (!/CREATE TRIGGER IF NOT EXISTS trg_translation_usage_reservation_lease/i.test(sql)) fail('005 lease trigger DDL missing');
  if (!/datetime\('now', '\+2 minutes'\)/i.test(sql)) fail('005 lease duration drifted');
  if (/\b(?:DROP|VACUUM|REPLACE)\b/i.test(sql)) fail('005 contains destructive or replacement SQL');
  if (/\b(?:request_hash|replay_ciphertext|replay_expires_at)\b/i.test(sql)) fail('006 replay schema must not cross the 005 admission boundary');
  return true;
}

function ledgerPresent(ledgerTableRows) {
  return ledgerTableRows.some(row => String(row?.name || '') === MANAGED_TABLE && String(row?.type || '') === 'table');
}

function inspect005({ schemaRows, objectRows, ledgerTableRows, ledgerRows }) {
  const columns = new Set(schemaRows.map(row => String(row?.name || '')));
  for (const column of REQUIRED_BASE_COLUMNS) {
    if (!columns.has(column)) fail(`translation_usage is missing required legacy column: ${column}`);
  }

  const objectTypes = new Map(objectRows.map(row => [String(row?.name || ''), String(row?.type || '')]));
  for (const futureColumn of FUTURE_COLUMNS) {
    if (columns.has(futureColumn)) fail(`future 006 column present before 005 admission: ${futureColumn}`);
  }
  if (objectTypes.has(FUTURE_INDEX)) fail(`future 006 index present before 005 admission: ${FUTURE_INDEX}`);

  const hasLeaseColumn = columns.has('lease_expires_at');
  const hasLeaseIndex = objectTypes.get(LEASE_INDEX) === 'index';
  const hasLeaseTrigger = objectTypes.get(LEASE_TRIGGER) === 'trigger';
  const leaseArtifactCount = Number(hasLeaseColumn) + Number(hasLeaseIndex) + Number(hasLeaseTrigger);

  const hasManagedLedger = ledgerPresent(ledgerTableRows);
  if (!hasManagedLedger && ledgerRows.length > 0) fail('managed ledger rows returned while the managed ledger table is absent');
  const ledgerNames = ledgerRows.map(row => String(row?.name || '')).filter(Boolean);
  const unknownLedgerNames = ledgerNames.filter(name => name !== EXPECTED_MIGRATION);
  if (unknownLedgerNames.length > 0) fail(`unexpected managed migration ledger entry: ${unknownLedgerNames.join(', ')}`);
  const recorded005 = ledgerNames.includes(EXPECTED_MIGRATION);

  if (leaseArtifactCount === 0 && !recorded005) return 'ready';
  if (leaseArtifactCount === 3 && recorded005) return 'already-applied';

  const state = [
    `lease_column=${hasLeaseColumn}`,
    `lease_index=${hasLeaseIndex}`,
    `lease_trigger=${hasLeaseTrigger}`,
    `ledger_table=${hasManagedLedger}`,
    `ledger_005=${recorded005}`,
  ].join(' ');
  fail(`partial or out-of-band 005 state detected: ${state}`);
}

function inspect005Files(schemaFile, objectsFile, ledgerTableFile, ledgerRowsFile) {
  return inspect005({
    schemaRows: rowsFromFile(schemaFile),
    objectRows: rowsFromFile(objectsFile),
    ledgerTableRows: rowsFromFile(ledgerTableFile),
    ledgerRows: rowsFromFile(ledgerRowsFile),
  });
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'validate-repo') {
    validateRepo();
    process.stdout.write('repo-valid\n');
    return;
  }
  if (command === 'ledger-present') {
    if (args.length !== 1) fail('ledger-present requires one JSON file');
    process.stdout.write(`${ledgerPresent(rowsFromFile(args[0])) ? 'yes' : 'no'}\n`);
    return;
  }
  if (command === 'inspect-005') {
    if (args.length !== 4) fail('inspect-005 requires schema, objects, ledger-table, and ledger-rows JSON files');
    process.stdout.write(`${inspect005Files(...args)}\n`);
    return;
  }
  if (command === 'verify-005') {
    if (args.length !== 4) fail('verify-005 requires schema, objects, ledger-table, and ledger-rows JSON files');
    const state = inspect005Files(...args);
    if (state !== 'already-applied') fail(`005 postflight state is ${state}, expected already-applied`);
    process.stdout.write('verified\n');
    return;
  }
  fail(`unknown command: ${command || '<empty>'}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`D1_MIGRATION_GUARD_FAIL ${error && error.message ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  BASELINE_FILE,
  DATABASE_ID,
  DATABASE_NAME,
  EXPECTED_MIGRATION,
  FUTURE_COLUMNS,
  FUTURE_INDEX,
  LEASE_INDEX,
  LEASE_TRIGGER,
  MANAGED_DIR,
  MANAGED_TABLE,
  REQUIRED_BASE_COLUMNS,
  inspect005,
  ledgerPresent,
  rowsFromPayload,
  validateRepo,
};
