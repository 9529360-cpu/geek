'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'platform-capabilities.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'platform-capabilities.js' });
assert.equal(typeof context.window.GeekPlatformCapabilities?.create, 'function');

const definitions = {
  whatsapp: { key: 'wa-definition' },
  'telegram-z': { key: 'tg-definition' },
  line: { key: 'line-definition' },
};
const built = [];
const contract = {
  hostRequired: ['getCurrentChat', 'listChats', 'openChat', 'setComposerText', 'sendText'],
  validate(adapter, required) {
    for (const name of required) assert.equal(typeof adapter[name], 'function');
    return adapter;
  },
};
const capabilities = context.window.GeekPlatformCapabilities.create({
  familyOf: type => ({ key: type === 'telegram-k' ? 'telegram' : type }),
  definitions,
  contract,
  buildAdapter(input) {
    built.push(input);
    return {
      getCurrentChat() {},
      listChats() {},
      openChat() {},
      setComposerText() {},
      sendText() {},
    };
  },
});
const webview = { id: 'wv' };
capabilities.forAccount({ id: 'wa-1', type: 'whatsapp' }, webview);
assert.equal(built[0].family, 'whatsapp');
assert.equal(built[0].definition, definitions.whatsapp);
assert.equal(built[0].webview, webview);
capabilities.forAccount({ id: 'tg-1', type: 'telegram-k' }, webview);
assert.equal(built[1].family, 'telegram');
assert.equal(built[1].definition, definitions['telegram-z']);
assert.throws(() => capabilities.forAccount({ id: 'web-1', type: 'website' }, webview));
assert.throws(() => capabilities.forAccount({ id: 'x-1', type: 'future-chat' }, webview));
assert.match(app, /const PLATFORM_CAPABILITY_DEFINITIONS = \{/);
assert.doesNotMatch(app, /const BROADCAST_ADAPTERS = \{/);
assert.match(app, /window\.GeekPlatformCapabilitiesRuntime = platformCapabilities;/);
assert.match(app, /window\.GeekPlatformTransports = platformCapabilities;/);
assert.match(app, /return platformCapabilities\.forAccount\(account, wv\);/);
assert.match(html, /platform-adapter-contract\.js[\s\S]*platform-capabilities\.js[\s\S]*app\.js/);

console.log('PLATFORM_CAPABILITIES_CONTRACT_OK');
