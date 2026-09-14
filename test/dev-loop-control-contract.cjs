'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  DEV_LOOP_CONTROL_FLAG,
  DEV_LOOP_CONTROL_TOKEN,
  DEV_LOOP_MESSAGES,
  installDevLoopControl,
  normalizeDevLoopToken,
} = require('../src/dev-loop-control.cjs');

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
  }

  send(message) {
    this.sent.push(message);
    return true;
  }
}

class FakeApp extends EventEmitter {
  constructor() {
    super();
    this.quitCalls = 0;
  }

  quit() {
    this.quitCalls += 1;
    this.emit('before-quit');
  }
}

const token = 'dev-loop-token_123456789';
assert.equal(normalizeDevLoopToken(token), token);
assert.equal(normalizeDevLoopToken('short'), '');
assert.equal(normalizeDevLoopToken('bad token with spaces'), '');

{
  const app = new FakeApp();
  const processObject = new FakeProcess();
  const control = installDevLoopControl({
    app,
    isPackaged: false,
    profile: 'development',
    env: {
      [DEV_LOOP_CONTROL_FLAG]: '1',
      [DEV_LOOP_CONTROL_TOKEN]: token,
    },
    processObject,
  });
  assert.equal(control.enabled, true);
  assert.deepEqual(processObject.sent, [{ type: DEV_LOOP_MESSAGES.READY, token }]);

  processObject.emit('message', { type: DEV_LOOP_MESSAGES.SHUTDOWN, token: 'wrong-token_123456789' });
  assert.equal(app.quitCalls, 0);

  processObject.emit('message', { type: DEV_LOOP_MESSAGES.SHUTDOWN, token });
  assert.equal(app.quitCalls, 1);
  assert.deepEqual(processObject.sent.slice(-2), [
    { type: DEV_LOOP_MESSAGES.SHUTDOWN_ACK, token },
    { type: DEV_LOOP_MESSAGES.EXITING, token },
  ]);

  processObject.emit('message', { type: DEV_LOOP_MESSAGES.SHUTDOWN, token });
  assert.equal(app.quitCalls, 1, 'duplicate shutdown must be idempotent');

  control.dispose();
  assert.equal(processObject.listenerCount('message'), 0);
}

for (const disabledCase of [
  { isPackaged: true, profile: 'development', flag: '1', caseName: 'packaged' },
  { isPackaged: false, profile: 'validation', flag: '1', caseName: 'validation profile' },
  { isPackaged: false, profile: 'development', flag: '0', caseName: 'flag disabled' },
]) {
  const app = new FakeApp();
  const processObject = new FakeProcess();
  const control = installDevLoopControl({
    app,
    isPackaged: disabledCase.isPackaged,
    profile: disabledCase.profile,
    env: {
      [DEV_LOOP_CONTROL_FLAG]: disabledCase.flag,
      [DEV_LOOP_CONTROL_TOKEN]: token,
    },
    processObject,
  });
  assert.equal(control.enabled, false, disabledCase.caseName);
  assert.equal(processObject.listenerCount('message'), 0, disabledCase.caseName);
  assert.deepEqual(processObject.sent, [], disabledCase.caseName);
}

console.log('dev-loop control contract passed');
