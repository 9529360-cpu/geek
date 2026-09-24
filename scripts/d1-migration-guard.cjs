'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PREVIOUS_MIGRATION = '005-translation-reservation-lease.sql';
const EXPECTED_MIGRATION = '006-translation-outcome-replay.sql';
const MANAGED_DIR = 'scripts/d1-migrations';
const MANAGED_TABLE = 'geek_d1_migrations';
const BASELINE_FILE = 'scripts/d1-baselines/005-translation-reservation-schema.sql';
const DATABASE_NAME = 'geek-subscriptions';
const DATABASE_ID = '1e78a93a-36de-43db-88aa-4551f9991200';
const REQUIRED_PRE006_COLUMNS = Object.freeze([
  'request_id',
  'user_id',
  'reserved_chars',
  'target_chars',
  'status',
  'created_at',
  'completed_at',
  'lease_expires_at',
]);
const REPLAY_COLUMNS = Object.freeze(['request_hash', 'replay_ciphertext', 'replay_expires_at']);
const LEASE_INDEX = 'idx_translation_usage_lease';
const LEASE_TRIGGER = 'trg_translation_usage_reservation_lease';
const REPLAY_INDEX = 'idx_translation_usage_replay_expiry';

function rowsFromPayload(payload) {
  const rows = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (Array.isArray(value.results)) rows.push(...value.results);
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
  if (!usageMatch) fail('005 baseline translation_usage table missing');
  for (const column of REQUIRED_PRE006_COLUMNS) {
    if (!new RegExp(`\\b${column}\\b`, 'i').test(usageMatch[1])) fail(`005 baseline is missing translation_usage.${column}`);
  }
  if (!/CREATE INDEX IF NOT EXISTS idx_translation_usage_lease/i.test(baseline)) fail('005 baseline lease index missing');
  if (!/CREATE TRIGGER IF NOT EXISTS trg_translation_usage_reservation_lease/i.test(baseline)) fail('005 baseline lease trigger missing');
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${MANAGED_TABLE}\\b`, 'i').test(baseline)) fail('005 baseline managed ledger table missing');
  if (!baseline.includes(PREVIOUS_MIGRATION)) fail('005 baseline managed ledger row missing');
  if (/\b(?:request_hash|replay_ciphertext|replay_expires_at)\b|idx_translation_usage_replay_expiry/i.test(baseline)) {
    fail('005 baseline must remain strictly pre-006');
  }

  const managedPath = path.join(root, MANAGED_DIR);
  const files = fs.readdirSync(managedPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => entry.name)
    .sort();
  if (files.length !== 1 || files[0] !== EXPECTED_MIGRATION) {
    fail(`006 admission must expose exactly one managed migration: ${EXPECTED_MIGRATION}`);
  }

  const sql = fs.readFileSync(path.join(managedPath, EXPECTED_MIGRATION), 'utf8');
  for (const column of REPLAY_COLUMNS) {
    if (!new RegExp(`ALTER TABLE translation_usage ADD COLUMN ${column} TEXT;`, 'i').test(sql)) {
      fail(`006 replay column DDL missing: ${column}`);
    }
  }
  if (!/CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry/i.test(sql)) fail('006 replay expiry index DDL missing');
  if (/\b(?:DROP|VACUUM|REPLACE|DELETE)\b/i.test(sql)) fail('006 contains destructive or replacement SQL');
  if (/lease_expires_at|idx_translation_usage_lease|trg_translation_usage_reservation_lease/i.test(sql)) {
    fail('006 must not re-own the already-applied 005 lease schema');
  }

  const canonical = fs.readFileSync(path.join(root, 'scripts/geek-subscription-schema.sql'), 'utf8');
  for (const column of REPLAY_COLUMNS) {
    if (!new RegExp(`\\b${column}\\s+TEXT\\b`, 'i').test(canonical)) fail(`canonical schema missing translation_usage.${column}`);
  }
  if (!/CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry/i.test(canonical)) fail('canonical schema missing replay expiry index');
  return true;
}

function ledgerPresent(ledgerTableRows) {
  return ledgerTableRows.some(row => String(row?.name || '') === MANAGED_TABLE && String(row?.type || '') === 'table');
}

function inspect006({ schemaRows, objectRows, ledgerTableRows, ledgerRows }) {
  const columns = new Set(schemaRows.map(row => String(row?.name || '')));
  for (const column of REQUIRED_PRE006_COLUMNS) {
    if (!columns.has(column)) fail(`translation_usage is missing required pre-006 column: ${column}`);
  }

  const objectTypes = new Map(objectRows.map(row => [String(row?.name || ''), String(row?.type || '')]));
  if (objectTypes.get(LEASE_INDEX) !== 'index') fail('pre-006 lease index is missing');
  if (objectTypes.get(LEASE_TRIGGER) !== 'trigger') fail('pre-006 lease trigger is missing');

  const hasManagedLedger = ledgerPresent(ledgerTableRows);
  if (!hasManagedLedger) fail('managed migration ledger is missing before 006');
  const ledgerNames = ledgerRows.map(row => String(row?.name || '')).filter(Boolean);
  const unknownLedgerNames = ledgerNames.filter(name => name !== PREVIOUS_MIGRATION && name !== EXPECTED_MIGRATION);
  if (unknownLedgerNames.length > 0) fail(`unexpected managed migration ledger entry: ${unknownLedgerNames.join(', ')}`);
  const recorded005 = ledgerNames.includes(PREVIOUS_MIGRATION);
  const recorded006 = ledgerNames.includes(EXPECTED_MIGRATION);
  if (!recorded005) fail('managed migration 005 must be recorded before 006');

  const replayColumnCount = REPLAY_COLUMNS.reduce((count, column) => count + Number(columns.has(column)), 0);
  const hasReplayIndex = objectTypes.get(REPLAY_INDEX) === 'index';
  const replayArtifactCount = replayColumnCount + Number(hasReplayIndex);

  if (replayArtifactCount === 0 && !recorded006) return 'ready';
  if (replayArtifactCount === REPLAY_COLUMNS.length + 1 && recorded006) return 'already-applied';

  const state = [
    ...REPLAY_COLUMNS.map(column => `${column}=${columns.has(column)}`),
    `replay_index=${hasReplayIndex}`,
    `ledger_005=${recorded005}`,
    `ledger_006=${recorded006}`,
  ].join(' ');
  fail(`partial or out-of-band 006 state detected: ${state}`);
}

function inspect006Files(schemaFile, objectsFile, ledgerTableFile, ledgerRowsFile) {
  return inspect006({
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
  if (command === 'inspect-006') {
    if (args.length !== 4) fail('inspect-006 requires schema, objects, ledger-table, and ledger-rows JSON files');
    process.stdout.write(`${inspect006Files(...args)}\n`);
    return;
  }
  if (command === 'verify-006') {
    if (args.length !== 4) fail('verify-006 requires schema, objects, ledger-table, and ledger-rows JSON files');
    const state = inspect006Files(...args);
    if (state !== 'already-applied') fail(`006 postflight state is ${state}, expected already-applied`);
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
  LEASE_INDEX,
  LEASE_TRIGGER,
  MANAGED_DIR,
  MANAGED_TABLE,
  PREVIOUS_MIGRATION,
  REPLAY_COLUMNS,
  REPLAY_INDEX,
  REQUIRED_PRE006_COLUMNS,
  inspect006,
  ledgerPresent,
  rowsFromPayload,
  validateRepo,
};
