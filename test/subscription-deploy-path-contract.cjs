'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n?/g, '\n');

const workflow = read('.github/workflows/deploy-subscription.yml');
const wrangler = read('wrangler-subscription.toml');
const outerEntry = read('scripts/geek-subscription-atomic-entry.js');
const entry = read('scripts/geek-subscription-entry.js');
const worker = read('scripts/geek-subscription-worker.js');
const core = read('scripts/geek-subscription-worker-core.js');

assert.match(wrangler, /^main = "scripts\/geek-subscription-atomic-entry\.js"$/m, 'Wrangler must deploy the atomic subscription entry');
assert.match(outerEntry, /from '\.\/atomic-rate-limit\.mjs'/, 'production outer entry must depend on the atomic auth limiter');
assert.match(outerEntry, /from '\.\/atomic-admin-login\.mjs'/, 'production outer entry must depend on the atomic admin login gate');
assert.match(outerEntry, /import productionEntry from '\.\/geek-subscription-entry\.js'/, 'atomic outer entry must delegate to the CPU-safe auth entry');
assert.match(entry, /from '\.\/account-number\.mjs'/, 'subscription entry must include account-number authority');
assert.match(worker, /from '\.\/subscription-order-pay-method\.mjs'/, 'subscription worker must include payment-method authority');
assert.match(core, /from '\.\/account-number\.mjs'/, 'subscription core must include account-number authority');

for (const relativePath of [
  'scripts/geek-subscription-worker.js',
  'scripts/geek-subscription-worker-core.js',
  'scripts/subscription-order-pay-method.mjs',
  'scripts/geek-subscription-entry.js',
  'scripts/geek-subscription-atomic-entry.js',
  'scripts/atomic-rate-limit.mjs',
  'scripts/atomic-admin-login.mjs',
  'scripts/account-number.mjs',
]) {
  const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(workflow, new RegExp(`node --check ${escaped}`), `${relativePath} must be syntax-checked before production deployment`);
}

assert.match(workflow, /- name: Run tests\n        run: npm test/);
assert.match(workflow, /- name: Deploy subscription Worker\n        id: deploy/);
assert.match(workflow, /- name: Live account smoke and publish non-sensitive status\n        id: smoke/);
assert.match(workflow, /- name: Verify and publish non-sensitive deployment status\n        if: always\(\)/);
assert.doesNotMatch(workflow, /continue-on-error:\s*true/, 'production account smoke must not be silently ignored');

console.log('SUBSCRIPTION_DEPLOY_PATH_CONTRACT_OK');
