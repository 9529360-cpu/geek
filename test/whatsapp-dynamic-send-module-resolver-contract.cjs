'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const recoveryPath = path.join(__dirname, '../ui/whatsapp-translation-hook-recovery.js');
const source = fs.readFileSync(recoveryPath, 'utf8');
const recovery = require(recoveryPath);

function makeChat(id) {
  let contents = { text: 'hello', timestamp: 1 };
  return {
    id: { _serialized: id },
    getComposeContents() { return { ...contents }; },
    setComposeContents(next) { contents = { ...(next || {}) }; },
  };
}

(async () => {
  const listeners = new Map();
  const mod = {};
  const nativeCalls = [];
  const native = async function (_chat, text) {
    nativeCalls.push(text);
    return 'native-ok';
  };
  mod.sendTextMsgToChat = native;

  // WA-JS records the exported function object -> real module id. Simulate a
  // current WhatsApp generation where Meta's old private module alias is gone.
  const moduleIdMap = new WeakMap([[native, 'WAWebDynamicSend']]);
  const chat = makeChat('123@c.us');
  const editor = {
    innerText: 'hello',
    textContent: 'hello',
    closest(selector) { return selector.includes('contenteditable') ? this : null; },
  };
  let legacyPrivateAliasCalls = 0;
  const page = {
    require(name) {
      legacyPrivateAliasCalls += 1;
      if (name === 'WAWebSendTextMsgChatAction') throw new Error('private module alias removed');
      return null;
    },
    WPP: {
      chat: { getActiveChat() { return chat; } },
      whatsapp: {
        functions: { sendTextMsgToChat: native },
        _moduleIdMap: moduleIdMap,
      },
      loader: {
        moduleRequire(id) {
          return id === 'WAWebDynamicSend' ? mod : null;
        },
      },
    },
    AbortController,
    console: { error() {} },
    document: {
      querySelector() { return editor; },
      getElementById() { return null; },
      createElement() { return { style: {}, remove() {} }; },
      body: { appendChild() {} },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    __geekSendQueue: Promise.resolve(),
    __geekGetTranslationSetting() {
      return { enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' };
    },
    __geekTranslationRequest: async ({ text }) => ({ text: `translated:${text}` }),
  };

  assert.equal(recovery.installPageRecovery(page, recovery.RECOVERY_VERSION), 'READY', 'WA-JS mapped send owner must be enough to install recovery');
  assert.equal(page.require('WAWebSendTextMsgChatAction'), mod, 'legacy app.js lookup must resolve through the WA-JS compatibility alias');
  assert.equal(legacyPrivateAliasCalls, 0, 'mapped resolution must not call the removed private module alias');

  assert.equal(await mod.sendTextMsgToChat(chat, 'hello'), 'native-ok');
  assert.deepEqual(nativeCalls, ['translated:hello'], 'ordinary composer path must send only the translated text');

  // The WA-JS export getter may still point at the original exported function
  // after Geek wraps the live module. Cached module-id ownership must therefore
  // continue to work when WhatsApp swaps the live function in the same module.
  const nextCalls = [];
  const nextNative = async function (_chat, text) {
    nextCalls.push(text);
    return 'next-ok';
  };
  mod.sendTextMsgToChat = nextNative;
  assert.equal(page.__geekWhatsAppSendRecovery.ensureHook(), true, 'cached WA-JS module id must recover a later live-function generation');
  assert.equal(await mod.sendTextMsgToChat(chat, 'next'), 'next-ok');
  assert.deepEqual(nextCalls, ['translated:next']);

  assert.match(source, /WPP[\s\S]*whatsapp[\s\S]*_moduleIdMap/, 'recovery must derive the native send owner from WA-JS export metadata');
  assert.match(source, /moduleRequire[\s\S]*mappedSendModuleId/, 'recovery must load the mapped live module through the WA-JS loader');
  assert.match(source, /__geekWhatsAppSendModuleAliasOriginal/, 'legacy app.js private-name lookup must be a narrow compatibility alias');
  assert.match(source, /resolveMappedSendModule\(\) \|\| resolveLegacySendModule\(\)/, 'fixed private module name must remain fallback-only');

  console.log('whatsapp dynamic send module resolver contract passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
