'use strict';

const { spawn } = require('node:child_process');
const { DEV_LOOP_MESSAGES } = require('../src/dev-loop-control.cjs');

function childIsRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function waitForChildExit(child, timeoutMs) {
  if (!childIsRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!childIsRunning(child)), Math.max(0, timeoutMs));
    timer.unref?.();
    child.once('exit', onExit);
  });
}

function requestGracefulQuit(child, control, timeoutMs = 600) {
  if (!childIsRunning(child)) return Promise.resolve(true);
  if (!control || control.child !== child || !control.ready || !control.token) return Promise.resolve(false);
  if (typeof child.send !== 'function' || child.connected === false) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      resolve(value);
    };
    const onMessage = (message) => {
      if (message?.type === DEV_LOOP_MESSAGES.SHUTDOWN_ACK && message?.token === control.token) finish(true);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    timer.unref?.();

    child.on('message', onMessage);
    child.once('exit', onExit);
    try {
      child.send({ type: DEV_LOOP_MESSAGES.SHUTDOWN, token: control.token }, (error) => {
        if (error) finish(false);
      });
    } catch {
      finish(false);
    }
  });
}

function terminateProcessTree(child, options = {}) {
  const {
    force = false,
    platform = process.platform,
    spawnImpl = spawn,
  } = options;
  if (!childIsRunning(child)) return false;

  if (platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    const args = ['/PID', String(child.pid), '/T'];
    if (force) args.push('/F');
    let killer;
    try {
      killer = spawnImpl('taskkill', args, {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      try { return child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { return false; }
    }
    const fallback = () => {
      if (!childIsRunning(child)) return;
      try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* best effort */ }
    };
    killer.once?.('error', fallback);
    killer.once?.('exit', (code) => { if (code !== 0) fallback(); });
    return true;
  }

  try {
    return child.kill(force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    return false;
  }
}

module.exports = {
  childIsRunning,
  requestGracefulQuit,
  terminateProcessTree,
  waitForChildExit,
};
