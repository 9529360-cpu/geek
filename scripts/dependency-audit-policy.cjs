'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fail(message) {
  const error = new Error(message);
  error.code = 'DEPENDENCY_AUDIT_POLICY_VIOLATION';
  throw error;
}

// Documented audit exceptions. Each entry pins ONE advisory (GHSA id) for ONE
// package. An exception is granted only when every advisory behind a flagged
// package is pinned here (directly, or transitively through an excused
// package). Anything else still fails the gate, including a future advisory
// against an already-excepted package.
const AUDIT_EXCEPTIONS = [
  {
    ghsa: 'GHSA-hp3w-g68c-fv3c',
    package: 'sprintf-js',
    // Rationale, recorded 2026-10-21 (see the audit-fix PR for the evidence):
    // - CVE-2026-97058: denial of service via unbounded precision specifiers.
    //   It requires attacker-controlled format strings. In this tree sprintf-js
    //   is reached only through roarr's logger from @electron/get/global-agent
    //   build-time code with hardcoded format strings; no user input reaches a
    //   format string, and sprintf-js never ships in the client (the production
    //   audit is clean; sprintf-js is dev-only).
    // - No patched version exists (first_patched_version is null; 1.1.3 is the
    //   latest release), so no upgrade can clear it.
    // - The chain cannot be upgraded away: electron-builder and @electron/get
    //   latest versions equal the locked ones (26.15.3 / 5.1.0), and the only
    //   newer majors (global-agent 4.x, roarr 7.x) break the parents' ranges
    //   and would put the release chain at risk.
    // Re-check trigger: a patched sprintf-js release, or an
    // electron-builder/@electron/get release that drops the sprintf-js chain.
    reviewTrigger: 'patched sprintf-js release or electron-builder/@electron/get chain upgrade',
  },
];

function exceptionFor(ghsaId, packageName) {
  if (ghsaId === null) return undefined;
  return AUDIT_EXCEPTIONS.find(
    (entry) => entry.ghsa.toLowerCase() === ghsaId.toLowerCase() && entry.package === packageName,
  );
}

function ghsaIdFromViaItem(item) {
  if (!item || typeof item !== 'object' || typeof item.url !== 'string') return null;
  const match = item.url.match(/GHSA-[a-z0-9-]+/i);
  return match ? match[0] : null;
}

// Packages excused through the documented exceptions, computed to a fixpoint:
// a package is excused when its `via` list is non-empty and every entry is
// either an excepted advisory object or the name of an already-excused package.
// Entries with an empty or unrecognised `via` are never excused (fail closed).
function excusedPackages(report) {
  const entries = report.vulnerabilities;
  const excused = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(entries)) {
      if (excused.has(name)) continue;
      const via = Array.isArray(entry.via) ? entry.via : [];
      if (via.length === 0) continue;
      const allExcused = via.every((item) => {
        if (typeof item === 'string') return excused.has(item);
        const ghsaId = ghsaIdFromViaItem(item);
        return exceptionFor(ghsaId, item.name || name) !== undefined;
      });
      if (allExcused) {
        excused.add(name);
        changed = true;
      }
    }
  }
  return excused;
}

// GHSA ids actually relied on to excuse something in this report.
function appliedExceptions(report, excused) {
  const applied = new Set();
  for (const name of excused) {
    const entry = report.vulnerabilities[name];
    const via = Array.isArray(entry.via) ? entry.via : [];
    for (const item of via) {
      if (item && typeof item === 'object') {
        const ghsaId = ghsaIdFromViaItem(item);
        if (ghsaId !== null && exceptionFor(ghsaId, item.name || name) !== undefined) {
          applied.add(ghsaId);
        }
      }
    }
  }
  return [...applied].sort();
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

function requireCleanAudit(report, label, { allowExceptions = false } = {}) {
  const names = vulnerabilityNames(report);
  if (names.length === 0) return { remaining: [], exceptionsApplied: [] };
  if (allowExceptions) {
    const excused = excusedPackages(report);
    const remaining = names.filter((name) => !excused.has(name));
    if (remaining.length === 0) {
      return { remaining: [], exceptionsApplied: appliedExceptions(report, excused) };
    }
    fail(`${label} dependency audit must be clean; found ${remaining.join(', ')}`);
  }
  fail(`${label} dependency audit must be clean; found ${names.join(', ')}`);
  return { remaining: [], exceptionsApplied: [] };
}

function validateAuditReports({ productionReport, fullReport }) {
  assertAuditShape(productionReport, 'production');
  assertAuditShape(fullReport, 'full');

  // Production is zero-tolerance: documented exceptions never apply there.
  requireCleanAudit(productionReport, 'production');
  const full = requireCleanAudit(fullReport, 'full', { allowExceptions: true });

  return {
    productionVulnerabilities: 0,
    fullVulnerabilities: 0,
    exceptionsApplied: full.exceptionsApplied,
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
  if (result.exceptionsApplied.length > 0) {
    process.stdout.write(
      `DEPENDENCY_AUDIT_POLICY_EXCEPTION applied ${result.exceptionsApplied.join(', ')} (documented dev-only exception; see scripts/dependency-audit-policy.cjs)\n`,
    );
  }
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
  AUDIT_EXCEPTIONS,
};
