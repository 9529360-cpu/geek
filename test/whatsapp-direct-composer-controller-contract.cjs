'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/whatsapp-direct-composer-controller.js');
const bootstrapPath = path.join(__dirname, '../ui/version-label.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
const controller = require(controllerPath);

function makeAbort() { return new AbortController(); }
function makeChat(id = '15551234567@c.us', flags = {}) { return { id: { _serialized: id }, ...flags }; }

function makePage(options = {}) {
  const notices = [];
  const nativeSends = [];
  const remembered = [];
  const translationCalls = [];
  const nativeChat = options.nativeChat || makeChat();
  let activeChat = options.activeChat || nativeChat;
  const globalSetting = { enabled: options.globalEnabled === true, autoSend: options.globalEnabled === true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' };
  const chats = options.chats || {};
  const page = {
    AbortController,
    console: { error() {} },
    WPP: { chat: { getActiveChat() { return activeChat; } } },
    document: {
      getElementById() { return null; },
      createElement() { return { style: {}, remove() {}, textContent: '', id: '' }; },
      body: { appendChild(node) { notices.push(node.textContent); } },
    },
    setTimeout() { return 1; },
    clearInterval() {},
    __geekTranslationConfig: { global: {}, chats },
    __geekGetTranslationSetting(id) {
      return Object.prototype.hasOwnProperty.call(chats, id) ? { ...globalSetting, ...chats[id] } : { ...globalSetting };
    },
    __geekTranslationRequest: async payload => {
      translationCalls.push(payload);
      if (options.translationError) throw options.translationError;
      return { text: `translated:${payload.text}` };
    },
    __geekRememberOutgoing(translated, original) { remembered.push([translated, original]); },
    __geekPickWpp() { return page.WPP; },
    __geekWhatsAppSendRecovery: { controller: makeAbort(), timer: 9 },
    __geekWhatsAppPublicComposerFallback: { controller: makeAbort() },
    __geekWhatsAppGuardAbort: makeAbort(),
  };
  const original = async (chat, ...args) => { nativeSends.push([chat, ...args]); return { id: 'native-1' }; };
  return { page, nativeChat, original, notices, nativeSends, remembered, translationCalls, setActiveChat(chat) { activeChat = chat; } };
}

(async () => {
  assert.equal(controller.CONTROLLER_VERSION, 5);
  assert.equal(controller.isWhatsAppType('whatsapp'), true);
  assert.equal(controller.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(controller.isWhatsAppType('telegram'), false);

  {
    const env = makePage({ globalEnabled: false });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    await owner.handleNativeSend(env.nativeChat, ['hello', { preserve: true }], env.original, null);
    assert.equal(env.translationCalls.length, 0);
    assert.equal(env.nativeSends.length, 1);
    assert.equal(env.nativeSends[0][1], 'hello');
    assert.deepEqual(env.nativeSends[0][2], { preserve: true });
  }

  {
    const active = makeChat('987654321@lid');
    const env = makePage({
      globalEnabled: false,
      activeChat: active,
      chats: { '987654321@lid': { enabled: true, autoSend: true, source: 'auto', target: 'it', provider: 'auto', route: 'default' } },
    });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const resolved = owner.resolveTranslationSetting(env.nativeChat, 'hello');
    assert.equal(resolved.mode, 'translate', 'active LID override must win even when native send chat is PN/c.us');
    assert.equal(resolved.chatId, '987654321@lid');
    await owner.handleNativeSend(env.nativeChat, ['hello', { quoted: true }], env.original, null);
    assert.equal(env.translationCalls.length, 1);
    assert.equal(env.translationCalls[0].chatId, '987654321@lid');
    assert.equal(env.nativeSends.length, 1);
    assert.equal(env.nativeSends[0][1], 'translated:hello', 'translation-on must never leak the raw source');
    assert.deepEqual(env.nativeSends[0][2], { quoted: true });
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
  }

  {
    const env = makePage({ globalEnabled: true, translationError: new Error('provider failed') });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    await assert.rejects(owner.handleNativeSend(env.nativeChat, ['secret raw'], env.original, null), /provider failed/);
    assert.equal(env.nativeSends.length, 0, 'translation failure must fail closed');
    assert.match(env.notices.at(-1) || '', /原文未发送/);
  }

  {
    const env = makePage({ globalEnabled: true });
    delete env.page.__geekTranslationConfig;
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    await assert.rejects(owner.handleNativeSend(env.nativeChat, ['secret raw'], env.original, null), /翻译配置尚未就绪/);
    assert.equal(env.nativeSends.length, 0, 'missing translation config must fail closed instead of leaking raw text');
  }

  {
    const group = makeChat('123@g.us', { isGroup: true });
    const env = makePage({ globalEnabled: true, nativeChat: group, activeChat: group });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    await owner.handleNativeSend(group, ['group hello'], env.original, null);
    assert.equal(env.translationCalls.length, 0);
    assert.equal(env.nativeSends[0][1], 'group hello');
  }

  {
    let resolveTranslation;
    const env = makePage({ globalEnabled: true });
    env.page.__geekTranslationRequest = () => new Promise(resolve => { resolveTranslation = resolve; });
    controller.installPageController(env.page);
    const owner = env.page.__geekWhatsAppDirectComposerController;
    const pending = owner.handleNativeSend(env.nativeChat, ['hello'], env.original, null);
    for (let i = 0; i < 3 && typeof resolveTranslation !== 'function'; i += 1) await Promise.resolve();
    assert.equal(typeof resolveTranslation, 'function', 'queued native send must enter the shared translation request before the switch probe');
    env.setActiveChat(makeChat('other@c.us'));
    resolveTranslation({ text: 'translated:hello' });
    await assert.rejects(pending, /聊天已切换/);
    assert.equal(env.nativeSends.length, 0);
  }

  assert.match(bootstrapSource, /whatsapp-direct-composer-controller\.js/);
  assert.doesNotMatch(bootstrapSource, /whatsapp-translation-hook-recovery\.js/);
  assert.doesNotMatch(source, /addEventListener\?\.\('keydown'|compose-btn-send|chat\.sendTextMessage/,
    'thin adapter must not own DOM gestures or a second WhatsApp send transport');
  assert.match(source, /handleNativeSend[\s\S]*__geekTranslationRequest[\s\S]*original\.call\(thisArg, chat, \.\.\.args\)/,
    'WhatsApp adapter must translate through the shared bridge then use the native platform send');
  assert.match(source, /activeId[\s\S]*hasOwn\(chats, activeId\)[\s\S]*nativeId[\s\S]*hasOwn\(chats, nativeId\)/,
    'chat-scoped translation settings must resolve active LID before native PN fallback');
  assert.doesNotMatch(source, /WAWebSendTextMsgChatAction|sendTextMsgToChat/);

  console.log('WHATSAPP_DIRECT_COMPOSER_CONTROLLER_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});