'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fail(message) {
  const error = new Error(message);
  error.code = 'DEPENDENCY_AUDIT_POLICY_VIOLATION';
  throw error;
}

// Documented audit exceptions. Each entry pins ONE advisory (GHSA id) for ONE
// package. An exception is granted only when every advisory reachable from a
// flagged package is pinned here. Anything else still fails the gate,
// including a future advisory against an already-excepted package.
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

// Packages still affected by a non-excused advisory, computed by taint
// propagation. Seeds are packages with a non-excused advisory object in
// `via`, an empty `via`, or an unrecognised `via` item (fail closed). Taint
// then spreads to any package whose `via` names a tainted package, i.e. to
// dependents. This direction matters: npm audit's `via` can contain cycles
// (app-builder-lib lists dmg-builder and electron-builder-squirrel-windows,
// which list app-builder-lib back), so propagating "excused" outward from
// the vulnerable package deadlocks on the cycle, while propagating "tainted"
// inward from non-excused advisories terminates and is cycle-safe.
function taintedPackages(report) {
  const entries = report.vulnerabilities;
  const tainted = new Set();
  for (const [name, entry] of Object.entries(entries)) {
    const via = Array.isArray(entry.via) ? entry.via : [];
    let seed = via.length === 0;
    for (const item of via) {
      if (typeof item === 'string') continue;
      const ghsaId = ghsaIdFromViaItem(item);
      if (exceptionFor(ghsaId, item.name || name) === undefined) seed = true;
    }
    if (seed) tainted.add(name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(entries)) {
      if (tainted.has(name)) continue;
      const via = Array.isArray(entry.via) ? entry.via : [];
      if (via.some((item) => typeof item === 'string' && tainted.has(item))) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
}

// GHSA ids actually relied on to pass this report: excused advisories that
// appear in the `via` of a flagged package. Only meaningful when the gate
// passes (then every flagged package is untainted, so every excused advisory
// present is genuinely covering something).
function appliedExceptions(report) {
  const applied = new Set();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
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

function detailFor(report, names) {
  return names.map((name) => {
    const entry = report.vulnerabilities[name];
    const via = Array.isArray(entry.via) ? entry.via : [];
    return {
      name,
      severity: entry.severity,
      via: via.map((item) => (typeof item === 'string' ? item : {
        name: item.name,
        url: item.url,
        range: item.range,
      })),
    };
  });
}

function requireCleanAudit(report, label, { allowExceptions = false } = {}) {
  const names = vulnerabilityNames(report);
  if (names.length === 0) return { remaining: [], exceptionsApplied: [] };
  if (allowExceptions) {
    const tainted = taintedPackages(report);
    const remaining = names.filter((name) => tainted.has(name));
    if (remaining.length === 0) {
      return { remaining: [], exceptionsApplied: appliedExceptions(report) };
    }
    process.stderr.write(`DEPENDENCY_AUDIT_POLICY_DETAIL ${JSON.stringify(detailFor(report, remaining))}\n`);
    fail(`${label} dependency audit must be clean; found ${remaining.join(', ')}`);
  }
  process.stderr.write(`DEPENDENCY_AUDIT_POLICY_DETAIL ${JSON.stringify(detailFor(report, names))}\n`);
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
