// Composes production code, with source-derived A/K trees and an offline DOM boundary.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { dom } from './dom.mjs';
import { generation, subscription, defaultPolicy } from './translation-guest.mjs';
const { composeTranslation } = createRequire(import.meta.url)('../../scripts/prepare-translation.cjs');

function guestDom() {
  const { document } = dom();
  const prototype = Object.getPrototypeOf(document);
  const observers = new Set();
  const record = (type, target, addedNodes = [], removedNodes = []) => {
    for (const observer of observers) observer.records.push({ type, target, addedNodes, removedNodes });
  };
  const text = Object.getOwnPropertyDescriptor(prototype, 'textContent');
  Object.defineProperties(prototype, {
    nodeType: { get() { return 1; } },
    isConnected: { get() { return this === document || Boolean(this.parentElement?.isConnected); } },
    childNodes: { get() { return [...(this._text ? [{ nodeType: 3, textContent: this._text, parentElement: this }] : []), ...this.children]; } },
    textContent: { get: text.get, set(value) { text.set.call(this, value); record('characterData', this); } },
  });
  const simple = (node, selector) => {
    const tag = selector.match(/^[\w-]+/);
    if (tag && node.tagName !== tag[0].toLowerCase()) return false;
    const id = selector.match(/#([\w-]+)/);
    if (id && node.id !== id[1]) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(match[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!node.hasAttribute(match[1]) || (match[2] !== undefined && node.getAttribute(match[1]) !== match[2])) return false;
    }
    return true;
  };
  prototype.matches = function (selector) {
    return selector.split(',').some((part) => {
      const pieces = part.trim().replace(/>/g, ' > ').split(/\s+/);
      const check = (node, index) => {
        if (!node || !simple(node, pieces[index])) return false;
        if (!index) return true;
        if (pieces[index - 1] === '>') return check(node.parentElement, index - 2);
        for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) if (check(ancestor, index - 1)) return true;
        return false;
      };
      return check(this, pieces.length - 1);
    });
  };
  prototype.getBoundingClientRect = function () {
    if (this.hidden || this.closest('[hidden],[aria-hidden="true"]')) return { width: 0, height: 0 };
    return { x: 20, y: 20, width: 500, height: 80, top: 20, bottom: 100, left: 20, right: 520 };
  };
  for (const name of ['append', 'after', 'before']) {
    const original = prototype[name];
    prototype[name] = function (...items) {
      original.apply(this, items); record('childList', name === 'append' ? this : this.parentElement, items); return this;
    };
  }
  const remove = prototype.remove;
  prototype.remove = function () { const parent = this.parentElement; remove.call(this); if (parent) record('childList', parent, [], [this]); };
  const attribute = prototype.setAttribute;
  prototype.setAttribute = function (key, value) { attribute.call(this, key, value); record('attributes', this); };
  prototype.replaceWith = function (node) { this.before(node); this.remove(); };
  const fire = prototype.fire;
  prototype.fire = function (type, event = {}) { return fire.call(this, type, { isTrusted: true, ...event }); };
  document.documentElement = document.querySelector('html');
  document.visibilityState = 'visible'; document.body.replaceChildren();
  document.addEventListener = prototype.addEventListener;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe() { observers.add(this); }
    takeRecords() { return this.records.splice(0); }
  }
  return { document, MutationObserver };
}

export function telegramGuest(variant = 'a', { policy = {}, peer = '123', iframe = false } = {}) {
  const { document, MutationObserver } = guestDom();
  const isA = variant === 'a';
  const make = (tag, className = '', text = '') => {
    const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
  };
  const outer = make('div', isA ? '' : 'chat');
  if (isA) outer.id = 'MiddleColumn'; else outer.setAttribute('data-type', 'chat');
  const header = make('div', 'MiddleHeader'); const chatInfo = make('div', 'ChatInfo');
  const avatar = make('div', 'Avatar'); avatar.setAttribute('data-peer-id', peer);
  chatInfo.append(avatar); header.append(chatInfo); if (isA) outer.append(header);
  let list = make('div', isA ? 'MessageList' : 'bubbles-inner'); outer.append(list); document.body.append(outer);
  const state = { now: 0, unix: 1001 };
  const listeners = new Map();
  const window = { innerWidth: 960, innerHeight: 640, location: new URL(`https://web.telegram.org/${variant}/#${peer}`),
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); } };
  window.top = iframe ? {} : window;
  class ClockDate extends Date { static now() { return state.unix * 1000; } }
  runInNewContext(composeTranslation(), { window, document, MutationObserver, crypto: { randomUUID }, TextEncoder,
    Date: ClockDate, performance: { now: () => state.now } });
  const api = window.__geekTauriTranslation;
  const configuration = { generation, platformId: isA ? 'telegram-z' : 'telegram-k', sessionGeneration: subscription,
    active: true, autoAfter: 1000, settings: { revision: 0, chats: {}, global: { ...defaultPolicy, ...policy } } };
  const configure = () => api?.configure(structuredClone(configuration)); configure();
  const poll = () => JSON.parse(JSON.stringify(api.poll(generation)));
  let nextId = 10;
  function add({ id = String(++nextId), text = 'Please send 100 units tomorrow.', quote = false, meta = '12:04',
    rowPeer = window.location.hash.slice(1), media = false, hidden = false, timestamp = '1001', outgoing = false } = {}) {
    const root = make('div', isA ? 'Message message-list-item' : `bubble ${outgoing ? 'is-out' : 'is-in'}`);
    if (isA) { root.id = `message-${id}`; root.setAttribute('data-message-id', id); }
    else {
      root.setAttribute('data-mid', id); root.setAttribute('data-peer-id', rowPeer);
      root.setAttribute('data-timestamp', timestamp); root.setAttribute('role', 'article');
    }
    const wrapper = make('div', isA ? 'message-content-wrapper' : 'bubble-content-wrapper'); root.append(wrapper);
    const content = make('div', isA ? 'message-content text' : 'bubble-content'); wrapper.append(content);
    const inner = isA ? make('div', 'content-inner') : content; if (isA) content.append(inner);
    if (quote) inner.append(make('div', isA ? 'embedded-message' : 'reply', 'Quoted 900 units, never source.'));
    const node = make('div', isA ? 'text-content clearfix with-meta' : 'message spoilers-container');
    const body = make('span', '', text); node.append(body, make('span', isA ? 'MessageMeta' : 'time', meta));
    inner.append(node); if (media) inner.append(make('div', 'attachment', 'Photo caption'));
    root.hidden = hidden; list.append(root);
    return { root, node, body, box: () => root.querySelector('.geek-translation-result') };
  }
  const deliver = (request, result, revision = configuration.settings.revision) => api.deliver(generation, subscription,
    revision, request.id, request.attempt, result);
  const navigate = (next, { headerPeer = next } = {}) => {
    window.location.hash = next; avatar.setAttribute('data-peer-id', headerPeer);
    for (const listener of listeners.get('hashchange') || []) listener();
  };
  const replaceList = () => {
    const next = make('div', isA ? 'MessageList' : 'bubbles-inner'); list.replaceWith(next); list = next;
  };
  const rightClick = (row) => {
    document.fire('contextmenu', { target: row.body, clientX: 20, clientY: 20 });
    return document.getElementById('geek-translation-menu')?.firstElementChild;
  };
  return { api, state, document, window, get list() { return list; }, outer, avatar, make, add,
    configuration, configure, poll, deliver, navigate, replaceList, rightClick };
}
