'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REVIEW_BY = '2026-10-14';
const ALLOWED_ADVISORIES = new Map([
  ['1145093', { package: 'deepmerge-ts', severity: 'high', url: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx' }],
  ['1139346', { package: 'extract-zip', severity: 'high', url: 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv' }],
  ['1193685', { package: 'extract-zip', severity: 'high', url: 'https://github.com/advisories/GHSA-7pqw-9j4j-h8q3' }],
  ['1113686', { package: 'serialize-javascript', severity: 'high', url: 'https://github.com/advisories/GHSA-5c6j-r48x-rmvq' }],
  ['1119440', { package: 'serialize-javascript', severity: 'moderate', url: 'https://github.com/advisories/GHSA-qj8w-gfj5-8c6v' }],
]);

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

function utcDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail('policy clock must be a valid date');
  return date.toISOString().slice(0, 10);
}

function advisoryKey(advisory) {
  if (!advisory || typeof advisory !== 'object' || Array.isArray(advisory)) fail('direct advisory provenance must be an object');
  if (!Number.isInteger(advisory.source) && typeof advisory.source !== 'string') fail('direct advisory must contain a source id');
  return String(advisory.source);
}

function resolveAdvisories(vulnerabilities, packageName, memo = new Map(), visiting = new Set()) {
  if (memo.has(packageName)) return memo.get(packageName);
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability) fail(`missing vulnerability provenance for ${packageName}`);
  if (visiting.has(packageName)) fail(`cyclic vulnerability provenance at ${packageName}`);
  visiting.add(packageName);

  if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    fail(`${packageName} must expose advisory provenance through via[]`);
  }

  const advisories = new Map();
  for (const entry of vulnerability.via) {
    if (typeof entry === 'string') {
      const nested = resolveAdvisories(vulnerabilities, entry, memo, visiting);
      for (const [source, advisory] of nested) advisories.set(source, advisory);
      continue;
    }
    const source = advisoryKey(entry);
    advisories.set(source, entry);
  }

  visiting.delete(packageName);
  if (advisories.size === 0) fail(`${packageName} must resolve to at least one direct advisory`);
  memo.set(packageName, advisories);
  return advisories;
}

function validateAllowedAdvisory(advisory) {
  const source = advisoryKey(advisory);
  const expected = ALLOWED_ADVISORIES.get(source);
  if (!expected) fail(`unapproved advisory source ${source}`);
  if (advisory.name !== expected.package) fail(`advisory ${source} package changed: ${advisory.name}`);
  if (advisory.severity !== expected.severity) fail(`advisory ${source} severity changed: ${advisory.severity}`);
  if (advisory.url !== expected.url) fail(`advisory ${source} URL changed: ${advisory.url}`);
  if (advisory.severity === 'critical') fail(`critical advisory ${source} is never allowed`);
  return source;
}

function validateAuditReports({ productionReport, fullReport, lockfile, now = new Date() }) {
  assertAuditShape(productionReport, 'production');
  assertAuditShape(fullReport, 'full');
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.packages || typeof lockfile.packages !== 'object') {
    fail('package-lock.json must contain a packages object');
  }

  const today = utcDateString(now);
  if (today > REVIEW_BY) fail(`dependency audit exception expired after ${REVIEW_BY}`);

  const productionNames = Object.keys(productionReport.vulnerabilities);
  if (productionNames.length > 0) fail(`production dependency audit must be clean; found ${productionNames.join(', ')}`);

  const vulnerabilities = fullReport.vulnerabilities;
  const vulnerabilityNames = Object.keys(vulnerabilities);
  const observedSources = new Set();
  const memo = new Map();

  for (const packageName of vulnerabilityNames) {
    const vulnerability = vulnerabilities[packageName];
    if (vulnerability.severity === 'critical') fail(`critical vulnerability is never allowed: ${packageName}`);
    if (!Array.isArray(vulnerability.nodes) || vulnerability.nodes.length === 0) {
      fail(`${packageName} must identify vulnerable lockfile nodes`);
    }
    for (const nodePath of vulnerability.nodes) {
      const locked = lockfile.packages[nodePath];
      if (!locked) fail(`${packageName} references missing lockfile node ${nodePath}`);
      if (locked.dev !== true) fail(`${packageName} reaches non-dev lockfile node ${nodePath}`);
    }

    const advisories = resolveAdvisories(vulnerabilities, packageName, memo);
    for (const advisory of advisories.values()) observedSources.add(validateAllowedAdvisory(advisory));
  }

  const expectedSources = [...ALLOWED_ADVISORIES.keys()].sort();
  const actualSources = [...observedSources].sort();
  if (actualSources.length !== expectedSources.length || actualSources.some((source, index) => source !== expectedSources[index])) {
    fail(`approved advisory set changed; expected ${expectedSources.join(',')} got ${actualSources.join(',') || 'none'}`);
  }

  return {
    productionVulnerabilities: productionNames.length,
    residualVulnerabilities: vulnerabilityNames.length,
    advisoryCount: observedSources.size,
    reviewBy: REVIEW_BY,
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
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const productionReport = runNpmAudit(['--omit=dev'], root);
  const fullReport = runNpmAudit([], root);
  const result = validateAuditReports({ productionReport, fullReport, lockfile });
  process.stdout.write(
    `DEPENDENCY_AUDIT_POLICY_OK prod=${result.productionVulnerabilities} residual=${result.residualVulnerabilities} advisories=${result.advisoryCount} reviewBy=${result.reviewBy}\n`,
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
  ALLOWED_ADVISORIES,
  REVIEW_BY,
  resolveAdvisories,
  validateAuditReports,
};
