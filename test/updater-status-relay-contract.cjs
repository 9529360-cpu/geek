'use strict';

const assert = require('node:assert/strict');
const { createUpdaterStatusRelay } = require('../src/updater-status-relay.cjs');

function createWindow(options = {}) {
  let destroyed = options.destroyed === true;
  let failSend = options.failSend === true;
  const sent = [];
  const onceHandlers = new Map();

  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      send(channel, payload) {
        if (failSend) throw new Error('send failed');
        sent.push({ channel, payload: { ...payload } });
      },
      once(event, handler) {
        onceHandlers.set(event, handler);
      },
    },
  };

  return {
    window,
    sent,
    setDestroyed(value) { destroyed = value === true; },
    setFailSend(value) { failSend = value === true; },
    finishLoad() {
      const handler = onceHandlers.get('did-finish-load');
      onceHandlers.delete('did-finish-load');
      if (handler) handler();
    },
    hasLoadReplay() {
      return onceHandlers.has('did-finish-load');
    },
  };
}

assert.throws(() => createUpdaterStatusRelay({ statusChannel: 'updater:status' }), /getWindows is required/);
assert.throws(() => createUpdaterStatusRelay({ getWindows: () => [] }), /statusChannel is required/);

const login = createWindow();
const secondary = createWindow();
const destroyed = createWindow({ destroyed: true });
const failing = createWindow({ failSend: true });
const windows = [login.window, destroyed.window, failing.window, secondary.window];
const relay = createUpdaterStatusRelay({
  getWindows: () => windows,
  statusChannel: 'updater:status',
});

assert.equal(relay.getLatest(), null, 'relay must start without synthetic status');
assert.throws(() => relay.publish(null), /updater status payload is required/);
assert.throws(() => relay.publish({ phase: '   ' }), /updater status phase is required/);

const available = relay.publish({ phase: 'available', version: '1.2.23' });
assert.deepEqual(available, { phase: 'available', version: '1.2.23', sequence: 1 });
assert.deepEqual(login.sent, [{
  channel: 'updater:status',
  payload: { phase: 'available', version: '1.2.23', sequence: 1 },
}]);
assert.deepEqual(secondary.sent, [{
  channel: 'updater:status',
  payload: { phase: 'available', version: '1.2.23', sequence: 1 },
}], 'one failing window must not prevent delivery to later windows');
assert.deepEqual(destroyed.sent, [], 'destroyed windows must never receive updater status');
assert.deepEqual(failing.sent, [], 'delivery failures must stay isolated to the failing window');

available.version = 'mutated';
assert.deepEqual(relay.getLatest(), {
  phase: 'available',
  version: '1.2.23',
  sequence: 1,
}, 'callers must not be able to mutate the stored updater snapshot');

// Reproduce the subscription-gate timing: update state exists before the main
// BrowserWindow is created. The later window gets that exact snapshot only after
// its renderer finishes loading, when ui/app.js has installed the status listener.
const main = createWindow();
windows.push(main.window);
assert.equal(relay.replayAfterLoad(main.window), true);
assert.equal(main.hasLoadReplay(), true, 'later window must arm a did-finish-load replay');
assert.deepEqual(main.sent, [], 'status must not be replayed before the renderer finishes loading');
main.finishLoad();
assert.deepEqual(main.sent, [{
  channel: 'updater:status',
  payload: { phase: 'available', version: '1.2.23', sequence: 1 },
}], 'later main window must recover the updater status that existed before login completed');

const downloading = relay.publish({ phase: 'downloading', percent: 42.5 });
assert.deepEqual(downloading, { phase: 'downloading', percent: 42.5, sequence: 2 });
assert.deepEqual(main.sent.at(-1), {
  channel: 'updater:status',
  payload: { phase: 'downloading', percent: 42.5, sequence: 2 },
}, 'future live status must broadcast normally after replay');

const beforeReplay = relay.getLatest();
assert.equal(relay.replayTo(main.window), true);
assert.deepEqual(relay.getLatest(), beforeReplay, 'manual replay must not advance or mutate status sequence');
assert.equal(main.sent.at(-1).payload.sequence, 2);

// Once a package is downloaded, it remains the pending-install authority for this
// process. Transient checks/errors must not hide the restart-to-install capability.
const downloaded = relay.publish({ phase: 'downloaded', version: '1.2.23' });
assert.deepEqual(downloaded, { phase: 'downloaded', version: '1.2.23', sequence: 3 });
const sentCountsAtDownload = {
  login: login.sent.length,
  secondary: secondary.sent.length,
  main: main.sent.length,
};
for (const transient of [
  { phase: 'checking' },
  { phase: 'error', message: 'temporary network failure' },
  { phase: 'up-to-date' },
  { phase: 'downloading', percent: 1 },
  { phase: 'available', version: '1.2.24' },
]) {
  assert.deepEqual(
    relay.publish(transient),
    downloaded,
    `${transient.phase} must not replace an already-downloaded pending-install snapshot`
  );
  assert.deepEqual(relay.getLatest(), downloaded, 'ignored transient status must not advance sequence');
}
assert.equal(login.sent.length, sentCountsAtDownload.login, 'ignored transient statuses must not rebroadcast to login window');
assert.equal(secondary.sent.length, sentCountsAtDownload.secondary, 'ignored transient statuses must not rebroadcast to secondary window');
assert.equal(main.sent.length, sentCountsAtDownload.main, 'ignored transient statuses must not rebroadcast to main window');

// A later downloaded event is allowed to replace the pending package/version.
const newerDownloaded = relay.publish({ phase: 'downloaded', version: '1.2.24' });
assert.deepEqual(newerDownloaded, { phase: 'downloaded', version: '1.2.24', sequence: 4 });
assert.deepEqual(main.sent.at(-1), {
  channel: 'updater:status',
  payload: { phase: 'downloaded', version: '1.2.24', sequence: 4 },
});

const futureMain = createWindow();
windows.push(futureMain.window);
assert.equal(relay.replayAfterLoad(futureMain.window), true);
futureMain.finishLoad();
assert.deepEqual(futureMain.sent, [{
  channel: 'updater:status',
  payload: { phase: 'downloaded', version: '1.2.24', sequence: 4 },
}], 'future windows must replay the still-actionable downloaded snapshot');

main.setDestroyed(true);
assert.equal(relay.replayTo(main.window), false, 'destroyed future windows must fail closed');
assert.equal(relay.replayAfterLoad(main.window), false, 'destroyed windows must not arm load replay');

console.log('UPDATER_STATUS_RELAY_CONTRACT_OK');
