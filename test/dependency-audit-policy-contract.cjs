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

const valid = validateAuditReports({
  productionReport: report(),
  fullReport: report(),
});
assert.deepEqual(valid, {
  productionVulnerabilities: 0,
  fullVulnerabilities: 0,
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

console.log('DEPENDENCY_AUDIT_POLICY_CONTRACT_OK');
