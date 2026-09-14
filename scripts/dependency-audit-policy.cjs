'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fail(message) {
  const error = new Error(message);
  error.code = 'DEPENDENCY_AUDIT_POLICY_VIOLATION';
  throw error;
}

function assertAuditShape(report, label) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail(`${label} audit report must be an object`);
  if (report.auditReportVersion !== 2) fail(`${label} audit report must use auditReportVersion=2`);
  if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    fail(`${label} audit report must contain a vulnerabilities object`);
  }
}

function vulnerabilityNames(report) {
  return Object.keys(report.vulnerabilities).sort();
}

function requireCleanAudit(report, label) {
  const names = vulnerabilityNames(report);
  if (names.length > 0) fail(`${label} dependency audit must be clean; found ${names.join(', ')}`);
  return 0;
}

function validateAuditReports({ productionReport, fullReport }) {
  assertAuditShape(productionReport, 'production');
  assertAuditShape(fullReport, 'full');

  return {
    productionVulnerabilities: requireCleanAudit(productionReport, 'production'),
    fullVulnerabilities: requireCleanAudit(fullReport, 'full'),
  };
}

function runNpmAudit(args, cwd) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, ['audit', ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    fail(`npm audit ${args.join(' ')} failed with exit ${result.status}: ${(result.stderr || '').trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`npm audit ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function main() {
  const root = path.join(__dirname, '..');
  const productionReport = runNpmAudit(['--omit=dev'], root);
  const fullReport = runNpmAudit([], root);
  const result = validateAuditReports({ productionReport, fullReport });
  process.stdout.write(
    `DEPENDENCY_AUDIT_POLICY_OK prod=${result.productionVulnerabilities} full=${result.fullVulnerabilities}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`DEPENDENCY_AUDIT_POLICY_FAIL ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  validateAuditReports,
};
