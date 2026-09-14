'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../ui/webview-crash-feedback.js');
const source = fs.readFileSync(modulePath, 'utf8');
const bootstrap = fs.readFileSync(path.join(__dirname, '../ui/version-label.js'), 'utf8');
const api = require(modulePath);

function fakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    has(id) {
      return timers.has(id);
    },
    delay(id) {
      return timers.get(id)?.delay;
    },
    fire(id) {
      const timer = timers.get(id);
      if (!timer) return false;
      timers.delete(id);
      timer.callback();
      return true;
    },
    size() {
      return timers.size;
    },
  };
}

const timers = fakeTimers();
const tracker = api.createTracker({
  setTimeout: timers.setTimeout,
  clearTimeout: timers.clearTimeout,
});

// A crash starts a local grace period. Timer id 0 is intentionally valid so the
// contract catches truthy-only timer cleanup bugs.
const aFirst = tracker.crashed('account-a');
assert.equal(aFirst.phase, 'recovering');
assert.equal(aFirst.stage, 'waiting-start');
assert.equal(timers.delay(aFirst.timer), api.RELOAD_START_GRACE_MS);
assert.deepEqual(tracker.ids(), ['account-a']);
assert.equal(tracker.get('account-b'), null, 'A recovery must not manufacture B state');

// If no did-start-loading follows, only A becomes blocked.
assert.equal(timers.fire(aFirst.timer), true);
assert.equal(tracker.get('account-a').phase, 'blocked');
assert.equal(tracker.get('account-b'), null);

// A new recovery generation cancels the old state and moves to a longer ready deadline
// once the WebView proves that a reload actually started.
const aSecond = tracker.crashed('account-a');
const waitingTimer = aSecond.timer;
const aLoading = tracker.loading('account-a');
assert.equal(aLoading.phase, 'recovering');
assert.equal(aLoading.stage, 'loading');
assert.equal(timers.has(waitingTimer), false, 'did-start-loading must cancel the short start deadline');
assert.equal(timers.delay(aLoading.timer), api.RELOAD_READY_TIMEOUT_MS);

// B owns an independent state machine while A is loading.
const bFirst = tracker.crashed('account-b');
assert.equal(tracker.get('account-b').phase, 'recovering');
assert.equal(tracker.get('account-a').stage, 'loading');
assert.equal(timers.fire(bFirst.timer), true);
assert.equal(tracker.get('account-b').phase, 'blocked');
assert.equal(tracker.get('account-a').phase, 'recovering', 'B timeout must not change A');

// A reaches dom-ready: recovery state and its long timer are both cleared.
const aReadyTimer = tracker.get('account-a').timer;
assert.equal(tracker.ready('account-a'), true);
assert.equal(tracker.get('account-a'), null);
assert.equal(timers.has(aReadyTimer), false);
assert.equal(tracker.get('account-b').phase, 'blocked');

// A crash whose reload starts but never reaches dom-ready eventually becomes blocked.
tracker.crashed('account-a');
const aHung = tracker.loading('account-a');
assert.equal(timers.fire(aHung.timer), true);
assert.equal(tracker.get('account-a').phase, 'blocked');
assert.equal(tracker.get('account-b').phase, 'blocked');

// Account removal clears only that account and any armed timer.
tracker.crashed('account-c');
const cTimer = tracker.get('account-c').timer;
assert.equal(tracker.remove('account-c'), true);
assert.equal(tracker.get('account-c'), null);
assert.equal(timers.has(cTimer), false);
assert.equal(tracker.get('account-b').phase, 'blocked');

// Account ownership is resolved from the live accounts projection + exact partition,
// never inferred from current focus or a platform-wide WebView.
const accounts = api.normalizeAccounts({
  accounts: [
    { id: 1, partition: 'persist:webview-page-1', name: 'A' },
    { id: 2, partition: 'persist:webview-page-2', name: 'B' },
    { id: 3, name: 'missing partition' },
  ],
});
assert.deepEqual(accounts, [
  { id: '1', partition: 'persist:webview-page-1' },
  { id: '2', partition: 'persist:webview-page-2' },
]);
assert.deepEqual(
  api.findAccountForWebview(accounts, { partition: 'persist:webview-page-2' }),
  { id: '2', partition: 'persist:webview-page-2' },
);
assert.equal(
  api.findAccountForWebview(accounts, { getAttribute: name => name === 'partition' ? 'persist:unknown' : '' }),
  null,
);

// Browser integration must observe real Electron WebView lifecycle signals and resolve
// authority through accounts.list + partition before mutating UI state.
assert.match(source, /window\.api\?\.accounts\?\.list/);
assert.match(source, /findAccountForWebview\(await listAccounts\(\), webview\)/);
assert.match(source, /account\.partition === partition/);
assert.match(source, /addEventListener\('render-process-gone'/);
assert.match(source, /addEventListener\('did-start-loading'/);
assert.match(source, /addEventListener\('dom-ready'/);
assert.match(source, /tracker\.crashed\(account\.id\)/);
assert.match(source, /tracker\.loading\(account\.id\)/);
assert.match(source, /tracker\.ready\(account\.id\)/);

// Blocked recovery is visible, scoped to the active account, and manually reloads only
// the WebView whose current partition belongs to that account.
assert.match(source, /\.nav-account\.active\[data-id\]/);
assert.match(source, /需恢复/);
assert.match(source, /当前账号页面需要重新加载/);
assert.match(source, /其他账号不受影响/);
assert.match(source, /重新加载/);
assert.match(source, /freshAccounts\.find\(item => item\.id === accountId\)/);
assert.match(source, /webviewPartition\(candidate\) === account\.partition/);
assert.match(source, /webview\.reload\(\)/);
assert.doesNotMatch(source, /webviewCrashLimiter|\.allow\(/, 'feedback owner must not copy or reset the automatic crash budget');

// Keep the focused owner in the lightweight shell bootstrap rather than growing app.js.
assert.match(bootstrap, /ensureScript\('\.\/webview-crash-feedback\.js', 'data-geek-webview-crash-feedback'\)/);

console.log('WEBVIEW_CRASH_FEEDBACK_CONTRACT_OK');
