'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { focusPrimaryWindow, installSingleInstanceGuard } = require('../src/single-instance.cjs');

let restored = 0;
let shown = 0;
let focused = 0;
const win = {
  isDestroyed: () => false,
  isMinimized: () => true,
  restore: () => { restored += 1; },
  show: () => { shown += 1; },
  focus: () => { focused += 1; },
};
assert.equal(focusPrimaryWindow({ getAllWindows: () => [win] }), true);
assert.deepEqual([restored, shown, focused], [1, 1, 1]);

let secondInstance = null;
let exitCode = null;
const primaryApp = {
  requestSingleInstanceLock: () => true,
  on: (event, handler) => { if (event === 'second-instance') secondInstance = handler; },
  exit: code => { exitCode = code; },
};
assert.equal(installSingleInstanceGuard({ primaryApp, BrowserWindow: { getAllWindows: () => [win] } }), undefined, 'invalid option object must not be silently accepted');
