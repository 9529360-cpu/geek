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

function trustedEnter(handler, target) {
  const counters = { prevented: 0, stopped: 0 };
  handler({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, isTrusted: true, target,
    preventDefault() { counters.prevented += 1; },
    stopImmediatePropagation() { counters.stopped += 1; },
  });
  return counters;
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
  const modulesById = new Map([['WAWebDynamicSend', mod]]);
  const chat = makeChat('123@c.us');
  const editor = {
    innerText: 'hello',
    textContent: 'hello',
    closest(selector) { return selector.includes('contenteditable') ? this : null; },
  };
  let legacyPrivateAliasCalls = 0;
  const firstRequire = function (name) {
    legacyPrivateAliasCalls += 1;
    if (name === 'WAWebSendTextMsgChatAction') throw new Error('private module alias removed');
    return null;
  };
  firstRequire.registryVersion = 'generation-1';

  const page = {
    require: firstRequire,
    WPP: {
      chat: { getActiveChat() { return chat; } },
      whatsapp: {
        functions: { sendTextMsgToChat: native },
        _moduleIdMap: moduleIdMap,
      },
      loader: {
        moduleRequire(id) {
          return modulesById.get(id) || null;
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
  assert.notEqual(page.require, firstRequire, 'recovery should install only the narrow compatibility require alias');
  assert.equal(page.require.registryVersion, 'generation-1', 'compatibility alias must preserve live require properties');
  assert.equal(page.require('WAWebSendTextMsgChatAction'), mod, 'legacy app.js lookup must resolve through the WA-JS compatibility alias');
  assert.equal(legacyPrivateAliasCalls, 0, 'mapped resolution must not call the removed private module alias');

  assert.equal(await mod.sendTextMsgToChat(chat, 'hello'), 'native-ok');
  assert.deepEqual(nativeCalls, ['translated:hello'], 'ordinary composer path must send only the translated text');

  // Simulate a later WhatsApp generation that replaces BOTH the send module id
  // and the global require function. Window-capture recovery must refresh the
  // WA-JS module id and reinstall the alias before app.js's document guard runs.
  const nextCalls = [];
  const nextNative = async function (_chat, text) {
    nextCalls.push(text);
    return 'next-ok';
  };
  const nextMod = { sendTextMsgToChat: nextNative };
  moduleIdMap.set(nextNative, 'WAWebDynamicSendV2');
  modulesById.set('WAWebDynamicSendV2', nextMod);
  page.WPP.whatsapp.functions.sendTextMsgToChat = nextNative;

  let replacementPrivateAliasCalls = 0;
  const replacementRequire = function (name) {
    replacementPrivateAliasCalls += 1;
    if (name === 'WAWebSendTextMsgChatAction') throw new Error('replacement private module alias removed');
    return null;
  };
  replacementRequire.registryVersion = 'generation-2';
  page.require = replacementRequire;
  editor.innerText = 'next';
  editor.textContent = 'next';

  const gesture = trustedEnter(listeners.get('keydown'), editor);
  assert.deepEqual(gesture, { prevented: 0, stopped: 0 }, 'healthy mapped recovery must not block the trusted composer gesture');
  assert.notEqual(page.require, replacementRequire, 'same-gesture recovery must repair a replaced global require function');
  assert.equal(page.require.registryVersion, 'generation-2', 'reinstalled alias must preserve the replacement require surface');
  assert.equal(page.require('WAWebSendTextMsgChatAction'), nextMod, 'app.js lookup must follow the new WA-JS module generation');
  assert.equal(replacementPrivateAliasCalls, 0, 'new mapped generation must not probe the missing private alias');
  assert.equal(page.__geekWhatsAppSendRecovery.resolveSendModule(), nextMod, 'recovery and app compatibility alias must share the same live send module owner');

  assert.equal(await nextMod.sendTextMsgToChat(chat, 'next'), 'next-ok');
  assert.deepEqual(nextCalls, ['translated:next'], 'new module generation must still translate exactly once before native send');

  // Translation-disabled chats stay a pure native pass-through on the same
  // WA-JS-resolved module path.
  page.__geekGetTranslationSetting = () => ({ enabled: false, autoSend: false });
  assert.equal(await nextMod.sendTextMsgToChat(chat, 'raw-allowed'), 'next-ok');
  assert.deepEqual(nextCalls, ['translated:next', 'raw-allowed'], 'disabled outgoing translation must not rewrite native text');

  assert.match(source, /WPP[\s\S]*whatsapp[\s\S]*_moduleIdMap/, 'recovery must derive the native send owner from WA-JS export metadata');
  assert.match(source, /moduleRequire[\s\S]*mappedSendModuleId/, 'recovery must load the mapped live module through the WA-JS loader');
  assert.match(source, /new ProxyCtor\(baseRequire/, 'compatibility alias must preserve the live require surface instead of replacing it with a bare function');
  assert.match(source, /const ensureHook[\s\S]*installLegacySendModuleAlias\(\)/, 'lifecycle recovery must repair the app compatibility alias on every hook check');
  assert.match(source, /resolveMappedSendModule\(\) \|\| resolveLegacySendModule\(\)/, 'fixed private module name must remain fallback-only');

  console.log('whatsapp dynamic send module resolver contract passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
