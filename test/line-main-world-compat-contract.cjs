'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const compatPath = path.join(root, 'resources/extensions/line-3.5.1/static/js/geek-main-world-compat.js');
const indexPath = path.join(root, 'resources/extensions/line-3.5.1/index.html');
const bundlePath = path.join(root, 'resources/extensions/line-3.5.1/static/js/main.js');
const source = fs.readFileSync(compatPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const bundle = fs.readFileSync(bundlePath, 'utf8');

for (const forbidden of [
  /\brequire\s*\(/,
  /\bipcRenderer\b/,
  /\bcontextBridge\b/,
  /\bXMLHttpRequest\b/,
  /\beval\s*\(/,
]) {
  assert.doesNotMatch(source, forbidden, `main-world compatibility shim must stay unprivileged: ${forbidden}`);
}

const compatIndex = index.indexOf('/static/js/geek-main-world-compat.js');
const authIndex = index.indexOf('/static/js/geek-authenticated-event-source.js');
const mainIndex = index.indexOf('/static/js/main.js');
assert.ok(compatIndex >= 0, 'LINE page must load the main-world compatibility shim');
assert.ok(authIndex > compatIndex, 'authenticated EventSource shim must load after compatibility globals');
assert.ok(mainIndex > authIndex, 'LINE application bundle must load last');

assert.match(
  bundle,
  /dp = 2 \*\* 30,\s*pp = 1 \* dp/,
  'LINE 3.5.1 bundle file-size contract must remain 1 GiB',
);
assert.match(
  bundle,
  /URL\.createObjectURL\([^)]*\)[\s\S]{0,2600}\.downloads\s*\.download\(\{\s*url:\s*[^,\n]+,\s*filename:\s*[^,\n]+,\s*saveAs:\s*[^}\n]+/,
  'LINE 3.5.1 file saves must continue to materialize a Blob URL and call chrome.downloads.download with url/filename/saveAs',
);

const nativeStorage = { local: { get() {} } };
const nativeRuntime = { sendMessage() {} };
const nativeTabs = { query() {} };
const nativeAction = { setBadgeText() {} };
const blob = { size: 5 };
const fetchCalls = [];
const saveCalls = [];
const window = {
  location: { origin: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc' },
  chrome: {
    storage: nativeStorage,
    runtime: nativeRuntime,
    tabs: nativeTabs,
    action: nativeAction,
  },
  async fetch(url) {
    fetchCalls.push(url);
    return { async blob() { return blob; } };
  },
  GeekLineDownloads: {
    async saveBlob(value, filename, saveAs) {
      saveCalls.push({ value, filename, saveAs });
      return 1;
    },
  },
};

vm.runInNewContext(source, {
  window,
  globalThis: window,
  Promise,
  Object,
  Error,
  String,
});

assert.strictEqual(window.chrome.storage, nativeStorage);
assert.strictEqual(window.chrome.runtime, nativeRuntime);
assert.strictEqual(window.chrome.tabs, nativeTabs);
assert.strictEqual(window.chrome.action, nativeAction);
assert.equal(typeof window._pluginKD, 'function');
assert.equal(typeof window._PluginT, 'function');
assert.equal(typeof window._PluginVT, 'function');
assert.equal(typeof window.hS, 'function');
const handler = () => {};
assert.strictEqual(window._pluginKD(handler), handler);
const message = {};
assert.strictEqual(window._PluginT(message), message);
assert.equal(window.hS().regionCode, 'JP');
assert.equal(typeof window.chrome.notifications.create, 'function');
assert.equal(typeof window.chrome.notifications.onClicked.addListener, 'function');
assert.equal(typeof window.chrome.cookies.remove, 'function');
assert.equal(typeof window.chrome.downloads.download, 'function');
assert.equal(typeof window.chrome.downloads.ok, 'function');
assert.equal(typeof window.chrome.downloads.onChanged.addListener, 'function');

(async () => {
  const blobUrl = 'blob:chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/probe';
  const id = await window.chrome.downloads.download({
    url: blobUrl,
    filename: '../probe.txt',
    saveAs: true,
  });
  assert.equal(id, 1);
  assert.deepEqual(fetchCalls, [blobUrl]);
  assert.equal(saveCalls.length, 1);
  assert.strictEqual(saveCalls[0].value, blob);
  assert.equal(saveCalls[0].filename, 'probe.txt');
  assert.equal(saveCalls[0].saveAs, true);

  for (const url of [
    'https://example.com/file',
    'data:text/plain,probe',
    'file:///tmp/probe',
    'blob:https://example.com/probe',
  ]) {
    await assert.rejects(
      window.chrome.downloads.download({ url, filename: 'probe.txt' }),
      error => error?.code === 'LINE_CONTEXT_ISOLATION_DOWNLOAD_URL_REJECTED',
    );
  }
  assert.equal(fetchCalls.length, 1, 'rejected URLs must never reach fetch');

  console.log('LINE_MAIN_WORLD_COMPAT_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
