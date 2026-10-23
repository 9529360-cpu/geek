// Offline DOM/WA-JS port double; the same composed bundle also runs in Chromium.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const { composeSend } = createRequire(import.meta.url)('../../scripts/prepare-platform.cjs');
const bundle = composeSend();
export const generation = '00000000-0000-4000-8000-000000000001';
export const subscription = '00000000-0000-4000-8000-000000000002';
export const defaultPolicy = {
  provider: 'auto', route: 'default', enabled: true, autoSend: true, source: 'en', target: 'it',
  messageAction: true, displayTranslation: true, translationMode: 'click', messageTarget: 'zh', messageFrom: 'auto',
  groupAuto: false, translateHistory: false, includeZh: true, fontSize: 13, fontColor: '#667eea',
};
export const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

export function guest({ policy = {}, text = 'Please send 100 units tomorrow.', iframe = false, session = subscription } = {}) {
  let document;
  const observers = new Set();
  const mutation = (record) => {
    for (const observer of observers) {
      observer.records.push(record);
      if (!observer.scheduled) {
        observer.scheduled = true;
        queueMicrotask(() => {
          observer.scheduled = false;
          const records = observer.takeRecords();
          if (records.length && observers.has(observer)) observer.callback(records);
        });
      }
    }
  };
  class TextNode {
    constructor(value) { this.nodeType = 3; this.value = String(value); this.parentNode = null; }
    get textContent() { return this.value; }
    set textContent(value) { this.value = String(value); mutation({ target: this, type: 'characterData' }); }
    get isConnected() { return Boolean(this.parentNode?.isConnected); }
    remove() { this.parentNode?.removeChild(this); }
    contains(node) { return this === node; }
  }
  class Element {
    constructor(tag) {
      this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null;
      this.attributeMap = new Map(); this.listeners = new Map(); this.style = {}; this.hidden = false;
    }
    get isConnected() { return this === document || Boolean(this.parentNode?.isConnected); }
    get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
    get attributes() { return [...this.attributeMap].map(([name, value]) => ({ name, value })); }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(value) {
      const old = this.childNodes; for (const node of old) node.parentNode = null;
      this.childNodes = value === '' ? [] : [new TextNode(value)];
      for (const node of this.childNodes) node.parentNode = this;
      mutation({ target: this, type: 'childList', removedNodes: old, addedNodes: this.childNodes });
    }
    get innerText() { return this.childNodes.map((node) => node.tagName === 'BR' ? '\n' : node.innerText ?? node.textContent).join(''); }
    append(...nodes) {
      for (let node of nodes) {
        if (typeof node === 'string') node = new TextNode(node);
        node.remove(); node.parentNode = this; this.childNodes.push(node);
        mutation({ target: this, type: 'childList', addedNodes: [node], removedNodes: [] });
      }
    }
    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index < 0) throw new Error('NotFoundError');
      this.childNodes.splice(index, 1); node.parentNode = null;
      mutation({ target: this, type: 'childList', removedNodes: [node], addedNodes: [] });
    }
    remove() { this.parentNode?.removeChild(this); }
    replaceWith(node) {
      const parent = this.parentNode; const index = parent.childNodes.indexOf(this);
      node.remove(); parent.childNodes[index] = node; node.parentNode = parent; this.parentNode = null;
      mutation({ target: parent, type: 'childList', addedNodes: [node], removedNodes: [this] });
    }
    contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
    setAttribute(name, value) {
      this.attributeMap.set(name, String(value));
      if (['contenteditable', 'data-testid', 'data-tab'].includes(name)) mutation({ target: this, type: 'attributes' });
    }
    getAttribute(name) { return this.attributeMap.get(name) ?? null; }
    hasAttribute(name) { return this.attributeMap.has(name); }
    removeAttribute(name) { this.attributeMap.delete(name); mutation({ target: this, type: 'attributes' }); }
    matches(selector) {
      const simple = (node, part) => {
        const tag = part.match(/^[a-z]+/i)?.[0];
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        const id = part.match(/#([\w-]+)/)?.[1]; if (id && node.id !== id) return false;
        for (const match of part.matchAll(/\[([\w-]+)(?:([*^]?=)"([^"]*)")?\]/g)) {
          const actual = node.getAttribute(match[1]);
          if (actual === null || (match[2] === '=' && actual !== match[3])
              || (match[2] === '*=' && !actual.includes(match[3])) || (match[2] === '^=' && !actual.startsWith(match[3]))) return false;
        }
        return true;
      };
      return selector.split(',').some((group) => {
        const parts = group.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        if (!simple(this, parts.pop())) return false;
        let parent = this.parentNode;
        while (parts.length) {
          const part = parts.pop();
          while (parent && !simple(parent, part)) parent = parent.parentNode;
          if (!parent) return false;
          parent = parent.parentNode;
        }
        return true;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() { return this.isConnected && !this.hidden && this.style.display !== 'none' ? [{ width: 500, height: 42 }] : []; }
    addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== callback)); }
    fire(type, values = {}) {
      const event = { type, target: this, isTrusted: true, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
      for (const callback of this.listeners.get(type) || []) { callback(event); if (event.stopped) break; }
      return event;
    }
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.records = []; this.scheduled = false; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); this.records = []; }
    takeRecords() { const records = this.records; this.records = []; return records; }
  }
  document = new Element('document'); document.visibilityState = 'visible';
  document.createElement = (tag) => new Element(tag);
  document.createTextNode = (value) => new TextNode(value);
  document.documentElement = new Element('html'); document.append(document.documentElement);
  document.body = new Element('body'); document.documentElement.append(document.body);
  const main = new Element('main'); main.id = 'main'; document.body.append(main);
  const footer = new Element('footer'); main.append(footer);
  let editor = new Element('div'); editor.setAttribute('contenteditable', 'true'); editor.setAttribute('role', 'textbox');
  editor.setAttribute('data-testid', 'conversation-compose-box-input'); editor.textContent = text; footer.append(editor);
  const button = new Element('button'); button.setAttribute('data-testid', 'compose-btn-send'); footer.append(button);
  const icon = new Element('span'); icon.setAttribute('data-icon', 'send'); button.append(icon);
  const state = { generation, now: 0, text, chatId: '100@c.us', sent: [], cleared: [], generatedIds: [], handlers: new Map() };
  class ModelEvents {
    constructor() { this.handlers = new Map(); }
    on(name, callback) {
      const handlers = this.handlers.get(name) || new Set(); handlers.add(callback); this.handlers.set(name, handlers);
    }
    off(name, callback) { this.handlers.get(name)?.delete(callback); }
    field(name, initial) {
      let value = initial;
      Object.defineProperty(this, name, { enumerable: true, configurable: true,
        get: () => value, set: (next) => { if (next === value) return; value = next;
          for (const callback of this.handlers.get(`change:${name}`) || []) callback(this, next); },
      });
    }
  }
  const wid = (id) => ({ _serialized: id, toString: () => id });
  class MsgKey {
    constructor(serialized) {
      const [fromMe, remote, id, participant] = serialized.split('_');
      this.fromMe = fromMe === 'true'; this.remote = wid(remote); this.id = id;
      this.participant = participant ? wid(participant) : undefined; this._serialized = serialized;
    }
    toString() { return this._serialized; }
    equals(value) { return value instanceof MsgKey && value._serialized === this._serialized; }
    static fromString(value) {
      if (!/^(true|false)_[^_]+_[^_]+(?:_[^_]+)?$/.test(value)) throw new Error('Invalid synthetic message key');
      return new MsgKey(value);
    }
  }
  class ContactModel { constructor(name) { this.name = name; this.displayName = name; } }
  class MsgModel extends ModelEvents {
    constructor(key, body, author) {
      super(); this.field('id', key); this.field('body', body); this.field('type', 'chat');
      this.field('notifyName', author); this.field('senderObj', new ContactModel(author));
      this.replyable = true; this.isStatusV3 = false; this.isMedia = false;
    }
  }
  const messages = new Map(); state.messages = messages;
  const chats = new Map();
  const model = (id) => {
    if (!chats.has(id)) {
      const chat = new ModelEvents();
      Object.assign(chat, { id, canSend: true, isGroup: id.endsWith('@g.us'),
        msgs: new Map(), getComposeContents: () => ({ text: state.text, timestamp: 1 }) });
      for (const name of ['composeQuotedMsg', 'composeQuotedMsgRemoteJid', 'quotedMsgAdminGroupJid', 'attachMediaContents']) chat.field(name, null);
      chats.set(id, chat);
    }
    return chats.get(id);
  };
  const WPP = { isInjected: true, isReady: true,
    whatsapp: { MsgKey, MsgModel, ContactModel, MsgStore: { get: (key) => messages.get(String(key)) },
      canReplyMsg: (message) => message.replyable === true },
    on: (name, callback) => state.handlers.set(name, callback), off: (name) => state.handlers.delete(name),
    chat: { getActiveChat: () => model(state.chatId),
      sendTextMessage: (...args) => { state.sent.push(args); return state.transport ? state.transport(...args) : Promise.resolve({ id: 'receipt-1', ack: 1 }); },
      setInputText: (...args) => {
        state.cleared.push(args);
        if (state.clear) return state.clear(...args);
        state.text = args[0]; editor.textContent = args[0]; return Promise.resolve({ text: args[0], timestamp: 1 });
      },
    },
  };
  const timers = new Map(); let timerId = 0;
  const window = { WPP, __geekTauriPlatform: { matches: (id) => id === state.generation },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; }, clearTimeout: (id) => timers.delete(id) };
  window.top = iframe ? {} : window;
  const createId = () => { const id = randomUUID(); state.generatedIds.push(id); return id; };
  runInNewContext(bundle, { window, document, crypto: { randomUUID: createId }, TextEncoder, MutationObserver: Observer,
    performance: { now: () => state.now } });
  const api = window.__geekTauriSend;
  const configuration = { generation, sessionGeneration: session, active: true,
    settings: { revision: 1, global: { ...defaultPolicy, ...policy }, chats: {} } };
  const configure = () => api.configure(structuredClone(configuration));
  if (api) configure();
  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const poll = () => copy(api.poll(generation));
  const enter = (values = {}) => document.fire('keydown', { key: 'Enter', target: editor, ...values });
  const click = (values = {}) => document.fire('click', { target: icon, ...values });
  const input = async (value, { trusted = true, before = true } = {}) => {
    if (before) document.fire('beforeinput', { target: editor, isTrusted: trusted });
    editor.textContent = value; state.text = value;
    document.fire('input', { target: editor, isTrusted: trusted }); await tick();
  };
  const switchChat = (id, value = state.text) => {
    state.chatId = id; state.text = value; editor.textContent = value;
    state.handlers.get('chat.active_chat')?.(model(id));
  };
  const replaceEditor = () => {
    const next = new Element('div'); next.setAttribute('contenteditable', 'true'); next.setAttribute('data-testid', 'conversation-compose-box-input');
    next.textContent = state.text; editor.replaceWith(next); editor = next; return editor;
  };
  const prepare = (request, output = 'Invia 100 unità domani.', translated = true,
    sessionId = configuration.sessionGeneration, context = request.context) =>
    copy(api.prepare(generation, sessionId, request.id, request.attempt, output, translated, context));
  const commit = (request, permit = randomUUID()) => ({ permit, accepted: api.commit(generation, request.id, request.attempt, permit) });
  const read = (request, permit) => copy(api.read(generation, request.id, request.attempt, permit));
  const deliver = (request, outcome) => api.deliver(generation, request.id, request.attempt, outcome);
  const feedback = () => document.querySelector('#geek-translation-send-progress')?.textContent || '';
  const reply = ({ body = 'Original order for 100 units.', author = 'Alice', chatId = state.chatId,
    id = 'QUOTE1', byKey = false, chatStore = false } = {}) => {
    const message = new MsgModel(new MsgKey(`false_${chatId}_${id}`), body, author);
    if (chatStore) model(chatId).msgs.set(message.id, message);
    else messages.set(message.id.toString(), message);
    const banner = new Element('div'); banner.className = 'reply-banner';
    const authorNode = new Element('span'); authorNode.setAttribute('dir', 'auto'); authorNode.textContent = author;
    const bodyNode = new Element('div'); bodyNode.setAttribute('dir', 'auto'); bodyNode.textContent = body;
    banner.append(authorNode, bodyNode); footer.append(banner);
    model(state.chatId).composeQuotedMsg = byKey ? message.id : message;
    return { message, banner, author: authorNode, body: bodyNode };
  };
  return { api, window, document, main, footer, get editor() { return editor; }, button, icon, state, model, configuration,
    configure, poll, enter, click, input, switchChat, replaceEditor, prepare, commit, read, deliver, feedback, reply };
}
