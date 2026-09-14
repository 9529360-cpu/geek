'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DEV_ACTION, planDevChanges } = require('./dev-loop-policy.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEBUG_PORT = 9344;
const DEBOUNCE_MS = 160;
const STOP_GRACE_MS = 3000;
const STOP_KILL_WAIT_MS = 1000;
const WATCH_ROOTS = Object.freeze([
  'ui',
  'src',
  'resources',
  'scripts',
  'test',
  'test-support',
  'e2e',
]);
const ROOT_FEEDBACK_FILES = Object.freeze(new Set([
  'package.json',
  'package-lock.json',
  'electron-builder.yml',
  'electron-builder.validation.yml',
  'wrangler.toml',
  'wrangler-subscription.toml',
  'wrangler-translate.toml',
  'wrangler-website.toml',
]));

let electronProcess = null;
let shuttingDown = false;
let debounceTimer = null;
let actionQueue = Promise.resolve();
const pendingChanges = new Set();
const watchers = [];

function log(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[dev] ${message}\n`);
}

function relativeFromRoot(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function resolveRepoFile(relativePath) {
  return path.join(ROOT, ...String(relativePath).split('/'));
}

function electronBinary() {
  return require('electron');
}

function childIsRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function startElectron() {
  if (shuttingDown || childIsRunning(electronProcess)) return;

  const child = spawn(
    electronBinary(),
    ['.', `--remote-debugging-port=${DEBUG_PORT}`],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  electronProcess = child;
  log(`Electron started with isolated development profile and CDP ${DEBUG_PORT}.`);

  child.once('error', (error) => {
    if (electronProcess === child) electronProcess = null;
    warn(`Electron failed to start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    if (electronProcess === child) electronProcess = null;
    if (!shuttingDown) {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      warn(`Electron exited (${detail}); watching continues and the next runtime change will relaunch it.`);
    }
  });
}

async function stopElectron() {
  const child = electronProcess;
  if (!childIsRunning(child)) {
    if (electronProcess === child) electronProcess = null;
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    let forceTimer = null;
    let finishTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      if (finishTimer) clearTimeout(finishTimer);
      child.removeListener('exit', finish);
      resolve();
    };

    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }

    forceTimer = setTimeout(() => {
      if (!childIsRunning(child)) {
        finish();
        return;
      }
      warn('Electron did not stop in time; forcing shutdown before relaunch.');
      try {
        child.kill('SIGKILL');
      } catch {
        finish();
        return;
      }
      finishTimer = setTimeout(finish, STOP_KILL_WAIT_MS);
      finishTimer.unref?.();
    }, STOP_GRACE_MS);
    forceTimer.unref?.();
  });

  if (electronProcess === child) electronProcess = null;
}

async function restartElectron(reason) {
  log(`Restarting Electron (${reason}).`);
  await stopElectron();
  if (!shuttingDown) startElectron();
}

function runProcess(command, args, { inherited = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env },
      stdio: inherited ? 'inherit' : 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `signal ${signal}` : `exit code ${code}`));
    });
  });
}

async function syntaxCheck(relativePath) {
  const absolutePath = resolveRepoFile(relativePath);
  if (!fs.existsSync(absolutePath)) return true;
  try {
    await runProcess(process.execPath, ['--check', absolutePath]);
    return true;
  } catch (error) {
    warn(`Syntax check failed for ${relativePath} (${error.message}).`);
    return false;
  }
}

function validateJsonFile(relativePath) {
  const absolutePath = resolveRepoFile(relativePath);
  if (!fs.existsSync(absolutePath)) return true;
  try {
    JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return true;
  } catch (error) {
    warn(`JSON validation failed for ${relativePath} (${error.message}).`);
    return false;
  }
}

async function runChangedContract(relativePath) {
  const absolutePath = resolveRepoFile(relativePath);
  if (!fs.existsSync(absolutePath)) return;
  log(`Running changed contract ${relativePath}.`);
  try {
    await runProcess(process.execPath, [absolutePath]);
  } catch (error) {
    warn(`Changed contract failed: ${relativePath} (${error.message}).`);
  }
}

async function verifyPlan(plan) {
  let runtimeSafe = true;
  for (const sourceFile of plan.syntaxFiles) {
    if (!await syntaxCheck(sourceFile)) runtimeSafe = false;
  }
  for (const manifest of plan.manifestFiles) {
    if (!validateJsonFile(manifest)) runtimeSafe = false;
  }

  for (const testFile of plan.testFiles) {
    await runChangedContract(testFile);
  }

  if (plan.workerConfigFiles.length > 0) {
    log(`Worker config changed (${plan.workerConfigFiles.join(', ')}); Wrangler bundle dry-runs remain authoritative in CI.`);
  }
  if (plan.requiresLoopRestart) {
    warn('The dev-loop implementation changed; restart npm run dev once to activate the new watcher code.');
  }
  return runtimeSafe;
}

async function reloadShell(changes) {
  if (!childIsRunning(electronProcess)) {
    await restartElectron('desktop process is not running');
    return;
  }

  log(`Reloading desktop shell (${changes.join(', ')}).`);
  try {
    await runProcess(
      process.execPath,
      [path.join(ROOT, 'test', 'cdp-reload.cjs')],
    );
  } catch (error) {
    warn(`Shell reload failed (${error.message}); falling back to a full Electron restart.`);
    await restartElectron('shell reload fallback');
  }
}

async function applyChanges(changes) {
  const plan = planDevChanges(changes);
  const runtimeSafe = await verifyPlan(plan);

  if (!runtimeSafe && plan.runtimeAction !== DEV_ACTION.IGNORE) {
    warn('Runtime update skipped because changed executable input is invalid; the last working desktop process stays active.');
    return;
  }

  if (plan.runtimeAction === DEV_ACTION.RELOAD_SHELL) {
    await reloadShell(plan.changes);
    return;
  }
  if (plan.runtimeAction === DEV_ACTION.RESTART_ELECTRON) {
    if (plan.manifestFiles.length > 0) {
      warn('Package manifest changed; run npm install if dependencies were added or changed.');
    }
    await restartElectron(plan.changes.join(', '));
  }
}

function flushPendingChanges() {
  debounceTimer = null;
  const changes = Array.from(pendingChanges).sort();
  pendingChanges.clear();
  if (changes.length === 0) return;

  actionQueue = actionQueue
    .then(() => applyChanges(changes))
    .catch((error) => {
      warn(`Change handling failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function queueChange(relativePath) {
  if (!relativePath || shuttingDown) return;
  pendingChanges.add(relativePath);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPendingChanges, DEBOUNCE_MS);
}

function watchDirectory(name) {
  const directory = path.join(ROOT, name);
  const watcher = fs.watch(directory, { recursive: true }, (_eventType, filename) => {
    const changedPath = filename ? path.join(directory, String(filename)) : directory;
    queueChange(relativeFromRoot(changedPath));
  });
  watcher.on('error', (error) => {
    warn(`Watcher failed for ${name}: ${error.message}`);
    void shutdown(1);
  });
  watchers.push(watcher);
}

function watchRootFiles() {
  const watcher = fs.watch(ROOT, (_eventType, filename) => {
    if (!filename) {
      queueChange('package.json');
      return;
    }
    const name = String(filename);
    if (ROOT_FEEDBACK_FILES.has(name)) queueChange(name);
  });
  watcher.on('error', (error) => {
    warn(`Root watcher failed: ${error.message}`);
    void shutdown(1);
  });
  watchers.push(watcher);
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingChanges.clear();
  for (const watcher of watchers.splice(0)) watcher.close();
  await stopElectron();
  process.exit(exitCode);
}

function closeWatchers() {
  for (const watcher of watchers.splice(0)) watcher.close();
}

function installSignalHandlers() {
  process.once('SIGINT', () => { void shutdown(0); });
  process.once('SIGTERM', () => { void shutdown(0); });
}

function main() {
  try {
    for (const name of WATCH_ROOTS) watchDirectory(name);
    watchRootFiles();
  } catch (error) {
    closeWatchers();
    warn(`Unable to initialize file watchers: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  installSignalHandlers();
  log('Watching desktop runtime plus scripts/tests for affected, fast feedback.');
  startElectron();
}

main();
