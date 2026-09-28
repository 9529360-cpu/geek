'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWatchSnapshot } = require('../scripts/dev-loop-watch-state.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-dev-watch-'));
try {
  const ui = path.join(root, 'ui');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'a.js'), 'a');
  const snapshot = createWatchSnapshot({ root });
  assert.equal(snapshot.prime('ui'), 1);
  assert.deepEqual(snapshot.diff('ui'), [], 'unchanged watcher noise must not schedule a runtime action');

  fs.appendFileSync(path.join(ui, 'a.js'), 'b');
  assert.deepEqual(snapshot.diff('ui'), ['ui/a.js'], 'real file mutation must be observed exactly once');
  assert.deepEqual(snapshot.diff('ui'), [], 'same metadata state must not retrigger');

  fs.writeFileSync(path.join(ui, 'new.js'), 'new');
  assert.deepEqual(snapshot.diff('ui'), ['ui/new.js'], 'new files must be observed');

  fs.rmSync(path.join(ui, 'a.js'));
  assert.deepEqual(snapshot.diff('ui'), ['ui/a.js'], 'deleted files must be observed');
  console.log('DEV_LOOP_WATCH_STATE_CONTRACT_OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
