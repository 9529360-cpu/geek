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
  const match = source.match(/\n  push:\n[\s\S]*?\n    paths:\n((?:      - ['"][^'"\n]+['"]\n)+)/);
  assert.ok(match, 'deployment workflow must keep an explicit push.paths list');
  return Array.from(match[1].matchAll(/      - ['"]([^'"\n]+)['"]/g), (entry) => entry[1]);
}

for (const [name, workflowPath] of Object.entries(workflowByWorker)) {
  const source = fs.readFileSync(path.join(root, workflowPath), 'utf8');
  assert.deepEqual(
    deploymentTriggerPaths(source),
    Array.from(WORKERS[name].inputs),
    `${name} affected mapping must stay identical to the production deployment trigger closure`,
  );
  assert.match(source, new RegExp(`wrangler@${WRANGLER_VERSION.replaceAll('.', '\\.')}`));
  assert.ok(
    source.includes(`--config ${WORKERS[name].config}`),
    `${name} must bundle with the same Wrangler config used by deployment`,
  );
}

console.log('dev-worker deployment closure contract passed');
