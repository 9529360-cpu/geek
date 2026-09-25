'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const compatPath = path.join(root, 'resources/extensions/line-3.5.1/static/js/geek-main-world-compat.js');
const indexPath = path.join(root, 'resources/extensions/line-3.5.1/index.html');
const source = fs.readFileSync(compatPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

for (const forbidden of [
  /\brequire\s*\(/,
  /\bipcRenderer\b/,
  /\bcontextBridge\b/,
  /\bXMLHttpRequest\b/,
  /\bfetch\s*\(/,
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

const nativeStorage = { local: { get() {} } };
const nativeRuntime = { sendMessage() {} };
const nativeTabs = { query() {} };
const nativeAction = { setBadgeText() {} };
const window = {
  chrome: {
    storage: nativeStorage,
    runtime: nativeRuntime,
    tabs: nativeTabs,
    action: nativeAction,
  },
};
vm.runInNewContext(source, { window, globalThis: window, Promise, Object });

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
assert.match(source, /LINE_CONTEXT_ISOLATION_DOWNLOAD_UNAVAILABLE/, 'candidate download must fail closed instead of pretending success');
assert.equal(typeof window.chrome.downloads.ok, 'function');
assert.equal(typeof window.chrome.downloads.onChanged.addListener, 'function');

console.log('LINE_MAIN_WORLD_COMPAT_CONTRACT_OK');
