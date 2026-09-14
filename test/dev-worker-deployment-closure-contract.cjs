'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WORKERS, WRANGLER_VERSION } = require('../scripts/dev-worker-feedback.cjs');

const root = path.resolve(__dirname, '..');
const workflowByWorker = Object.freeze({
  website: '.github/workflows/deploy-website.yml',
  subscription: '.github/workflows/deploy-subscription.yml',
  translation: '.github/workflows/deploy-translate.yml',
  release: '.github/workflows/deploy-release-worker.yml',
});

function deploymentTriggerPaths(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const pushIndex = lines.findIndex((line) => line === '  push:');
  assert.notEqual(pushIndex, -1, 'deployment workflow must keep a push trigger');

  let pathsIndex = -1;
  for (let index = pushIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  \S/.test(line)) break;
    if (line === '    paths:') {
      pathsIndex = index;
      break;
    }
  }
  assert.notEqual(pathsIndex, -1, 'deployment workflow must keep an explicit push.paths list');

  const paths = [];
  for (let index = pathsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^      - ['"]([^'"]+)['"]$/);
    if (!match) break;
    paths.push(match[1]);
  }
  assert.ok(paths.length > 0, 'deployment workflow push.paths must not be empty');
  return paths;
}

for (const [name, workflowPath] of Object.entries(workflowByWorker)) {
  const source = fs.readFileSync(path.join(root, workflowPath), 'utf8');
  const expected = Array.from(WORKERS[name].inputs);
  assert.deepEqual(
    deploymentTriggerPaths(source),
    expected,
    `${name} affected mapping must stay identical to the production deployment trigger closure`,
  );
  assert.deepEqual(
    deploymentTriggerPaths(source.replace(/\n/g, '\r\n')),
    expected,
    `${name} deployment trigger closure must parse Windows CRLF checkouts`,
  );
  assert.deepEqual(
    deploymentTriggerPaths(source.replace(/\n/g, '\r\r\n')),
    expected,
    `${name} deployment trigger closure must tolerate repeated carriage returns`,
  );
  assert.match(source, new RegExp(`wrangler@${WRANGLER_VERSION.replaceAll('.', '\\.')}`));
  assert.ok(
    source.includes(`--config ${WORKERS[name].config}`),
    `${name} must bundle with the same Wrangler config used by deployment`,
  );
}

console.log('dev-worker deployment closure contract passed');
