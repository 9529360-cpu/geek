'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/instagram-send-intent-controller.js');
const semanticPath = path.join(__dirname, '../ui/semantic-send-intent-controller.js');
const controller = require(controllerPath);
const source = [controllerPath, semanticPath]
  .map(file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'))
  .join('\n');

function makeEnv(resultFactory = payload => ({ text: payload.text, delivery: { owner: 'send-intent', state: 'sent' } })) {
  const listeners = new Map();
  const requests = [];
  const notices = [];
  let marker = '';
  const editor = {
    nodeType: 1,
    innerText: 'hello',
    textContent: 'hello',
    isConnected: true,
    focused: false,
    focus() { this.focused = true; },
    closest(selector) { return selector.includes('[role="textbox"]') ? this : null; },
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
    location: { pathname: '/direct/t/thread-1/' },
    console: { error() {} },
    setTimeout() { return 1; },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    __geekTranslationRequest: async payload => { requests.push(payload); return resultFactory(payload); },
  };
  return { page, editor, listeners, requests, notices, setMarker(value) { marker = value; } };
}

function keyEvent(target) {
  return {
    target, isTrusted: true, key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false,
    metaKey: false, isComposing: false, repeat: false, prevented: 0, stopped: 0,
    preventDefault() { this.prevented += 1; },
    stopImmediatePropagation() { this.stopped += 1; },
  };
}

(async () => {
  assert.equal(controller.CONTROLLER_VERSION, 1);
  assert.equal(controller.isInstagramType('instagram'), true);
  assert.equal(controller.isInstagramType('messenger'), false);

  {
    const env = makeEnv();
    assert.equal(controller.installPageController(env.page), 'READY');
    const ev = keyEvent(env.editor);
    assert.equal(await env.page.__geekInstagramSendIntentController.submitThroughOwner(ev, env.editor), true);
    assert.equal(ev.prevented, 1);
    assert.equal(ev.stopped, 1);
    assert.deepEqual(env.requests, [{ text: 'hello', chatId: '/direct/t/thread-1', intent: 'outgoing-send' }]);
  }

  {
    const env = makeEnv(payload => ({ text: payload.text, delivery: { owner: 'legacy', state: 'sent' } }));
    controller.installPageController(env.page);
    const ev = keyEvent(env.editor);
    assert.equal(await env.page.__geekInstagramSendIntentController.submitThroughOwner(ev, env.editor), false);
    assert.match(env.notices.at(-1) || '', /未完成|重试/);
  }

  {
    const env = makeEnv();
    env.setMarker('1');
    controller.installPageController(env.page);
    const ev = keyEvent(env.editor);
    assert.equal(await env.page.__geekInstagramSendIntentController.submitThroughOwner(ev, env.editor), false);
    assert.equal(env.requests.length, 0);
  }

  {
    const env = makeEnv();
    env.page.location.pathname = '/direct/inbox/';
    controller.installPageController(env.page);
    const ev = keyEvent(env.editor);
    assert.equal(await env.page.__geekInstagramSendIntentController.submitThroughOwner(ev, env.editor), false);
    assert.equal(env.requests.length, 0);
  }

  {
    const guest = makeEnv().page;
    const expressions = [];
    const webview = {
      partition: 'persist:instagram-test',
      getAttribute(name) { return name === 'partition' ? this.partition : ''; },
      addEventListener() {},
      async executeJavaScript(expression) {
        expressions.push(expression);
        return Function('window', 'AbortController', 'return ' + expression)(guest, AbortController);
      },
    };
    const host = {
      document: { readyState: 'complete', documentElement: {}, querySelectorAll() { return [webview]; } },
      api: { accounts: { async list() { return { accounts: [{ type: 'instagram', partition: 'persist:instagram-test' }] }; } } },
    };
    assert.equal(controller.installShell(host), true);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(expressions.length >= 1);
    assert.equal(guest.__geekInstagramSendIntentController?.version, 1, 'stringified guest injection must stay self-contained');
  }

  assert.match(source, /intent:\s*'outgoing-send'/);
  assert.match(source, /delivery\?\.owner !== 'send-intent'/);
  assert.match(source, /event\?\.isTrusted !== true/);
  assert.match(source, /data-geek-native-submit-commit/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendTextMessage|\.click\(\)/, 'page controller must not own network/native send effects');

  console.log('INSTAGRAM_SEND_INTENT_CONTROLLER_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });
