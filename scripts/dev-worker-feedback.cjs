'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { childIsRunning, terminateProcessTree, waitForChildExit } = require('./dev-loop-process.cjs');

const WRANGLER_VERSION = '4.36.0';
const DEFAULT_DEBOUNCE_MS = 220;
const DEFAULT_TIMEOUT_MS = 60_000;
const STOP_WAIT_MS = 1_500;

const WORKER_ORDER = Object.freeze(['website', 'subscription', 'translation', 'release']);
const GLOBAL_WORKER_INPUTS = Object.freeze(['package.json', 'package-lock.json']);
const WORKERS = Object.freeze({
  website: Object.freeze({
    config: 'wrangler-website.toml',
    inputs: Object.freeze([
      'scripts/geek-website-entry.js',
      'scripts/geek-website-worker.js',
      'scripts/website-payment-qr.mjs',
      'wrangler-website.toml',
    ]),
  }),
  subscription: Object.freeze({
    config: 'wrangler-subscription.toml',
    inputs: Object.freeze([
      'scripts/geek-subscription-atomic-entry.js',
      'scripts/geek-subscription-entry.js',
      'scripts/geek-subscription-worker.js',
      'scripts/geek-subscription-worker-core.js',
      'scripts/atomic-rate-limit.mjs',
      'scripts/atomic-admin-login.mjs',
      'scripts/subscription-order-pay-method.mjs',
      'scripts/account-number.mjs',
      'wrangler-subscription.toml',
    ]),
  }),
  translation: Object.freeze({
    config: 'wrangler-translate.toml',
    inputs: Object.freeze([
      'scripts/geek-translate-entry.js',
      'scripts/geek-translate-worker.js',
      'scripts/translation-rate-limit-compat.mjs',
      'scripts/atomic-rate-limit.mjs',
      'wrangler-translate.toml',
    ]),
  }),
  release: Object.freeze({
    config: 'wrangler.toml',
    inputs: Object.freeze([
      'scripts/geek-release-worker.js',
      'wrangler.toml',
    ]),
  }),
});

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function affectedWorkers(relativePaths) {
  const changed = new Set((relativePaths || []).map(normalizePath).filter(Boolean));
  if (GLOBAL_WORKER_INPUTS.some((input) => changed.has(input))) return [...WORKER_ORDER];
  return WORKER_ORDER.filter((name) => WORKERS[name].inputs.some((input) => changed.has(input)));
}

function npxLaunchSpec(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return Object.freeze({
      command: String(env.ComSpec || env.COMSPEC || 'cmd.exe'),
      argsPrefix: Object.freeze(['/d', '/s', '/c', 'npx.cmd']),
    });
  }
  return Object.freeze({ command: 'npx', argsPrefix: Object.freeze([]) });
}

function buildWorkerBundleCommand(name, options = {}) {
  const worker = WORKERS[name];
  if (!worker) throw new Error(`Unknown Worker target: ${name}`);
  const root = path.resolve(options.root || process.cwd());
  const outRoot = path.resolve(options.outRoot || path.join(root, '.wrangler', 'dev-loop-bundles'));
  const launcher = npxLaunchSpec(options.platform, options.env);
  return Object.freeze({
    command: launcher.command,
    args: Object.freeze([
      ...launcher.argsPrefix,
      '--yes',
      `wrangler@${WRANGLER_VERSION}`,
      'deploy',
      '--dry-run',
      '--outdir',
      path.join(outRoot, name),
      '--config',
      worker.config,
    ]),
    cwd: root,
  });
}

function scrubCloudflareDeployCredentials(env = process.env) {
  const safe = { ...env, WRANGLER_SEND_METRICS: 'false' };
  for (const key of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) delete safe[key];
  return safe;
}

function createWorkerBundleFeedback(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const outRoot = path.resolve(options.outRoot || path.join(root, '.wrangler', 'dev-loop-bundles'));
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const terminateImpl = options.terminateImpl || terminateProcessTree;
  const waitForExitImpl = options.waitForExitImpl || waitForChildExit;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const warn = typeof options.warn === 'function' ? options.warn : () => {};
  const debounceMs = Number.isFinite(Number(options.debounceMs))
    ? Math.max(0, Math.floor(Number(options.debounceMs)))
    : DEFAULT_DEBOUNCE_MS;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Math.floor(Number(options.timeoutMs)))
    : DEFAULT_TIMEOUT_MS;

  const pending = new Set();
  let timer = null;
  let running = false;
  let current = null;
  let stopped = false;

  function scheduleTimer(delay = debounceMs) {
    if (stopped || running || timer || pending.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
    timer.unref?.();
  }

  function schedule(relativePaths) {
    if (stopped) return Object.freeze([]);
    const targets = affectedWorkers(relativePaths);
    for (const target of targets) pending.add(target);
    if (targets.length > 0) {
      log(`Affected Worker bundle verification queued: ${targets.join(', ')}.`);
      if (timer) clearTimeout(timer);
      timer = null;
      scheduleTimer();
    }
    return Object.freeze(targets);
  }

  async function runTarget(name) {
    const spec = buildWorkerBundleCommand(name, { root, outRoot, platform });
    log(`Bundling affected Worker ${name} with Wrangler ${WRANGLER_VERSION} (dry-run only).`);

    let child;
    try {
      child = spawnImpl(spec.command, spec.args, {
        cwd: spec.cwd,
        env: scrubCloudflareDeployCredentials(options.env || process.env),
        stdio: 'inherit',
        windowsHide: true,
      });
    } catch (error) {
      warn(`Worker bundle verification could not start for ${name}: ${error.message}`);
      return false;
    }

    const record = { child, name, timedOut: false, cancelled: false };
    current = record;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok, detail) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (current === record) current = null;
        if (ok) log(`Affected Worker bundle passed: ${name}.`);
        else if (record.cancelled) log(`Affected Worker bundle cancelled during shutdown: ${name}.`);
        else if (!record.timedOut) warn(`Affected Worker bundle failed: ${name}${detail ? ` (${detail})` : ''}.`);
        resolve(ok);
      };
      const timeout = setTimeout(async () => {
        record.timedOut = true;
        warn(`Affected Worker bundle timed out: ${name}; terminating the verification process tree.`);
        terminateImpl(child, { force: true, platform });
        const exited = await waitForExitImpl(child, STOP_WAIT_MS);
        if (!exited) warn(`Affected Worker bundle process tree remained alive after the stop deadline: ${name}.`);
        finish(false, 'timeout');
      }, timeoutMs);
      timeout.unref?.();

      child.once('error', (error) => finish(false, error.message));
      child.once('exit', (code, signal) => {
        if (record.timedOut) finish(false, 'timeout');
        else if (code === 0) finish(true);
        else finish(false, signal ? `signal ${signal}` : `exit code ${code}`);
      });
    });
  }

  async function flush() {
    if (stopped || running || pending.size === 0) return;
    running = true;
    const targets = WORKER_ORDER.filter((name) => pending.delete(name));
    try {
      for (const target of targets) {
        if (stopped) break;
        if (pending.has(target)) {
          log(`Skipping stale Worker bundle batch for ${target}; a newer change is already queued.`);
          continue;
        }
        await runTarget(target);
      }
    } finally {
      running = false;
      if (!stopped && pending.size > 0) scheduleTimer(0);
    }
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    pending.clear();
    const record = current;
    if (!record || !childIsRunning(record.child)) return;
    record.cancelled = true;
    terminateImpl(record.child, { force: true, platform });
    const exited = await waitForExitImpl(record.child, STOP_WAIT_MS);
    if (!exited) warn(`Affected Worker bundle process tree remained alive during shutdown: ${record.name}.`);
  }

  function snapshot() {
    return Object.freeze({
      current: current?.name || null,
      pending: Object.freeze(WORKER_ORDER.filter((name) => pending.has(name))),
      running,
      stopped,
    });
  }

  return Object.freeze({ schedule, stop, snapshot });
}

module.exports = {
  GLOBAL_WORKER_INPUTS,
  WORKERS,
  WORKER_ORDER,
  WRANGLER_VERSION,
  affectedWorkers,
  buildWorkerBundleCommand,
  createWorkerBundleFeedback,
  npxLaunchSpec,
  scrubCloudflareDeployCredentials,
};
