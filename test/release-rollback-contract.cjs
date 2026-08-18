'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-client.yml'), 'utf8');

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
assert.match(workflow, /Start-Sleep -Seconds 10/, 'release verification must tolerate update-source propagation delay');
assert.match(workflow, /ROLLBACK_AVAILABLE=true/, 'rollback may only be enabled after a previous stable release is verified');
assert.match(workflow, /previous stable artifacts are not reachable/, 'rollback target must require reachable installer and blockmap');
assert.match(workflow, /Refusing promotion without a verified previous stable release/, 'new promotions must fail closed when no rollback target can be verified');
assert.match(workflow, /Production already reports \$previousVersion; treating this as an idempotent rerun/, 'same-version reruns may proceed without requiring an older rollback target');
assert.match(workflow, /paths:\s*\n\s*- '\.github\/release-client-version'/, 'normal master pushes must not publish a client release');

console.log('release-rollback-contract: ok');
