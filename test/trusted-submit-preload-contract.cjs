'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'resources', 'bridge-preload.cjs'), 'utf8');
const listeners = new Map();
const hostMessages = [];
const attrs = new Map();
const rootElement = {
  setAttribute(name, value) { attrs.set(String(name), String(value)); },
  getAttribute(name) { return attrs.get(String(name)) || null; },
  removeAttribute(name) { attrs.delete(String(name)); },
};
let activeComposer = null;
const document = {
  documentElement: rootElement,
  head: null,
  addEventListener(type, handler) {
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  },
  querySelector(selector) {
    return (selector.includes('#editable-message-text') || selector.includes('#main footer')) ? activeComposer : null;
  },
};
const windowObject = {
  location: { origin: 'https://web.telegram.org', protocol: 'https:', hostname: 'web.telegram.org' },
  addEventListener(type, handler) {
    const list = listeners.get('window:' + type) || [];
    list.push(handler);
    listeners.set('window:' + type, list);
  },
};
const ipcRenderer = { sendToHost(channel, payload) { hostMessages.push({ channel, payload }); } };
const context = {
  require(name) { assert.equal(name, 'electron'); return { ipcRenderer }; },
  document,
  window: windowObject,
  setTimeout() {},
  console,
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'bridge-preload.cjs' });

function fire(type, event) {
  for (const handler of listeners.get(type) || []) handler(event);
}
function target(kind, platform='telegram') {
  return {
    nodeType: 1,
    closest(selector) {
      if (kind === 'composer') {
        if (platform === 'telegram' && selector.includes('#editable-message-text')) return this;
        if (platform === 'whatsapp' && selector.includes('#main footer')) return this;
      }
      if (kind === 'button') {
        if (platform === 'telegram' && selector.includes('button.Button.send.main-button')) return this;
        if (platform === 'whatsapp' && selector.includes('button[aria-label="Send"]')) return this;
      }
      return null;
    },
    querySelector(selector) {
      return kind === 'button' && platform === 'whatsapp' && selector.includes('[data-icon="send"]') ? {} : null;
    },
  };
}
function keyEvent(composer, overrides={}) {
  return {
    isTrusted:true, key:'Enter', shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
    isComposing:false, repeat:false, target:composer, ...overrides,
  };
}
function shift() { return JSON.parse(JSON.stringify(hostMessages.shift())); }

const tgA=target('composer','telegram');
const tgB=target('composer','telegram');
activeComposer=tgA;
fire('focusin',{isTrusted:true,target:tgA});
assert.deepEqual(shift(),{channel:'geek-trusted-composer-context',payload:{protocolVersion:1,platform:'telegram',composerGeneration:1}});
fire('beforeinput',{isTrusted:true,target:tgA});
assert.deepEqual(shift(),{channel:'geek-trusted-composer-context',payload:{protocolVersion:1,platform:'telegram',composerGeneration:2}});
fire('keydown',keyEvent(tgA));
assert.deepEqual(shift(),{channel:'geek-trusted-submit',payload:{protocolVersion:1,platform:'telegram',kind:'keyboard',composerGeneration:2}});
assert.equal(hostMessages.length,0);

rootElement.setAttribute('data-geek-native-submit-commit','1');
fire('keydown',keyEvent(tgA));
fire('beforeinput',{isTrusted:true,target:tgA});
assert.equal(hostMessages.length,0,'owner-native commit must not mint a second permit/generation');
rootElement.removeAttribute('data-geek-native-submit-commit');

fire('beforeinput',{isTrusted:false,target:tgA});
fire('keydown',keyEvent(tgA));
assert.equal(shift().payload.composerGeneration,2);
for(const ev of [
  keyEvent(tgA,{isTrusted:false}), keyEvent(tgA,{key:'a'}), keyEvent(tgA,{shiftKey:true}),
  keyEvent(tgA,{ctrlKey:true}), keyEvent(tgA,{altKey:true}), keyEvent(tgA,{metaKey:true}),
  keyEvent(tgA,{isComposing:true}), keyEvent(tgA,{repeat:true}), keyEvent(target('other')),
]) fire('keydown',ev);
assert.equal(hostMessages.length,0);

fire('focusin',{isTrusted:true,target:tgB});
assert.equal(shift().payload.composerGeneration,3);
activeComposer=tgB;
fire('click',{isTrusted:true,target:target('button','telegram')});
assert.deepEqual(shift(),{channel:'geek-trusted-submit',payload:{protocolVersion:1,platform:'telegram',kind:'button',composerGeneration:3}});

windowObject.location={origin:'https://web.whatsapp.com',protocol:'https:',hostname:'web.whatsapp.com'};
const wa=target('composer','whatsapp');
activeComposer=wa;
fire('focusin',{isTrusted:true,target:wa});
assert.deepEqual(shift(),{channel:'geek-trusted-composer-context',payload:{protocolVersion:1,platform:'whatsapp',composerGeneration:1}});
fire('beforeinput',{isTrusted:true,target:wa});
assert.deepEqual(shift(),{channel:'geek-trusted-composer-context',payload:{protocolVersion:1,platform:'whatsapp',composerGeneration:2}});
fire('keydown',keyEvent(wa));
assert.deepEqual(shift(),{channel:'geek-trusted-submit',payload:{protocolVersion:1,platform:'whatsapp',kind:'keyboard',composerGeneration:2}});
fire('click',{isTrusted:true,target:target('button','whatsapp')});
assert.deepEqual(shift(),{channel:'geek-trusted-submit',payload:{protocolVersion:1,platform:'whatsapp',kind:'button',composerGeneration:2}});
fire('keydown',keyEvent(wa,{isTrusted:false}));
assert.equal(hostMessages.length,0);

assert.doesNotMatch(source,/preventDefault\(|stopPropagation\(/,'observer preload must not change native send behavior');
assert.doesNotMatch(source,/textContent|innerText|\.value|chatId|conversationId|accountId|bridgeToken/,'trusted gesture payload must not read message/chat/account/token content');
console.log('TRUSTED_SUBMIT_PRELOAD_CONTRACT_OK');
