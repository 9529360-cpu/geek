'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'windows-real-client-regression.yml');
const collectorPath = path.join(root, 'scripts', 'windows-real-client-evidence.ps1');
const collector = fs.readFileSync(collectorPath, 'utf8').replace(/\r\n?/g, '\n');

assert.equal(
  fs.existsSync(workflowPath),
  false,
  'real-client/profile evidence must remain outside GitHub Actions because hosted runners are ephemeral and self-hosted CI is retired',
);

assert.match(collector, /ValidateSet\('probe', 'pre-update', 'post-update'\)/, 'collector phases must remain explicit');
assert.match(collector, /Pre-update evidence requires installed Geek 1\.2\.8/, 'collector must fail closed when pre-update baseline is not 1.2.8');
assert.match(collector, /Post-update evidence requires installed Geek 1\.2\.9/, 'collector must fail closed when post-update client is not 1.2.9');
assert.match(collector, /rawAccountDataIncluded = \$false/, 'collector must declare raw account data excluded');
assert.match(collector, /cookieDataIncluded = \$false/, 'collector must declare cookies excluded');
assert.match(collector, /tokensIncluded = \$false/, 'collector must declare tokens excluded');
assert.match(collector, /chatContentIncluded = \$false/, 'collector must declare chat content excluded');
assert.doesNotMatch(collector, /Get-Content[^\n]*(accounts\.json|config\.json|line-tokens\.json)/i, 'collector must not read sensitive state files as text');
assert.doesNotMatch(collector, /Invoke-WebRequest|Invoke-RestMethod|curl|wget/i, 'collector must not upload or call external services itself');
assert.match(collector, /PSObject\.Properties\[\$Name\]/, 'collector must read optional registry properties safely under StrictMode');
assert.doesNotMatch(collector, /\$entry\.Display(Name|Icon|Version|InstallLocation)/, 'collector must not directly dereference optional uninstall registry properties');

console.log('WINDOWS_REAL_CLIENT_REGRESSION_CONTRACT_OK');
