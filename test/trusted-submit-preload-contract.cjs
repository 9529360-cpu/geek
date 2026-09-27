'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'resources', 'bridge-preload.cjs'), 'utf8');

const listeners = new Map();
const hostMessages = [];
const rootAttributes = new Map();
const rootElement = {
  setAttribute(name, value) { rootAttributes.set(String(name), String(value)); },
  getAttribute(name) { return rootAttributes.get(String(name)) || null; },
  removeAttribute(name) { rootAttributes.delete(String(name)); },
};
let activeComposer = null;
const document = {
  documentElement: rootElement,
  head: null,
  addEventListener(type, handler) { listeners.set(type, handler); },
  querySelector(selector) {
    return selector.includes('#editable-message-text') ? activeComposer : null;
  },
};
const windowObject = {
  location: { origin: 'https://web.telegram.org', protocol: 'https:', hostname: 'web.telegram.org' },
  addEventListener(type, handler) { listeners.set('window:' + type, handler); },
};
const ipcRenderer = {
  sendToHost(channel, payload) { hostMessages.push({ channel, payload }); },
};
const context = {
  require(name) {
    assert.equal(name, 'electron');
    return { ipcRenderer };
  },
  document,
  window: windowObject,
  setTimeout() {},
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'bridge-preload.cjs' });

function target(kind) {
  return {
    nodeType: 1,
    closest(selector) {
      if (kind === 'composer' && selector.includes('#editable-message-text')) return this;
      if (kind === 'button' && selector.includes('button.Button.send.main-button')) return this;
      return null;
    },
  };
}
const composerA = target('composer');
const composerB = target('composer');
activeComposer = composerA;

function keyEvent(overrides = {}) {
  return {
    isTrusted: true,
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    target: composerA,
    ...overrides,
  };
}

const focusin = listeners.get('focusin');
const beforeinput = listeners.get('beforeinput');
const keydown = listeners.get('keydown');
const click = listeners.get('click');
assert.equal(typeof focusin, 'function');
assert.equal(typeof beforeinput, 'function');
assert.equal(typeof keydown, 'function');
assert.equal(typeof click, 'function');

focusin({ isTrusted: true, target: composerA });
assert.deepEqual(JSON.parse(JSON.stringify(hostMessages.shift())), {
  channel: 'geek-trusted-composer-context',
  payload: { protocolVersion: 1, platform: 'telegram', composerGeneration: 1 },
});
beforeinput({ isTrusted: true, target: composerA });
assert.deepEqual(JSON.parse(JSON.stringify(hostMessages.shift())), {
  channel: 'geek-trusted-composer-context',
  payload: { protocolVersion: 1, platform: 'telegram', composerGeneration: 2 },
});
keydown(keyEvent());
assert.deepEqual(JSON.parse(JSON.stringify(hostMessages.shift())), {
  channel: 'geek-trusted-submit',
  payload: { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 2 },
});
assert.equal(hostMessages.length, 0);
rootElement.setAttribute('data-geek-native-submit-commit', '1');
keydown(keyEvent());
beforeinput({ isTrusted: true, target: composerA });
assert.equal(hostMessages.length, 0, 'owner-native commit must not mint a second trusted-submit permit or composer generation');
rootElement.removeAttribute('data-geek-native-submit-commit');

beforeinput({ isTrusted: false, target: composerA });
assert.equal(hostMessages.length, 0, 'synthetic edit must not emit trusted composer context');
keydown(keyEvent());
assert.equal(hostMessages.shift().payload.composerGeneration, 2, 'synthetic edit must not advance trusted composer generation');

for (const event of [
  keyEvent({ isTrusted: false }),
  keyEvent({ key: 'a' }),
  keyEvent({ shiftKey: true }),
  keyEvent({ ctrlKey: true }),
  keyEvent({ altKey: true }),
  keyEvent({ metaKey: true }),
  keyEvent({ isComposing: true }),
  keyEvent({ repeat: true }),
  keyEvent({ target: target('other') }),
]) keydown(event);
assert.equal(hostMessages.length, 0, 'untrusted/modified/non-composer keyboard events must not mint a host gesture');

focusin({ isTrusted: true, target: composerB });
assert.deepEqual(JSON.parse(JSON.stringify(hostMessages.shift())), {
  channel: 'geek-trusted-composer-context',
  payload: { protocolVersion: 1, platform: 'telegram', composerGeneration: 3 },
});
activeComposer = composerB;
click({ isTrusted: true, target: target('button') });
assert.deepEqual(JSON.parse(JSON.stringify(hostMessages.shift())), {
  channel: 'geek-trusted-submit',
  payload: { protocolVersion: 1, platform: 'telegram', kind: 'button', composerGeneration: 3 },
});
click({ isTrusted: false, target: target('button') });
click({ isTrusted: true, target: target('other') });
assert.equal(hostMessages.length, 0);

windowObject.location.hostname = 'web.whatsapp.com';
keydown(keyEvent());
click({ isTrusted: true, target: target('button') });
assert.equal(hostMessages.length, 0, 'non-Telegram origins must not emit Telegram submit gestures');

assert.doesNotMatch(source, /preventDefault\(|stopPropagation\(/, 'observation slice must not change native send behavior');
assert.doesNotMatch(source, /textContent|innerText|\.value|chatId|conversationId|accountId|bridgeToken/, 'trusted gesture payload must not read message/chat/account/token content');

console.log('TRUSTED_SUBMIT_PRELOAD_CONTRACT_OK');
