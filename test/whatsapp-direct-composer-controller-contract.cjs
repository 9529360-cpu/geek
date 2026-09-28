'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/whatsapp-direct-composer-controller.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const controller = require(controllerPath);

function makeEnv(resultFactory = payload => ({ text: payload.text, delivery: { owner: 'send-intent', state: 'sent' } })) {
  const listeners = new Map();
  const requests = [];
  const remembered = [];
  const notices = [];
  let marker = '';
  const editor = {
    nodeType: 1,
    innerText: 'hello',
    textContent: 'hello',
    isConnected: true,
    focused: false,
    focus() { this.focused = true; },
    closest() { return this; },
  };
  const document = {
    documentElement: { getAttribute(name) { return name === 'data-geek-native-submit-commit' ? marker : ''; } },
    addEventListener(type, fn) { listeners.set(type, fn); },
    querySelector() { return editor; },
    getElementById() { return null; },
    createElement() { return { style: {}, remove() {}, textContent: '', id: '' }; },
    body: { appendChild(node) { notices.push(node.textContent); } },
  };
  const page = {
    AbortController,
    document,
    console: { error() {} },
    WPP: { chat: { getActiveChat() { return { id: { _serialized: 'chat-1' } }; } } },
    setTimeout() { return 1; },
    clearInterval() {},
    __geekTranslationRequest: async payload => { requests.push(payload); return resultFactory(payload); },
    __geekRememberOutgoing(translated, original) { remembered.push([translated, original]); },
    __geekWhatsAppSendRecovery: { controller: new AbortController(), timer: 1 },
    __geekWhatsAppPublicComposerFallback: { controller: new AbortController() },
    __geekWhatsAppGuardAbort: new AbortController(),
  };
  return { page, editor, listeners, requests, remembered, notices, setMarker(v) { marker = v; } };
}

function event() {
  return {
    isTrusted: true,
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    prevented: 0,
    stopped: 0,
    target: null,
    preventDefault() { this.prevented += 1; },
    stopImmediatePropagation() { this.stopped += 1; },
  };
}

(async () => {
  assert.equal(controller.CONTROLLER_VERSION, 9);
  assert.equal(controller.isWhatsAppType('whatsapp'), true);
  assert.equal(controller.isWhatsAppType('whatsapp-pure'), true);
  assert.equal(controller.isWhatsAppType('telegram'), false);

  {
    const env = makeEnv();
    const key = event(); key.target = env.editor;
    assert.equal(controller.installPageController(env.page), 'READY');
    const ok = await env.page.__geekWhatsAppDirectComposerController.submitThroughOwner(key, env.editor);
    assert.equal(ok, true);
    assert.equal(key.prevented, 1);
    assert.equal(key.stopped, 1);
    assert.deepEqual(env.requests, [{ text: 'hello', chatId: 'chat-1', intent: 'outgoing-send' }]);
    assert.deepEqual(env.remembered, []);
  }

  {
    const env = makeEnv(payload => ({ text: 'translated:' + payload.text, delivery: { owner: 'send-intent', state: 'sent' } }));
    controller.installPageController(env.page);
    const ev = event(); ev.target = env.editor;
    assert.equal(await env.page.__geekWhatsAppDirectComposerController.submitThroughOwner(ev, env.editor), true);
    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);
  }

  {
    const env = makeEnv(payload => ({ text: payload.text, delivery: { owner: 'legacy', state: 'sent' } }));
    controller.installPageController(env.page);
    const ev = event(); ev.target = env.editor;
    assert.equal(await env.page.__geekWhatsAppDirectComposerController.submitThroughOwner(ev, env.editor), false);
    assert.match(env.notices.at(-1) || '', /未发送|未发/);
  }

  {
    const env = makeEnv();
    env.setMarker('1');
    controller.installPageController(env.page);
    const ev = event(); ev.target = env.editor;
    assert.equal(await env.page.__geekWhatsAppDirectComposerController.submitThroughOwner(ev, env.editor), false);
    assert.equal(env.requests.length, 0, 'owner-generated native commit must not mint a second transaction');
  }

  {
    const guest = makeEnv().page;
    const expressions = [];
    const webview = {
      partition: 'persist:wa-test',
      getAttribute(name) { return name === 'partition' ? this.partition : ''; },
      addEventListener() {},
      async executeJavaScript(expression) {
        expressions.push(expression);
        return Function('window', 'AbortController', 'return ' + expression)(guest, AbortController);
      },
    };
    const host = {
      document: { readyState: 'complete', documentElement: {}, querySelectorAll() { return [webview]; } },
      api: { accounts: { async list() { return { accounts: [{ type: 'whatsapp', partition: 'persist:wa-test' }] }; } } },
    };
    assert.equal(controller.installShell(host), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(expressions.length >= 1, 'shell must attempt guest injection');
    assert.equal(guest.__geekWhatsAppDirectComposerController?.version, 9, 'stringified guest injection must be self-contained');
  }
  assert.match(source, /api\.installShell\(root\)/, 'host bootstrap must auto-install the WhatsApp controller shell');
  assert.match(source, /intent:\s*'outgoing-send'/);
  assert.match(source, /delivery\?\.owner !== 'send-intent'/);
  assert.match(source, /event\?\.isTrusted !== true/);
  assert.match(source, /data-geek-native-submit-commit/);
  assert.doesNotMatch(source, /nativeQueue|handleNativeSend|resolveTranslationSetting|sendTextMessage\(|sendTextMsgToChat|original\.call/);

  console.log('WHATSAPP_DIRECT_COMPOSER_CONTROLLER_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });
