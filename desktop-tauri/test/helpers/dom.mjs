import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function dom() {
  const elements = [];
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.listeners = new Map();
      this.attributes = new Map();
      this.disabled = false;
      this.hidden = false;
      this.checked = false;
      this._value = '';
      this.textContent = '';
      elements.push(this);
    }
    get value() { return this._value || (this.tagName === 'select' ? this.children.find((e) => !e.disabled)?.value || '' : ''); }
    set value(v) { this._value = v; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; if (this.tagName === 'select') this._value = ''; }
    setAttribute(k, v) { this.attributes.set(k, v); }
    addEventListener(k, callback) { this.listeners.set(k, callback); }
    fire(k) { if (!this.disabled) this.listeners.get(k)?.({ preventDefault() {} }); }
    focus() {}
    scrollIntoView() {}
  }
  const ids = new Map();
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  for (const [, tag, attrs, id, rest] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g)) {
    const e = new Element(tag);
    e.disabled = /\bdisabled\b/.test(attrs + rest);
    e.hidden = /\bhidden\b/.test(attrs + rest);
    ids.set(id, e);
  }
  return {
    get: (id) => ids.get(id),
    document: {
      getElementById: (id) => ids.get(id),
      createElement: (tag) => new Element(tag),
      querySelectorAll: (selector) => elements.filter((e) => selector.split(',').map((s) => s.trim()).includes(e.tagName)),
    },
  };
}

export async function settled(get) {
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!get('retry').disabled) return;
  }
  assert.fail('shell did not finish its queued operation');
}

