'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DEV_LOOP_MESSAGES } = require('../src/dev-loop-control.cjs');
const {
  childIsRunning,
  requestGracefulQuit,
  terminateProcessTree,
  waitForChildExit,
} = require('../scripts/dev-loop-process.cjs');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.connected = true;
    this.pid = 4321;
    this.sent = [];
    this.killCalls = [];
  }

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  kill(signal) {
    this.killCalls.push(signal);
    return true;
  }

  exit(code = 0) {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

(async () => {
  const token = 'process-token_123456789';

  {
    const child = new FakeChild();
    const control = { child, token, ready: true };
    queueMicrotask(() => child.emit('message', { type: DEV_LOOP_MESSAGES.SHUTDOWN_ACK, token }));
    assert.equal(await requestGracefulQuit(child, control, 50), true);
    assert.deepEqual(child.sent, [{ type: DEV_LOOP_MESSAGES.SHUTDOWN, token }]);
  }

  {
    const child = new FakeChild();
    assert.equal(await requestGracefulQuit(child, { child, token, ready: false }, 10), false);
    assert.deepEqual(child.sent, []);
  }

  {
    const child = new FakeChild();
    queueMicrotask(() => child.exit(0));
    assert.equal(await waitForChildExit(child, 50), true);
    assert.equal(childIsRunning(child), false);
  }

  {
    const child = new FakeChild();
    assert.equal(terminateProcessTree(child, { platform: 'linux', force: false }), true);
    assert.deepEqual(child.killCalls, ['SIGTERM']);
    assert.equal(terminateProcessTree(child, { platform: 'linux', force: true }), true);
    assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  }

  {
    const child = new FakeChild();
    const calls = [];
    const fakeSpawn = (command, args, options) => {
      calls.push({ command, args, options });
      const killer = new EventEmitter();
      queueMicrotask(() => killer.emit('exit', 0));
      return killer;
    };
    assert.equal(terminateProcessTree(child, { platform: 'win32', force: false, spawnImpl: fakeSpawn }), true);
    assert.deepEqual(calls[0].command, 'taskkill');
    assert.deepEqual(calls[0].args, ['/PID', '4321', '/T']);
    assert.deepEqual(child.killCalls, []);

    assert.equal(terminateProcessTree(child, { platform: 'win32', force: true, spawnImpl: fakeSpawn }), true);
    assert.deepEqual(calls[1].args, ['/PID', '4321', '/T', '/F']);
  }

  console.log('dev-loop process contract passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
