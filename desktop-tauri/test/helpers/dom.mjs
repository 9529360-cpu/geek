// Small offline DOM double for behavior tests; browser rendering is checked separately.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compose } = createRequire(import.meta.url)('../../scripts/prepare-frontend.cjs');
const decode = (s) => s.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function dom() {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toLowerCase();
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.disabled = false;
      this.hidden = false;
      this.checked = false;
      this._value = '';
      this._text = '';
      this.parentElement = null;
      if (tag === 'template') this.content = new Element('fragment');
      this.classList = {
        contains: (s) => this.className.split(/\s+/).includes(s),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].join(' ').trim(); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter((n) => !names.includes(n)).join(' '); },
        toggle: (s, force) => {
          const yes = force ?? !this.classList.contains(s);
          if (yes) this.classList.add(s); else this.classList.remove(s);
          return yes;
        },
      };
    }
    get id() { return this.attributes.get('id') || ''; }
    set id(s) { this.attributes.set('id', s); }
    get className() { return this.attributes.get('class') || ''; }
    set className(s) { this.attributes.set('class', s); }
    get value() { return this._value || (this.tagName === 'select' ? this.options.find((o) => !o.disabled)?.value || '' : ''); }
    set value(v) { this._value = String(v); }
    get options() { return this.children.filter((e) => e.tagName === 'option'); }
    get firstElementChild() { return this.children[0]; }
    get lastElementChild() { return this.children.at(-1); }
    get textContent() { return this._text + this.children.map((e) => e.textContent).join(''); }
    set textContent(s) { this._text = String(s); this.replaceChildren(); }
    append(...items) {
      for (const item of items) {
        if (item.tagName === 'fragment') { this.append(...item.children.slice()); continue; }
        if (item.parentElement) item.parentElement.children = item.parentElement.children.filter((n) => n !== item);
        item.parentElement = this;
        this.children.push(item);
      }
    }
    replaceChildren(...items) { for (const e of this.children) e.parentElement = null; this.children = []; this.append(...items); }
    before(item) {
      if (item.tagName === 'fragment') { for (const child of item.children.slice()) this.before(child); return; }
      const list = this.parentElement.children;
      list.splice(list.indexOf(this), 0, item); item.parentElement = this.parentElement;
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'value') this.value = v;
      if (['disabled', 'hidden', 'checked'].includes(k)) this[k] = true;
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    addEventListener(k, callback) { const list = this.listeners.get(k) || []; list.push(callback); this.listeners.set(k, list); }
    fire(k, event = {}) {
      if (this.disabled) return;
      const e = { target: this, button: 0, preventDefault() {}, ...event };
      for (const callback of this.listeners.get(k) || []) callback(e);
    }
    focus() { document.activeElement = this; }
    matches(selector) {
      return selector.split(',').some((part) => {
        const s = part.trim();
        if (s.startsWith('#')) return this.id === s.slice(1);
        if (s.startsWith('.')) return s.slice(1).split('.').every((c) => this.classList.contains(c));
        return this.tagName === s;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(target) { return target === this || this.children.some((c) => c.contains(target)); }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    cloneNode(deep) {
      const e = new Element(this.tagName);
      for (const [k, v] of this.attributes) e.setAttribute(k, v);
      e._text = this._text; e._value = this._value;
      if (deep) for (const c of this.children) e.append(c.cloneNode(true));
      if (this.content && deep) e.content = this.content.cloneNode(true);
      return e;
    }
    getBoundingClientRect() {
      const nav = document.getElementById('side-nav');
      const x = nav?.classList.contains('collapsed') ? 64 : nav?.classList.contains('compact') ? 176 : 200;
      return { x, y: 35, width: 960 - x, height: 605, top: 35, right: 960 };
    }
    getClientRects() { return this.hidden || this.classList.contains('hidden') ? [] : [this.getBoundingClientRect()]; }
  }
  document = new Element('document');
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const stack = [document];
  const html = compose().html.replace(/<!--[\s\S]*?-->/g, '');
  for (const token of html.match(/<[^>]+>|[^<]+/g)) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
    const [, tag, attributes] = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/) || [];
    if (!tag) continue;
    const e = new Element(tag);
    for (const [, name, double, single, bare] of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      e.setAttribute(name, decode(double ?? single ?? bare ?? ''));
    }
    stack.at(-1).append(e);
    if (!['meta', 'link', 'input', 'br', 'hr', 'img', 'source'].includes(tag) && !token.endsWith('/>')) stack.push(e.content || e);
  }
  const window = { innerWidth: 960, innerHeight: 640, addEventListener() {}, setTimeout: (fn) => { fn(); return 0; } };
  return { document, window, get: document.getElementById };
}

export async function settled(get) {
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!get('btn-app-center').disabled) return;
  }
  assert.fail('shell did not finish its queued operation');
}
