'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareUserDataPath } = require('../src/user-data-path.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-user-data-bind-'));
const cleanTarget = path.join(root, 'clean', 'nested', 'profile');
let bound = null;
const cleanApp = {
  setPath(name, value) {
    assert.equal(name, 'userData');
    assert.equal(fs.existsSync(value), true, 'clean-install target must exist before Electron setPath is called');
    bound = value;
  },
};
assert.equal(fs.existsSync(cleanTarget), false);
assert.equal(prepareUserDataPath({ app: cleanApp, fs, userDataDir: cleanTarget }), path.resolve(cleanTarget));
assert.equal(bound, path.resolve(cleanTarget));
assert.equal(fs.statSync(cleanTarget).isDirectory(), true);

const mkdirError = Object.assign(new Error('mkdir denied'), { code: 'EACCES' });
assert.throws(
  () => prepareUserDataPath({
    app: { setPath() { throw new Error('setPath must not run after mkdir failure'); } },
    fs: { mkdirSync() { throw mkdirError; } },
    userDataDir: path.join(root, 'denied'),
  }),
  error => error === mkdirError,
  'directory creation failure must propagate to the startup gate',
);

const setPathTarget = path.join(root, 'set-path-fails');
const bindError = Object.assign(new Error('bind failed'), { code: 'USER_DATA_BIND_TEST' });
assert.throws(
  () => prepareUserDataPath({
    app: { setPath() { throw bindError; } },
    fs,
    userDataDir: setPathTarget,
  }),
  error => error === bindError,
  'Electron setPath failure must propagate instead of falling back to the default profile',
);
assert.equal(fs.existsSync(setPathTarget), true, 'target creation must happen before the failing setPath call');

assert.throws(() => prepareUserDataPath({ app: cleanApp, fs, userDataDir: 'relative-profile' }), /absolute path/);

const mainEntry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const profileAt = mainEntry.indexOf('configureRuntimeEnvironment({');
const bindAt = mainEntry.indexOf('prepareUserDataPath({ app, fs: nodeFs, userDataDir: earlyUserDataDir })');
const lockAt = mainEntry.indexOf('installSingleInstanceGuard({ app, BrowserWindow })');
const sessionAt = mainEntry.indexOf('installSessionPartitionCompat({ app, sessionModule: session })');
assert.ok(profileAt >= 0 && bindAt > profileAt && lockAt > bindAt && sessionAt > lockAt, 'userData must be created/bound before single-instance and Session boundaries');
assert.match(mainEntry, /let userDataPathReady = false;/);
assert.match(mainEntry, /userDataPathReady = true;/);
assert.match(mainEntry, /app\.exit\(1\)/, 'binding failure must terminate startup with a failure exit');
assert.match(mainEntry, /const primaryInstance = userDataPathReady && installSingleInstanceGuard\(\{ app, BrowserWindow \}\)/, 'single-instance/main bootstrap must be gated by successful userData binding');
assert.doesNotMatch(mainEntry, /try \{ app\.setPath\('userData', earlyUserDataDir\); \} catch \{\}/, 'startup must not silently swallow userData binding failure');

console.log('USER_DATA_PATH_CONTRACT_OK');
