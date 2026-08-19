'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs
  .readFileSync(path.join(root, '.github', 'workflows', 'release-client.yml'), 'utf8')
  .replace(/\r\n?/g, '\n');

const capture = workflow.indexOf('- name: Capture previous stable metadata');
const upload = workflow.indexOf('- name: Upload installer and blockmap to R2');
const snapshot = workflow.indexOf('- name: Snapshot rollback metadata');
const publish = workflow.indexOf('- name: Publish latest metadata last');
const verify = workflow.indexOf('- name: Verify production and rollback on failure');

for (const [name, index] of Object.entries({ capture, upload, snapshot, publish, verify })) {
  assert.ok(index >= 0, `release workflow must contain ${name} stage`);
}
assert.ok(capture < upload, 'previous stable metadata must be captured before new artifacts are uploaded');
assert.ok(upload < snapshot, 'new immutable artifacts should upload before rollback metadata snapshot');
assert.ok(snapshot < publish, 'rollback snapshot must exist before production latest.yml is overwritten');
assert.ok(publish < verify, 'production metadata must be verified after promotion');

assert.match(workflow, /geek-release\/rollback\/latest\.yml/, 'release workflow must keep a private rollback metadata snapshot');
assert.match(workflow, /geek-release\/rollback\/latest-\$env:PREVIOUS_RELEASE_VERSION\.yml/, 'release workflow must keep a versioned rollback metadata snapshot');
assert.match(workflow, /r2 object put 'geek-release\/latest\.yml' --file 'dist-release\/previous-latest\.yml' --remote/, 'failed promotion must restore previous latest.yml');
assert.match(workflow, /function Test-PublicRelease/, 'release verification must use a bounded retry helper');
assert.match(workflow, /function Invoke-PublicRequestWithRetry/, 'rollback metadata preflight must use a bounded GET helper');
assert.match(workflow, /function Test-PublicArtifactWithRetry/, 'rollback artifact preflight must use a bounded ranged GET helper');
assert.match(workflow, /function Test-PublicArtifact\(/, 'post-promotion verification must avoid the Windows HEAD path');
assert.match(workflow, /for \(\$attempt = 1; \$attempt -le \$Attempts; \$attempt\+\+\)/, 'rollback preflight retries must be explicitly bounded');
assert.match(workflow, /if \(\$attempt -lt \$Attempts\) \{ Start-Sleep -Seconds 10 \}/, 'rollback preflight must tolerate transient edge propagation failures');
assert.match(workflow, /curl\.exe --silent --show-error --location --range 0-0 --output NUL --write-out '%\{http_code\}' --max-time 90/, 'public artifact checks must discard bodies and use ranged GET status verification');
assert.doesNotMatch(workflow, /Invoke-WebRequest[^\n]*-Method Head/, 'Windows release checks must not use the unreliable Invoke-WebRequest HEAD path');
assert.match(workflow, /\(\?m\)\^path:\\s\*\(geek-setup-\[0-9\]\+/, 'rollback preflight must parse the installer path declared by latest.yml');
assert.match(workflow, /\$previousPath = \$pathMatch\.Groups\[1\]\.Value/, 'rollback preflight must retain the declared installer path');
assert.match(workflow, /\$previousPath -ne "geek-setup-\$previousVersion\.exe"/, 'declared installer path must agree with the declared version');
assert.match(workflow, /Test-PublicArtifactWithRetry "\$root\/\$previousPath\?before=\$nonce"/, 'previous installer verification must use the declared path and ranged GET retry helper');
assert.match(workflow, /Test-PublicArtifactWithRetry "\$root\/\$previousPath\.blockmap\?before=\$nonce"/, 'previous blockmap verification must use the declared path and ranged GET retry helper');
assert.match(workflow, /\$exeOk = Test-PublicArtifact "\$root\/\$base\?release=\$nonce"/, 'new installer verification must use ranged GET');
assert.match(workflow, /\$mapOk = Test-PublicArtifact "\$root\/\$base\.blockmap\?release=\$nonce"/, 'new blockmap verification must use ranged GET');
assert.match(workflow, /Start-Sleep -Seconds 10/, 'release verification must tolerate update-source propagation delay');
assert.match(workflow, /ROLLBACK_AVAILABLE=true/, 'rollback may only be enabled after a previous stable release is verified');
assert.match(workflow, /previous stable artifacts are not reachable/, 'rollback target must require reachable installer and blockmap');
assert.match(workflow, /Refusing promotion without a verified previous stable release/, 'new promotions must still fail closed after retry exhaustion');
assert.match(workflow, /public metadata request failed after \$Attempts attempts/, 'metadata retry exhaustion must produce an explicit failure');
assert.match(workflow, /public artifact ranged GET failed after \$Attempts attempts/, 'artifact retry exhaustion must produce an explicit failure');
assert.match(workflow, /Production already reports \$previousVersion; treating this as an idempotent rerun/, 'same-version reruns may proceed without requiring an older rollback target');
assert.match(workflow, /^  workflow_dispatch:$/m, 'failed releases must have a deliberate same-version retry entrypoint');
assert.match(workflow, /paths:\s*\n\s*- '\.github\/release-client-version'/, 'normal master pushes must not publish a client release');

console.log('release-rollback-contract: ok');
