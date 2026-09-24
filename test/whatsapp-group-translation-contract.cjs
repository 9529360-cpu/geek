'use strict';
const assert = require('node:assert/strict');
const { installPageController } = require('../ui/whatsapp-direct-composer-controller.js');
const chat = (id, flags = {}) => ({ id: { _serialized: id }, ...flags });
function fixture(options = {}) {
  const group = options.chat || chat('123@g.us', { isGroup: true });
  let active = group;
  const calls = [], sends = [];
  const globalSetting = { enabled: true, autoSend: true, includeZh: true, source: 'auto', target: 'it', provider: 'auto', route: 'default', ...options.setting };
  const page = {
    AbortController, console: { error() {} }, clearInterval() {},
    WPP: { chat: { getActiveChat: () => active } },
    __geekTranslationConfig: { global: {}, chats: options.chats || {} },
    __geekGetTranslationSetting(id) { return { ...globalSetting, ...page.__geekTranslationConfig.chats[id] }; },
    async __geekTranslationRequest(payload) {
      calls.push(payload);
      if (options.error) throw options.error;
      return { text: 'translated:' + payload.text };
    },
  };
  const result = { accepted: true }, receiver = {};
  function original(target, ...args) { sends.push({ target, args, receiver: this }); return result; }
  installPageController(page);
  return { page, group, calls, sends, result, receiver, original, owner: page.__geekWhatsAppDirectComposerController,
    switchTo(next) { active = next; } };
}
(async () => {
  {
    const f = fixture(), options = { quotedMsg: { id: 'test-quote' }, mentionedJidList: ['1@lid'] };
    const args = ['group source', options];
    assert.equal(await f.owner.handleNativeSend(f.group, args, f.original, f.receiver), f.result);
    assert.equal(f.calls.length, 1, 'enabled group composer must enter shared translation, not raw passthrough');
    assert.equal(f.calls[0].intent, 'outgoing-send');
    assert.equal(f.calls[0].target, 'it');
    assert.equal(f.calls[0].chatId, '123@g.us');
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].args[0], 'translated:group source');
    assert.equal(f.sends[0].args[1], options, 'native quote/mention options retain identity');
    assert.equal(f.sends[0].target, f.group);
    assert.equal(f.sends[0].receiver, f.receiver);
    assert.equal(args[0], 'group source', 'source snapshot must remain recoverable');
  }
  {
    const f = fixture({ chats: { '123@g.us': { target: 'de' }, '456@g.us': { target: 'fr' } } });
    f.switchTo(chat('456@g.us', { isGroup: true }));
    const resolved = await f.owner.resolveTranslationSetting(f.group, 'group source');
    assert.equal(resolved.chatId, '123@g.us', 'group settings never borrow the focused group identity');
    assert.equal(resolved.setting.target, 'de');
  }
  for (const setting of [{ enabled: false, autoSend: false }, { includeZh: false }]) {
    const f = fixture({ setting });
    await f.owner.handleNativeSend(f.group, ['\u7fa4\u6d88\u606f'], f.original, f.receiver);
    assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 1);
  }
  for (const error of [Object.assign(new Error('no quota'), { code: 'QUOTA_EXHAUSTED', category: 'quota' }), new Error('provider failed')]) {
    const f = fixture({ error });
    await assert.rejects(f.owner.handleNativeSend(f.group, ['group source'], f.original), e => e === error);
    assert.equal(f.sends.length, 0, 'failed transform must never send raw group text');
  }
  {
    const f = fixture(); delete f.page.__geekTranslationConfig;
    await assert.rejects(f.owner.handleNativeSend(f.group, ['group source'], f.original));
    assert.equal(f.sends.length, 0, 'missing config must fail closed');
  }
  {
    const f = fixture(); let settle;
    f.page.__geekTranslationRequest = () => new Promise(resolve => { settle = resolve; });
    const pending = f.owner.handleNativeSend(f.group, ['group source'], f.original);
    for (let i = 0; i < 10 && !settle; i++) await Promise.resolve();
    assert.equal(typeof settle, 'function');
    f.switchTo(chat('456@g.us', { isGroup: true }));
    settle({ text: 'translated:group source' });
    await assert.rejects(pending);
    assert.equal(f.sends.length, 0, 'commit must recheck the exact group');
  }
  for (const target of [chat('123@newsletter', { isNewsletter: true }), chat('status@broadcast', { isBroadcast: true })]) {
    const f = fixture({ chat: target });
    assert.equal(f.owner.handleNativeSend(target, ['source'], f.original), f.result);
    assert.equal(f.calls.length, 0, 'non-chat publication paths remain unchanged');
  }
  console.log('WHATSAPP_GROUP_TRANSLATION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
