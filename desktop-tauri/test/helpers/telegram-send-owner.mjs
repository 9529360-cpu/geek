// Real build composition with offline Telegram worker ports. Browser setup below
// reuses those exact ports, while gestures and MutationObserver use Chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { telegramFixture, installTelegramPorts, flush } from './telegram-send.mjs';

const { compose, composeSend } = createRequire(import.meta.url)('../../scripts/prepare-platform.cjs');
export const compiled = { bridge: compose(), send: composeSend() };
export const generation = '00000000-0000-4000-8000-000000000001';
export const subscription = '00000000-0000-4000-8000-000000000002';
export const defaultPolicy = {
  provider: 'auto', route: 'default', enabled: true, autoSend: true, source: 'en', target: 'it',
  messageAction: true, displayTranslation: true, translationMode: 'click', messageTarget: 'zh', messageFrom: 'auto',
  groupAuto: false, translateHistory: false, includeZh: true, fontSize: 13, fontColor: '#667eea',
};

// This is only the typed native-to-guest protocol driver; it does not implement
// a queue, translation cache or SendIntent owner in place of production code.
export function ownerClient(window, generation, session, policy) {
  const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const bridge = window.__geekTauriPlatform;
  const api = window.__geekTauriSend;
  const configuration = { generation, sessionGeneration: session, active: true,
    settings: { revision: 1, global: { ...policy }, chats: {} } };
  const configure = () => api.configure(configuration);
  if (!bridge.bind(generation) || !configure()) throw new Error('Synthetic guest configuration refused');
  return { api, bridge, configuration, configure,
    poll: () => copy(api.poll(generation)),
    prepare: (request, output = 'Invia domani.', translated = true) => copy(api.prepare(generation,
      configuration.sessionGeneration, request.id, request.attempt, output, translated, request.context)),
    commit(request, permit = window.crypto.randomUUID()) {
      return { permit, accepted: api.commit(generation, request.id, request.attempt, permit) };
    },
    read: (request, permit) => copy(api.read(generation, request.id, request.attempt, permit)),
    deliver: (request, outcome) => api.deliver(generation, request.id, request.attempt, outcome),
    startBridge(operation, payload = {}, options = {}) {
      const request = { id: window.crypto.randomUUID(), generation, platformId: 'telegram-k', operation, payload,
        timeoutMs: 35000, ...options };
      return { id: request.id, request, accepted: bridge.begin(request) };
    },
    bridgeResult: (call) => copy(bridge.read(generation, call.id)),
    broadcastDraft: (fields = {}) => ({ attemptId: window.crypto.randomUUID(), targetId: 'tg:101',
      message: 'Synthetic broadcast text', tagAll: false, vcards: [], attachments: [], ...fields }),
  };
}

export function telegramOwnerFixture({ policy = {}, text = 'Please send tomorrow.', session = subscription, touch = false } = {}) {
  const f = telegramFixture({ install: false, touch });
  f.editor.innerText = text;
  f.run(compiled.bridge); f.run(compiled.send);
  const client = ownerClient(f.window, generation, session, { ...defaultPolicy, ...policy });
  function fire(type, target, values = {}) {
    const event = { type, target, isTrusted: true, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const callback of [...f.document.events.get(type) || []]) { callback(event); if (event.stopped) break; }
    return event;
  }
  return { ...f, ...client,
    enter: (values = {}) => fire('keydown', f.editor,
      { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...values }),
    click: (values = {}) => fire('click', f.icon, { detail: 1, ...values }),
    mousedown: (values = {}) => fire('mousedown', f.icon, { button: 0, ...values }),
    async input(text, trusted = true) {
      f.editor.innerText = text; f.mutate(); fire('input', f.editor, { isTrusted: trusted }); await flush();
    },
    feedback: () => f.document.getElementById('geek-translation-send-progress')?.textContent || '',
    async settle(request, flight) {
      await f.until(() => client.read(request, flight.permit).pending === false);
      return client.read(request, flight.permit).value;
    },
    async settleBridge(call) {
      assert.equal(call.accepted, true);
      await f.until(() => client.bridgeResult(call)?.pending === false);
      return client.bridgeResult(call);
    },
  };
}

export const browserHtml = `<!doctype html><meta charset="utf-8"><title>Offline K send fixture</title>
<style>body{font:16px sans-serif;margin:24px}.chat{width:600px}#input{padding:12px;border:1px solid #888}
[contenteditable]{white-space:pre-wrap;min-height:50px;outline:none}button{margin-top:12px;padding:12px}</style>
<div class="chat" data-type="chat"><div id="input"><div contenteditable="true" id="editor">Please send tomorrow.</div>
<button class="send" id="send"><span>Send</span></button></div></div>`;

export function browserSetup({ policy = {}, session = subscription } = {}) {
  const settings = JSON.stringify({ ...defaultPolicy, ...policy });
  return `window.fixture = (${installTelegramPorts.toString()})({ window,
    container: document.querySelector('.chat'), chatInput: document.querySelector('#input'),
    editor: document.querySelector('#editor'), button: document.querySelector('#send') });
${compiled.bridge}
${compiled.send}
window.qa = (${ownerClient.toString()})(window, ${JSON.stringify(generation)}, ${JSON.stringify(session)}, ${settings});`;
}
