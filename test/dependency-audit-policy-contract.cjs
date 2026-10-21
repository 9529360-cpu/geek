'use strict';

const assert = require('node:assert/strict');
const { validateAuditReports } = require('../scripts/dependency-audit-policy.cjs');

function report(vulnerabilities = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {},
  };
}

function advisoryEntry(name, { ghsa, via = null, severity = 'medium' } = {}) {
  return {
    name,
    severity,
    via: via ?? [{
      name,
      url: `https://github.com/advisories/${ghsa}`,
      severity,
      range: '<=1.1.3',
      title: 'sprintf-js has an unbounded precision specifier denial of service',
    }],
    nodes: [`node_modules/${name}`],
    effects: [],
    range: '*',
    fixAvailable: false,
  };
}

const valid = validateAuditReports({
  productionReport: report(),
  fullReport: report(),
});
assert.deepEqual(valid, {
  productionVulnerabilities: 0,
  fullVulnerabilities: 0,
  exceptionsApplied: [],
});

{
  const productionReport = report({
    'runtime-package': {
      name: 'runtime-package', severity: 'moderate', via: [], nodes: ['node_modules/runtime-package'], effects: [], range: '*', fixAvailable: true,
    },
  });
  assert.throws(
    () => validateAuditReports({ productionReport, fullReport: report() }),
    /production dependency audit must be clean; found runtime-package/,
  );
}

{
  const fullReport = report({
    'dev-package': {
      name: 'dev-package', severity: 'low', via: [], nodes: ['node_modules/dev-package'], effects: [], range: '*', fixAvailable: true,
    },
  });
  assert.throws(
    () => validateAuditReports({ productionReport: report(), fullReport }),
    /full dependency audit must be clean; found dev-package/,
  );
}

assert.throws(
  () => validateAuditReports({ productionReport: { auditReportVersion: 1, vulnerabilities: {} }, fullReport: report() }),
  /production audit report must use auditReportVersion=2/,
);

assert.throws(
  () => validateAuditReports({ productionReport: report(), fullReport: { auditReportVersion: 2 } }),
  /full audit report must contain a vulnerabilities object/,
);

// Documented exception: sprintf-js GHSA-hp3w-g68c-fv3c alone passes, and the
// applied exception is reported.
{
  const result = validateAuditReports({
    productionReport: report(),
    fullReport: report({
      'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-hp3w-g68c-fv3c' }),
    }),
  });
  assert.deepEqual(result.exceptionsApplied, ['GHSA-hp3w-g68c-fv3c']);
}

// The real-world shape: sprintf-js plus the parent chain flagged only via
// excused advisory roots passes as one documented exception. Note the cycle:
// app-builder-lib lists dmg-builder and electron-builder-squirrel-windows,
// which list app-builder-lib back (verified from the CI audit report).
{
  const result = validateAuditReports({
    productionReport: report(),
    fullReport: report({
      'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-hp3w-g68c-fv3c' }),
      roarr: advisoryEntry('roarr', { via: ['sprintf-js'] }),
      'global-agent': advisoryEntry('global-agent', { via: ['roarr'] }),
      '@electron/get': advisoryEntry('@electron/get', { via: ['global-agent'] }),
      'app-builder-lib': advisoryEntry('app-builder-lib', { via: ['@electron/get', 'dmg-builder', 'electron-builder-squirrel-windows'] }),
      'dmg-builder': advisoryEntry('dmg-builder', { via: ['app-builder-lib'] }),
      'electron-builder': advisoryEntry('electron-builder', { via: ['app-builder-lib', 'dmg-builder'] }),
      'electron-builder-squirrel-windows': advisoryEntry('electron-builder-squirrel-windows', { via: ['app-builder-lib'] }),
    }),
  });
  assert.deepEqual(result.exceptionsApplied, ['GHSA-hp3w-g68c-fv3c']);
}

// A future, unpinned advisory against the same package still fails the gate,
// and taints the whole chain that depends on it.
{
  const fullReport = report({
    'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-xxxx-yyyy-zzzz' }),
    roarr: advisoryEntry('roarr', { via: ['sprintf-js'] }),
    'global-agent': advisoryEntry('global-agent', { via: ['roarr'] }),
  });
  assert.throws(
    () => validateAuditReports({ productionReport: report(), fullReport }),
    /full dependency audit must be clean; found .*sprintf-js/,
  );
}

// The exception never applies to production: zero tolerance there.
{
  const productionReport = report({
    'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-hp3w-g68c-fv3c' }),
  });
  assert.throws(
    () => validateAuditReports({ productionReport, fullReport: report() }),
    /production dependency audit must be clean; found sprintf-js/,
  );
}

// Mixed report: the excused package passes, the unexcused one still fails and
// is the only name in the error.
{
  const fullReport = report({
    'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-hp3w-g68c-fv3c' }),
    'other-package': advisoryEntry('other-package', { ghsa: 'GHSA-aaaa-bbbb-cccc' }),
  });
  assert.throws(
    () => validateAuditReports({ productionReport: report(), fullReport }),
    /full dependency audit must be clean; found other-package$/,
  );
}

// A package flagged with an empty `via` (unknown shape) is never excused.
{
  const fullReport = report({
    'sprintf-js': advisoryEntry('sprintf-js', { ghsa: 'GHSA-hp3w-g68c-fv3c' }),
    'mystery-package': advisoryEntry('mystery-package', { via: [] }),
  });
  assert.throws(
    () => validateAuditReports({ productionReport: report(), fullReport }),
    /full dependency audit must be clean; found mystery-package$/,
  );
}

console.log('DEPENDENCY_AUDIT_POLICY_CONTRACT_OK');
