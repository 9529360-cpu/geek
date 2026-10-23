// Offline behavioral double. Real Chromium also exercises these guest paths.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const { composeTranslation } = createRequire(import.meta.url)('../../scripts/prepare-platform.cjs');
const bundle = composeTranslation();
export const generation = '00000000-0000-4000-8000-000000000001';
export const subscription = '00000000-0000-4000-8000-000000000002';
export const defaultPolicy = {
  provider: 'auto', route: 'default', enabled: false, autoSend: false, source: 'auto', target: 'en',
  messageAction: true, displayTranslation: true, translationMode: 'click', messageTarget: 'zh', messageFrom: 'en',
  groupAuto: false, translateHistory: false, includeZh: true, fontSize: 13, fontColor: '#667eea',
};

export function guest({ policy = {}, iframe = false } = {}) {
  let document;
  class Element {
    constructor(tag) {
      this.tag = tag; this.parent = null; this.children = []; this.attributes = new Map();
      this.listeners = new Map(); this.style = {}; this.dataset = {}; this.text = ''; this.className = '';
    }
    get isConnected() { return this === document || Boolean(this.parent?.isConnected); }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.children.slice().forEach((child) => child.remove()); this.text = String(value); }
    get innerText() { return this.textContent; }
    append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
    after(child) {
      child.remove(); child.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child);
    }
    replaceWith(child) { this.after(child); this.remove(); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    matches(selector) {
      if (selector === '[data-testid^="conv-msg-"][data-id]') {
        return this.getAttribute('data-testid')?.startsWith('conv-msg-') && this.attributes.has('data-id');
      }
      if (selector === '[data-pre-plain-text]') return this.attributes.has('data-pre-plain-text');
      if (selector === 'span[dir="ltr"],span[dir="rtl"]') return this.tag === 'span';
      if (selector === '.geek-translation-result') return this.className.split(' ').includes('geek-translation-result');
      return this.tag === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return this.hidden ? { width: 0, height: 0 } : { top: 30, bottom: 100, left: 20, right: 500, width: 480, height: 70 }; }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    fire(type, values = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, isTrusted: true, ...values };
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
  }
  document = new Element('document'); document.visibilityState = 'visible';
  document.createElement = (tag) => new Element(tag);
  document.body = new Element('body'); document.append(document.body);
  const main = new Element('main'); document.body.append(main);
  document.querySelectorAll = (selector) => selector.startsWith('#main ')
    ? main.querySelectorAll(selector.slice(6)) : document.body.querySelectorAll(selector);
  const state = { chatId: '100@c.us', generation, now: 0 };
  const messages = new Map();
  const window = { innerWidth: 960, innerHeight: 640,
    __geekTauriPlatform: { matches: (value) => value === state.generation },
    WPP: { chat: { getActiveChat: () => ({ id: state.chatId, name: 'Synthetic' }) },
      whatsapp: { MsgStore: { get: (id) => messages.get(id) } } },
  };
  window.top = iframe ? {} : window;
  runInNewContext(bundle, { window, document, crypto: { randomUUID }, TextEncoder, performance: { now: () => state.now } });
  const api = window.__geekTauriTranslation;
  const configuration = { generation, sessionGeneration: subscription, active: true, autoAfter: 1000,
    settings: { revision: 0, chats: {}, global: { ...defaultPolicy, ...policy } } };
  const configure = () => api.configure(structuredClone(configuration));
  if (api) configure();
  const poll = () => JSON.parse(JSON.stringify(api.poll(generation)));
  const add = ({ id = randomUUID(), text = 'Please send 100 units tomorrow.', fromMe = false, sentAt = 1001, known = true } = {}) => {
    const root = new Element('article'); root.setAttribute('data-testid', 'conv-msg-0'); root.setAttribute('data-id', id);
    const node = new Element('div'); node.setAttribute('data-pre-plain-text', '[12:00] Synthetic:');
    const span = new Element('span'); span.textContent = text; node.append(span); root.append(node); main.append(root);
    if (known) messages.set(id, { id: { remote: state.chatId, fromMe }, t: sentAt });
    return { root, node, span, box: () => root.querySelector('.geek-translation-result') };
  };
  const deliver = (request, result) => api.deliver(generation, subscription, 0, request.id, request.attempt, result);
  const rightClick = (row) => {
    document.fire('contextmenu', { target: row.node, clientX: 10, clientY: 10 });
    return document.body.children.find((node) => node.id === 'geek-translation-menu')?.children[0];
  };
  return { api, state, document, main, add, configuration, configure, poll, deliver, rightClick };
}
