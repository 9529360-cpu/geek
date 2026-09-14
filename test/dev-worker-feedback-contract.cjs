'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  WRANGLER_VERSION,
  WORKER_ORDER,
  affectedWorkers,
  buildWorkerBundleCommand,
  createWorkerBundleFeedback,
  npxLaunchSpec,
  scrubCloudflareDeployCredentials,
} = require('../scripts/dev-worker-feedback.cjs');

assert.deepEqual(affectedWorkers(['scripts/geek-website-worker.js']), ['website']);
assert.deepEqual(affectedWorkers(['scripts/website-payment-qr.mjs']), ['website']);
assert.deepEqual(affectedWorkers(['scripts/atomic-rate-limit.mjs']), ['subscription', 'translation']);
assert.deepEqual(affectedWorkers(['wrangler-subscription.toml']), ['subscription']);
assert.deepEqual(affectedWorkers(['scripts/geek-release-worker.js']), ['release']);
assert.deepEqual(affectedWorkers(['package.json']), WORKER_ORDER);
assert.deepEqual(affectedWorkers(['package-lock.json']), WORKER_ORDER);
assert.deepEqual(affectedWorkers(['scripts/cloudflare-deploy-report.cjs', 'README.md']), []);
assert.deepEqual(affectedWorkers(['scripts\\geek-translate-worker.js']), ['translation']);

assert.deepEqual(npxLaunchSpec('linux'), { command: 'npx', argsPrefix: [] });
assert.deepEqual(npxLaunchSpec('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), {
  command: 'C:\\Windows\\System32\\cmd.exe',
  argsPrefix: ['/d', '/s', '/c', 'npx.cmd'],
});

const root = path.resolve('/repo');
const website = buildWorkerBundleCommand('website', { root, platform: 'linux' });
assert.equal(website.command, 'npx');
assert.deepEqual(website.args, [
  '--yes',
  `wrangler@${WRANGLER_VERSION}`,
  'deploy',
  '--dry-run',
  '--outdir',
  path.join(root, '.wrangler', 'dev-loop-bundles', 'website'),
  '--config',
  'wrangler-website.toml',
]);

const safeEnv = scrubCloudflareDeployCredentials({
  KEEP: 'yes',
  CLOUDFLARE_API_TOKEN: 'secret',
  CLOUDFLARE_ACCOUNT_ID: 'secret-account',
  CLOUDFLARE_API_KEY: 'legacy',
  CLOUDFLARE_EMAIL: 'owner@example.com',
});
assert.equal(safeEnv.KEEP, 'yes');
assert.equal(safeEnv.WRANGLER_SEND_METRICS, 'false');
assert.equal(safeEnv.CLOUDFLARE_API_TOKEN, undefined);
assert.equal(safeEnv.CLOUDFLARE_ACCOUNT_ID, undefined);
assert.equal(safeEnv.CLOUDFLARE_API_KEY, undefined);
assert.equal(safeEnv.CLOUDFLARE_EMAIL, undefined);

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
  }
}

(async () => {
  const calls = [];
  const logs = [];
  const warnings = [];
  let pid = 100;
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild(pid++);
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    });
    return child;
  };
  const feedback = createWorkerBundleFeedback({
    root,
    platform: 'linux',
    spawnImpl,
    debounceMs: 0,
    timeoutMs: 1000,
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(feedback.schedule(['scripts/atomic-rate-limit.mjs']), ['subscription', 'translation']);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.map((call) => call.args.at(-1)), ['wrangler-subscription.toml', 'wrangler-translate.toml']);
  assert.equal(calls.every((call) => call.args.includes('--dry-run')), true);
  assert.equal(calls.every((call) => call.options.env.CLOUDFLARE_API_TOKEN === undefined), true);
  assert.equal(warnings.length, 0);
  assert.equal(logs.some((message) => message.includes('Affected Worker bundle passed: subscription')), true);
  assert.equal(logs.some((message) => message.includes('Affected Worker bundle passed: translation')), true);
  assert.deepEqual(feedback.snapshot().pending, []);
  await feedback.stop();
  assert.equal(feedback.snapshot().stopped, true);

  console.log('dev-worker feedback contract passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
