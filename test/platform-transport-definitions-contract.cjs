'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/platform-transport-definitions.js'), 'utf8').replace(/\r\n?/g, '\n');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'platform-transport-definitions.js' });

const owner = context.window.GeekPlatformTransportDefinitions;
assert.equal(typeof owner?.create, 'function');
assert.equal(typeof owner?.register, 'function');

const registry = owner.create();
assert.deepEqual(Array.from(registry.families()).sort(), ['line', 'telegram', 'whatsapp']);
assert.deepEqual(Array.from(registry.keys()).sort(), ['line', 'telegram-z', 'whatsapp']);
assert.equal(registry.hasFamily('telegram'), true);
assert.equal(registry.hasKey('telegram-z'), true);
assert.equal(typeof registry.definitionFor({ family: 'whatsapp' })?.sendDirect, 'function');
assert.equal(typeof registry.definitionFor({ family: 'telegram' })?.getChats, 'string');
assert.equal(typeof registry.definitionFor({ family: 'line' })?.switchChat, 'function');

const futureDefinition = Object.freeze({
  getChats: 'FUTURE_CHATS',
  switchChat: id => 'FUTURE_SWITCH:' + id,
  setMessage: text => 'FUTURE_SET:' + text,
  send: text => 'FUTURE_SEND:' + text,
});
registry.register('future-v1', futureDefinition, { family: 'future-chat' });
assert.equal(registry.hasFamily('future-chat'), true);
assert.equal(registry.hasKey('future-v1'), true);
assert.equal(registry.definitionFor({ family: 'future-chat' }), futureDefinition);
assert.throws(() => registry.register('future-v1', futureDefinition, { family: 'other' }), /already registered/);
assert.throws(() => registry.register('future-v2', futureDefinition, { family: 'future-chat' }), /family already registered/);

owner.register('preload-v1', futureDefinition, { family: 'preload-chat' });
const second = owner.create();
assert.equal(second.definitionFor({ family: 'preload-chat' }), futureDefinition, 'pre-app contribution must be copied into each runtime registry');
assert.equal(registry.definitionFor({ family: 'preload-chat' }), null, 'existing registry snapshots must not mutate behind their owner');

assert.match(source, /BUILTIN_DEFINITIONS/);
assert.match(source, /extensionDefinitions/);
assert.match(source, /function register\(/);
assert.match(source, /function create\(/);
assert.doesNotMatch(source, /window\.api|document\.querySelector\('#webview-container'/, 'transport registry must stay declarative and host-agnostic');

console.log('PLATFORM_TRANSPORT_DEFINITIONS_CONTRACT_OK');
