'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'contact-notes.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'contact-notes.css'), 'utf8');

class FakeClassList {
  constructor(...initial) { this.values = new Set(initial); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.dataset = {};
    this.disabled = false;
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.focusCount = 0;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  async emit(type, event = {}) {
    const evt = { target: this, stopPropagation() {}, preventDefault() {}, ...event };
    const results = [];
    for (const handler of this.listeners.get(type) || []) results.push(handler(evt));
    return Promise.all(results);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  contains(target) { return target === this; }
  focus() { this.focusCount += 1; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(contextOrGetter) {
  const ids = [
    'btn-contact-notes', 'contact-notes-popover', 'contact-notes-close', 'contact-notes-chat',
    'contact-notes-name', 'contact-notes-country', 'contact-notes-source', 'contact-notes-follow-status',
    'contact-notes-next-follow-up', 'contact-notes-text', 'contact-notes-count', 'contact-notes-save',
    'contact-notes-delete', 'contact-notes-status',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements['contact-notes-popover'].classList.add('hidden');

  const documentListeners = new Map();
  const document = {
    getElementById(id) { return elements[id] || null; },
    addEventListener(type, handler) {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
  };
  const sandbox = {
    window: {}, globalThis: {}, document, encodeURIComponent, Date,
    setInterval() { return 1; }, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'contact-notes.js' });
  const notes = sandbox.window.GeekContactNotes;
  assert.ok(notes, 'Contact Notes module must load');

  const controller = notes.create({
    getContext: async () => {
      if (typeof contextOrGetter === 'function') return contextOrGetter();
      return { ...contextOrGetter };
    },
    getStorage: () => '',
    setStorage: async () => true,
    removeStorage: async () => true,
  });
  controller.bind();

  return {
    elements,
    async emitDocument(type, event) {
      for (const handler of documentListeners.get(type) || []) await handler(event);
    },
  };
}

(async () => {
  {
    const harness = createHarness({ accountId: 'account-1', family: 'whatsapp', chatId: 'A@c.us' });
    const button = harness.elements['btn-contact-notes'];
    const popover = harness.elements['contact-notes-popover'];
    const name = harness.elements['contact-notes-name'];

    assert.equal(button.attributes['aria-controls'], 'contact-notes-popover', 'trigger must identify its controlled dialog');
    assert.equal(button.attributes['aria-haspopup'], 'dialog', 'trigger must expose dialog popup semantics');
    assert.equal(popover.attributes['aria-hidden'], 'true', 'closed dialog must begin aria-hidden');

    await button.emit('click');
    assert.equal(popover.classList.contains('hidden'), false, 'trigger must open Contact Notes');
    assert.equal(button.attributes['aria-expanded'], 'true');
    assert.equal(popover.attributes['aria-hidden'], 'false');
    assert.equal(name.focusCount, 1, 'active-chat open must focus the first enabled field');

    let prevented = false;
    let stopped = false;
    await popover.emit('keydown', {
      key: 'Escape',
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    assert.equal(prevented, true, 'Escape must be consumed by the open Contact Notes dialog');
    assert.equal(stopped, true, 'Escape must not leak to the shell after closing Contact Notes');
    assert.equal(popover.classList.contains('hidden'), true);
    assert.equal(button.attributes['aria-expanded'], 'false');
    assert.equal(popover.attributes['aria-hidden'], 'true');
    assert.equal(button.focusCount, 1, 'Escape close must restore focus to the trigger');
  }

  {
    const harness = createHarness({ accountId: 'account-1', family: 'whatsapp', chatId: '' });
    const button = harness.elements['btn-contact-notes'];
    await button.emit('click');
    assert.equal(harness.elements['contact-notes-name'].disabled, true, 'no-chat state must keep fields disabled');
    assert.equal(harness.elements['contact-notes-name'].focusCount, 0, 'disabled first field must not be the focus target');
    assert.equal(harness.elements['contact-notes-close'].focusCount, 1, 'no-chat state must focus the usable close control');
  }

  {
    const harness = createHarness({ accountId: 'account-1', family: 'whatsapp', chatId: 'B@c.us' });
    const button = harness.elements['btn-contact-notes'];
    const close = harness.elements['contact-notes-close'];
    await button.emit('click');
    await close.emit('click');
    assert.equal(button.focusCount, 1, 'explicit close must restore focus to the trigger');
  }

  {
    const harness = createHarness({ accountId: 'account-1', family: 'whatsapp', chatId: 'C@c.us' });
    const button = harness.elements['btn-contact-notes'];
    const popover = harness.elements['contact-notes-popover'];
    await button.emit('click');
    await harness.emitDocument('click', { target: { id: 'another-shell-control' } });
    assert.equal(popover.classList.contains('hidden'), true, 'outside click must still dismiss Contact Notes');
    assert.equal(button.focusCount, 0, 'outside-click dismissal must not steal focus from the newly clicked control');
  }

  {
    const context = deferred();
    const harness = createHarness(() => context.promise);
    const button = harness.elements['btn-contact-notes'];
    const popover = harness.elements['contact-notes-popover'];
    const close = harness.elements['contact-notes-close'];
    const name = harness.elements['contact-notes-name'];

    const opening = button.emit('click');
    assert.equal(popover.classList.contains('hidden'), false, 'dialog becomes visible before async context refresh completes');
    await close.emit('click');
    context.resolve({ accountId: 'account-1', family: 'whatsapp', chatId: 'D@c.us' });
    await opening;

    assert.equal(popover.classList.contains('hidden'), true, 'close during refresh must remain closed after refresh resolves');
    assert.equal(name.focusCount, 0, 'stale open completion must not focus a field inside the hidden dialog');
    assert.equal(button.focusCount, 1, 'close during refresh must retain the explicit focus return');
  }

  assert.match(source, /await refresh\(\);\s*if \(!popover\.classList\.contains\('hidden'\)\) focusInitialControl\(\);/, 'async open completion must check current visibility before moving focus');
  assert.match(css, /max-height:\s*min\(720px,\s*calc\(100vh - 58px\)\)/, 'Contact Notes must be bounded to the visible window');
  assert.match(css, /overflow-y:\s*auto/, 'Contact Notes must own vertical overflow on short windows');
  assert.match(css, /\.contact-notes-head\s*\{[\s\S]*?position:\s*sticky;/, 'Contact Notes heading and close affordance must remain visible while scrolling');
  assert.match(css, /\.contact-notes-save\s*\{[^}]*background:\s*var\(--accent\);/, 'primary save action must use the product accent token');
  assert.match(css, /\.contact-notes-close:focus-visible,[\s\S]*?outline:\s*2px solid var\(--accent\);/, 'dialog actions must expose a visible keyboard focus ring');

  console.log('CONTACT_NOTES_DIALOG_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
