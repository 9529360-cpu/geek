'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'ui', 'app.js');
const adaptersPath = path.join(root, 'ui', 'translation-adapters.js');
const testPath = path.join(root, 'test', 'translation-bridge-readiness-contract.cjs');
const workflowPath = path.join(root, '.github', 'workflows', 'tmp-apply-524.yml');
const selfPath = __filename;

const unsafe = "document.documentElement.getAttribute('data-geek-bridge') === '1' || document.getAttribute('data-geek-bridge') === '1'";
const safe = "document.documentElement?.getAttribute?.('data-geek-bridge') === '1'";

function replaceExact(filePath, expectedCount) {
  const before = fs.readFileSync(filePath, 'utf8');
  const count = before.split(unsafe).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${path.relative(root, filePath)} expected ${expectedCount} unsafe bridge checks, found ${count}`);
  }
  const after = before.split(unsafe).join(safe);
  if (after.includes("document.getAttribute('data-geek-bridge')")) {
    throw new Error(`${path.relative(root, filePath)} still contains invalid Document.getAttribute bridge check`);
  }
  fs.writeFileSync(filePath, after);
}

replaceExact(appPath, 1);
replaceExact(adaptersPath, 2);

const testSource = String.raw`'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(rootDir, 'ui', 'app.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(rootDir, 'ui', 'translation-adapters.js'), 'utf8');

const invalidDocumentCheck = /document\.getAttribute\(['\"]data-geek-bridge['\"]\)/;
assert.doesNotMatch(appSource, invalidDocumentCheck, 'WhatsApp page bridge readiness must not call Document.getAttribute');
assert.doesNotMatch(adapterSource, invalidDocumentCheck, 'adapter bridge readiness must not call Document.getAttribute');
assert.match(appSource, /document\.documentElement\?\.getAttribute\?\.\(['\"]data-geek-bridge['\"]\) === ['\"]1['\"]/, 'WhatsApp bridge readiness must tolerate a missing documentElement');
assert.match(adapterSource, /document\.documentElement\?\.getAttribute\?\.\(['\"]data-geek-bridge['\"]\) === ['\"]1['\"]/, 'adapter bridge readiness must tolerate a missing documentElement');

function fakeElement(tagName = 'DIV') {
  return {
    tagName,
    dataset: {},
    style: {},
    isConnected: true,
    classList: { contains: () => false },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    addEventListener() {},
    remove() { this.isConnected = false; },
    appendChild() {},
  };
}

function runTelegramBridgeCase(markerMode) {
  const logs = [];
  const posts = [];
  const body = fakeElement('BODY');
  const middle = fakeElement('DIV');
  const documentElement = markerMode === 'missing-root'
    ? null
    : { getAttribute: name => name === 'data-geek-bridge' && markerMode === 'present' ? '1' : null };
  const document = {
    documentElement,
    body,
    activeElement: null,
    querySelector(selector) {
      if (selector === '#MiddleColumn') return middle;
      if (selector === '#Main') return null;
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return fakeElement('DIV'); },
    createRange() { return { selectNodeContents() {} }; },
    getElementById() { return null; },
    addEventListener() {},
  };
  const location = { href: 'https://web.telegram.org/a/', hash: '#chat-a', origin: 'https://web.telegram.org' };
  const context = {
    AbortController,
    Array,
    Date,
    Element: function Element() {},
    KeyboardEvent: function KeyboardEvent(type, init) { return { type, ...init }; },
    Map,
    Math,
    MutationObserver: class { observe() {} disconnect() {} },
    Object,
    Promise,
    RegExp,
    String,
    clearTimeout() {},
    console: { log: value => logs.push(String(value)), error() {} },
    document,
    location,
    setTimeout() { return 1; },
  };
  context.window = context;
  context.window.location = location;
  context.window.postMessage = value => posts.push(value);
  context.window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'translation-adapters.js' });
  context.window.GeekTranslationAdapters.telegram({
    accountId: 'acc-tg',
    bridgeToken: 'a'.repeat(32),
    global: { send: false, displayTranslation: false },
    chats: {},
  });
  context.window.__geekTranslationRequest({ text: 'bridge-probe', source: 'auto', target: 'it' });
  return { logs, posts };
}

const present = runTelegramBridgeCase('present');
assert.equal(present.posts.length, 1, 'marker-present requests must use the isolated postMessage bridge');
assert.equal(present.logs.filter(line => line.startsWith('__GEEK_TRANSLATION_REQUEST__:')).length, 0, 'marker-present requests must not use console fallback');

const absent = runTelegramBridgeCase('absent');
assert.equal(absent.posts.length, 0, 'marker-absent requests must not pretend the preload bridge exists');
assert.equal(absent.logs.filter(line => line.startsWith('__GEEK_TRANSLATION_REQUEST__:')).length, 1, 'marker-absent requests must reach the compatibility fallback without throwing');

const missingRoot = runTelegramBridgeCase('missing-root');
assert.equal(missingRoot.posts.length, 0, 'missing documentElement must not use the preload bridge');
assert.equal(missingRoot.logs.filter(line => line.startsWith('__GEEK_TRANSLATION_REQUEST__:')).length, 1, 'missing documentElement must still reach the compatibility fallback');

console.log('TRANSLATION_BRIDGE_READINESS_CONTRACT_OK');
`;
fs.writeFileSync(testPath, testSource);

for (const temporaryPath of [workflowPath, selfPath]) {
  try { fs.unlinkSync(temporaryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('APPLY_524_OK');
