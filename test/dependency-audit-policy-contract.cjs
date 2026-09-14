'use strict';

const assert = require('node:assert/strict');
const {
  ALLOWED_ADVISORIES,
  REVIEW_BY,
  validateAuditReports,
} = require('../scripts/dependency-audit-policy.cjs');

function advisory(source) {
  const expected = ALLOWED_ADVISORIES.get(String(source));
  return {
    source: Number(source),
    name: expected.package,
    dependency: expected.package,
    title: 'fixture',
    url: expected.url,
    severity: expected.severity,
    range: '*',
  };
}

function fixture() {
  const vulnerabilities = {
    'deepmerge-ts': {
      name: 'deepmerge-ts', severity: 'high', via: [advisory('1145093')], effects: ['webdriverio'], range: '*', nodes: ['node_modules/deepmerge-ts'], fixAvailable: false,
    },
    'extract-zip': {
      name: 'extract-zip', severity: 'high', via: [advisory('1139346'), advisory('1193685')], effects: ['@puppeteer/browsers'], range: '*', nodes: ['node_modules/extract-zip'], fixAvailable: false,
    },
    'serialize-javascript': {
      name: 'serialize-javascript', severity: 'high', via: [advisory('1113686'), advisory('1119440')], effects: ['mocha'], range: '*', nodes: ['node_modules/serialize-javascript'], fixAvailable: false,
    },
    webdriverio: {
      name: 'webdriverio', severity: 'high', via: ['deepmerge-ts'], effects: [], range: '*', nodes: ['node_modules/webdriverio'], fixAvailable: false,
    },
    '@puppeteer/browsers': {
      name: '@puppeteer/browsers', severity: 'high', via: ['extract-zip'], effects: [], range: '*', nodes: ['node_modules/@puppeteer/browsers'], fixAvailable: false,
    },
    mocha: {
      name: 'mocha', severity: 'high', via: ['serialize-javascript'], effects: [], range: '*', nodes: ['node_modules/mocha'], fixAvailable: false,
    },
  };
  const packages = {};
  for (const vulnerability of Object.values(vulnerabilities)) {
    for (const nodePath of vulnerability.nodes) packages[nodePath] = { version: '1.0.0', dev: true };
  }
  return {
    productionReport: { auditReportVersion: 2, vulnerabilities: {}, metadata: {} },
    fullReport: { auditReportVersion: 2, vulnerabilities, metadata: {} },
    lockfile: { lockfileVersion: 3, packages },
    now: new Date('2026-09-14T00:00:00Z'),
  };
}

const valid = validateAuditReports(fixture());
assert.equal(valid.productionVulnerabilities, 0);
assert.equal(valid.residualVulnerabilities, 6);
assert.equal(valid.advisoryCount, 5);
assert.equal(valid.reviewBy, REVIEW_BY);

{
  const input = fixture();
  input.productionReport.vulnerabilities['js-yaml'] = {
    name: 'js-yaml', severity: 'high', via: [], nodes: ['node_modules/js-yaml'], effects: [], range: '*', fixAvailable: true,
  };
  assert.throws(() => validateAuditReports(input), /production dependency audit must be clean/);
}

{
  const input = fixture();
  input.fullReport.vulnerabilities.webdriverio.severity = 'critical';
  assert.throws(() => validateAuditReports(input), /critical vulnerability is never allowed/);
}

{
  const input = fixture();
  input.fullReport.vulnerabilities['deepmerge-ts'].via.push({ ...advisory('1145093'), source: 9999999 });
  assert.throws(() => validateAuditReports(input), /unapproved advisory source 9999999/);
}

{
  const input = fixture();
  input.lockfile.packages['node_modules/webdriverio'].dev = false;
  assert.throws(() => validateAuditReports(input), /reaches non-dev lockfile node/);
}

{
  const input = fixture();
  delete input.lockfile.packages['node_modules/mocha'];
  assert.throws(() => validateAuditReports(input), /references missing lockfile node/);
}

{
  const input = fixture();
  input.fullReport.vulnerabilities.webdriverio.via = ['missing-provenance'];
  assert.throws(() => validateAuditReports(input), /missing vulnerability provenance/);
}

{
  const input = fixture();
  input.now = new Date('2026-10-15T00:00:00Z');
  assert.throws(() => validateAuditReports(input), /dependency audit exception expired/);
}

{
  const input = fixture();
  input.fullReport.vulnerabilities['serialize-javascript'].via = [advisory('1113686')];
  assert.throws(() => validateAuditReports(input), /approved advisory set changed/);
}

console.log('DEPENDENCY_AUDIT_POLICY_CONTRACT_OK');
