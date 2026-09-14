'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  DEV_LOOP_CONTROL_FLAG,
  DEV_LOOP_CONTROL_TOKEN,
  DEV_LOOP_MESSAGES,
} = require('../src/dev-loop-control.cjs');
const { DEV_ACTION, planDevChanges } = require('./dev-loop-policy.cjs');
const {
  childIsRunning,
  requestGracefulQuit,
  terminateProcessTree,
  waitForChildExit,
} = require('./dev-loop-process.cjs');
const { createRecoveryTracker } = require('./dev-loop-recovery.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEBUG_PORT = 9344;
const DEBOUNCE_MS = 160;
const CONTROL_ACK_MS = 700;
const STOP_GRACE_MS = 3000;
const STOP_KILL_WAIT_MS = 1500;
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
let electronControl = null;
let plannedStopChild = null;
let recoveryTimer = null;
const recoveryTracker = createRecoveryTracker();
let shuttingDown = false;
let debounceTimer = null;
let actionQueue = Promise.resolve();
const pendingChanges = new Set();
const watchers = [];
const rootFileSignatures = new Map();

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

function fileSignature(relativePath) {
  try {
    const stat = fs.statSync(resolveRepoFile(relativePath));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function rememberRootFile(relativePath) {
  rootFileSignatures.set(relativePath, fileSignature(relativePath));
}

function queueRootFileIfChanged(relativePath) {
  const next = fileSignature(relativePath);
  const previous = rootFileSignatures.get(relativePath);
  rootFileSignatures.set(relativePath, next);
  if (previous !== next) queueChange(relativePath);
}

function clearRecoveryTimer() {
  if (!recoveryTimer) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function resetRecoveryForRuntimeChange() {
  clearRecoveryTimer();
  recoveryTracker.noteRuntimeChange();
}

function scheduleUnexpectedRecovery(detail) {
  const decision = recoveryTracker.noteUnexpectedExit();
  if (!decision.shouldRestart) {
    warn(`Electron crash-loop breaker opened after ${decision.unstableExits} unstable exits; watching continues until the next valid desktop-runtime change.`);
    return;
  }

  warn(`Electron exited unexpectedly (${detail}); automatic recovery attempt ${decision.unstableExits} in ${decision.delayMs}ms.`);
  clearRecoveryTimer();
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    if (!shuttingDown && !childIsRunning(electronProcess)) startElectron();
  }, decision.delayMs);
  recoveryTimer.unref?.();
}

function startElectron() {
  if (shuttingDown || childIsRunning(electronProcess)) return;

  const token = crypto.randomUUID();
  const child = spawn(
    electronBinary(),
    ['.', `--remote-debugging-port=${DEBUG_PORT}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        [DEV_LOOP_CONTROL_FLAG]: '1',
        [DEV_LOOP_CONTROL_TOKEN]: token,
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      windowsHide: false,
    },
  );
  electronProcess = child;
  electronControl = { child, token, ready: false, intentionalExit: false };
  recoveryTracker.noteStart();
  log(`Electron started with isolated development profile and CDP ${DEBUG_PORT}.`);

  child.on('message', (message) => {
    if (electronProcess !== child || electronControl?.child !== child) return;
    if (message?.token !== token) return;
    if (message?.type === DEV_LOOP_MESSAGES.READY) {
      electronControl.ready = true;
      log('Electron dev control channel ready.');
    } else if (message?.type === DEV_LOOP_MESSAGES.EXITING) {
      electronControl.intentionalExit = true;
    }
  });
  child.once('error', (error) => {
    if (electronProcess === child) electronProcess = null;
    if (electronControl?.child === child) electronControl = null;
    warn(`Electron failed to start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    const control = electronControl?.child === child ? electronControl : null;
    const expectedExit = shuttingDown
      || plannedStopChild === child
      || control?.intentionalExit === true;
    if (electronProcess === child) electronProcess = null;
    if (electronControl?.child === child) electronControl = null;
    if (plannedStopChild === child) plannedStopChild = null;

    if (!shuttingDown) {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      if (expectedExit) {
        log(`Electron exited intentionally (${detail}); watcher remains active.`);
      } else {
        scheduleUnexpectedRecovery(detail);
      }
    }
  });
}

async function stopElectron() {
  const child = electronProcess;
  if (!childIsRunning(child)) {
    if (electronProcess === child) electronProcess = null;
    if (electronControl?.child === child) electronControl = null;
    return true;
  }

  const control = electronControl?.child === child ? electronControl : null;
  plannedStopChild = child;
  const graceful = await requestGracefulQuit(child, control, CONTROL_ACK_MS);
  if (graceful) {
    log('Electron acknowledged graceful dev-loop shutdown.');
  } else if (childIsRunning(child)) {
    warn('Electron dev control was unavailable; asking the OS to terminate the owned process tree.');
    terminateProcessTree(child, { force: false });
  }

  if (await waitForChildExit(child, STOP_GRACE_MS)) {
    if (electronProcess === child) electronProcess = null;
    if (electronControl?.child === child) electronControl = null;
    return true;
  }

  warn('Electron did not stop in time; forcing the owned process tree down before relaunch.');
  terminateProcessTree(child, { force: true });
  const exited = await waitForChildExit(child, STOP_KILL_WAIT_MS);
  if (!exited) {
    warn('Electron process tree is still alive after the force deadline; relaunch is blocked to avoid duplicate profile owners.');
    return false;
  }

  if (electronProcess === child) electronProcess = null;
  if (electronControl?.child === child) electronControl = null;
  return true;
}

async function restartElectron(reason) {
  log(`Restarting Electron (${reason}).`);
  const stopped = await stopElectron();
  if (!stopped) return false;
  if (!shuttingDown) startElectron();
  return true;
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

async function verifyRuntimeInputs(plan) {
  let runtimeSafe = true;
  for (const sourceFile of plan.runtimeSyntaxFiles) {
    if (!await syntaxCheck(sourceFile)) runtimeSafe = false;
  }
  for (const manifest of plan.manifestFiles) {
    if (!validateJsonFile(manifest)) runtimeSafe = false;
  }
  return runtimeSafe;
}

async function runFeedbackChecks(plan) {
  for (const sourceFile of plan.feedbackSyntaxFiles) {
    await syntaxCheck(sourceFile);
  }
  for (const testFile of plan.testFiles) {
    await runChangedContract(testFile);
  }
  if (plan.workerConfigFiles.length > 0) {
    log(`Worker config changed (${plan.workerConfigFiles.join(', ')}); Wrangler bundle dry-runs remain authoritative in CI.`);
  }
  if (plan.requiresLoopRestart) {
    warn('The dev-loop implementation or control protocol changed; restart npm run dev once to activate the new supervisor code.');
  }
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

async function applyRuntimeAction(plan, runtimeSafe) {
  if (!runtimeSafe && plan.runtimeAction !== DEV_ACTION.IGNORE) {
    warn('Desktop update skipped because changed runtime input is invalid; the last working Electron process stays active.');
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

async function applyChanges(changes) {
  const plan = planDevChanges(changes);
  if (plan.changes.length === 0) return;
  if (plan.runtimeAction !== DEV_ACTION.IGNORE) resetRecoveryForRuntimeChange();
  const runtimeSafe = await verifyRuntimeInputs(plan);
  await applyRuntimeAction(plan, runtimeSafe);
  await runFeedbackChecks(plan);
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
  for (const file of ROOT_FEEDBACK_FILES) rememberRootFile(file);
  const watcher = fs.watch(ROOT, (_eventType, filename) => {
    if (!filename) {
      for (const file of ROOT_FEEDBACK_FILES) queueRootFileIfChanged(file);
      return;
    }
    const name = String(filename);
    if (ROOT_FEEDBACK_FILES.has(name)) queueRootFileIfChanged(name);
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
  clearRecoveryTimer();
  for (const watcher of watchers.splice(0)) watcher.close();
  const stopped = await stopElectron();
  process.exit(stopped ? exitCode : Math.max(1, exitCode));
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
