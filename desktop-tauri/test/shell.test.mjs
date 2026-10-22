// Dependency-free DOM doubles exercise the actual app.mjs event wiring.
// This is not a WebView2 or authenticated-platform runtime test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function dom() {
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
  const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
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

async function settled(get) {
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!get('retry').disabled) return;
  }
  assert.fail('shell did not finish its queued operation');
}

test('actual shell wires search, owner-safe rename/archive/restore and durable settings feedback', async () => {
  const { get, document } = dom();
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const calls = [];
  const state = {
    accounts: [
      { id: 'a', name: 'Current A', platformId: 'whatsapp', archived: false },
      { id: 'b', name: '<img src=x onerror=evil()>', platformId: 'telegram-k', archived: false },
    ],
    platforms: [
      { id: 'whatsapp', name: 'WhatsApp', enabled: true },
      { id: 'telegram-k', name: 'Telegram K', enabled: true },
      { id: 'website', name: 'Website', enabled: true },
      { id: 'line', name: 'LINE', enabled: false },
    ],
    activeId: 'a', openedIds: ['a', 'b'], settings: { closeToTray: false }, trayAvailable: true,
  };
  let rejectArchive = false;
  async function invoke(command, args) {
    calls.push([command, structuredClone(args)]);
    if (command === 'account_rename') state.accounts.find((a) => a.id === args.id).name = args.name;
    if (command === 'account_close') {
      state.openedIds = state.openedIds.filter((id) => id !== args.id);
      if (state.activeId === args.id) state.activeId = null;
    }
    if (command === 'account_set_archived') {
      if (rejectArchive) throw 'STORE_IO';
      state.accounts.find((a) => a.id === args.id).archived = args.archived;
    }
    if (command === 'desktop_settings') {
      if (!state.trayAvailable && args.settings.closeToTray) throw 'TRAY_UNAVAILABLE';
      state.settings = args.settings;
    }
    return structuredClone(state);
  }
  globalThis.document = document;
  globalThis.window = { __TAURI__: { core: { invoke } }, addEventListener() {} };
  try {
    await import('../frontend/app.mjs?shell-unit');
    await settled(get);
    assert.equal(get('active-title').textContent, 'Current A');
    assert.equal(get('accounts').children[1].children[0].children[0].textContent, state.accounts[1].name);
    assert.equal(get('platform').children.find((p) => p.value === 'line').disabled, true);
    get('search').value = 'telegram';
    get('search').fire('input');
    assert.equal(get('accounts').children.length, 1);
    get('accounts').children[0].children[1].fire('click');
    get('edit-name').value = 'Renamed B';
    get('edit-form').fire('submit');
    await settled(get);
    assert.equal(state.accounts[1].name, 'Renamed B');
    assert.equal(state.accounts[0].name, 'Current A');
    assert.equal(state.activeId, 'a');

    // Settings refresh must not wipe an unsaved rename draft.
    get('edit-name').value = 'Unsaved draft';
    get('close-to-tray').checked = true;
    get('close-to-tray').fire('change');
    await settled(get);
    assert.equal(get('edit-name').value, 'Unsaved draft');
    assert.equal(state.settings.closeToTray, true);

    // A failed metadata commit after close keeps the account recoverable.
    rejectArchive = true;
    get('archive').fire('click');
    await settled(get);
    assert.equal(state.accounts[1].archived, false);
    assert.equal(state.activeId, 'a');
    assert.equal(get('editor').hidden, false);
    rejectArchive = false;
    get('archive').fire('click');
    await settled(get);
    assert.equal(state.accounts[1].archived, true);
    assert.equal(state.accounts[0].archived, false);
    assert.equal(state.activeId, 'a');
    assert.deepEqual(calls.filter(([name]) => name === 'account_set_archived').at(-1),
      ['account_set_archived', { id: 'b', archived: true }]);
    get('search').value = '';
    get('archived-only').checked = true;
    get('archived-only').fire('change');
    const archivedRow = get('accounts').children[0];
    assert.equal(archivedRow.children[0].disabled, true);
    archivedRow.children[1].fire('click');
    get('archive').fire('click');
    await settled(get);
    assert.equal(state.accounts[1].archived, false);
    assert.equal(state.openedIds.includes('b'), false);
    assert.equal(get('accounts').children.length, 0);

    state.trayAvailable = false;
    state.settings.closeToTray = false;
    get('retry').fire('click');
    await settled(get);
    get('close-to-tray').checked = true;
    get('close-to-tray').fire('change');
    await settled(get);
    assert.equal(get('close-to-tray').checked, false);
    assert.match(get('status').textContent, /托盘不可用/);
    get('platform').value = 'website';
    get('platform').fire('change');
    assert.equal(get('website-field').hidden, false);
    assert.equal(get('website-url').required, true);
    get('platform').value = 'whatsapp';
    get('platform').fire('change');
    assert.equal(get('website-url').disabled, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
