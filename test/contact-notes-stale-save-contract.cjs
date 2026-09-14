'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'contact-notes.js'), 'utf8');

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
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  async emit(type, event = {}) {
    const evt = { target: this, stopPropagation() {}, ...event };
    const results = [];
    for (const handler of this.listeners.get(type) || []) results.push(handler(evt));
    return Promise.all(results);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  contains(target) { return target === this; }
  focus() { this.focused = true; }
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

function createHarness({ initialRaw = '' } = {}) {
  const ids = [
    'btn-contact-notes', 'contact-notes-popover', 'contact-notes-close', 'contact-notes-chat',
    'contact-notes-name', 'contact-notes-country', 'contact-notes-source', 'contact-notes-follow-status',
    'contact-notes-next-follow-up', 'contact-notes-text', 'contact-notes-count', 'contact-notes-save',
    'contact-notes-delete', 'contact-notes-status',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements['contact-notes-popover'].classList.add('hidden');

  const document = {
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
  };
  const sandbox = {
    window: {}, globalThis: {}, document, encodeURIComponent, Date,
    setInterval() { return 1; }, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'contact-notes.js' });
  const notes = sandbox.window.GeekContactNotes;
  assert.ok(notes, 'Contact Notes module must load in the UI harness');

  let currentContext = { accountId: 'account-1', family: 'whatsapp', chatId: 'A@c.us' };
  let storageRaw = initialRaw;
  let pendingWrite = null;

  async function commitOptimistically(nextRaw) {
    const previous = storageRaw;
    storageRaw = nextRaw;
    if (!pendingWrite) return true;
    const gate = pendingWrite;
    pendingWrite = null;
    const ok = await gate.promise;
    if (ok === false) storageRaw = previous;
    return ok;
  }

  const controller = notes.create({
    getContext: async () => ({ ...currentContext }),
    getStorage: () => storageRaw,
    setStorage: raw => commitOptimistically(String(raw)),
    removeStorage: () => commitOptimistically(''),
  });
  controller.bind();

  return {
    notes, controller, elements,
    setContext(context) { currentContext = { ...context }; },
    setPendingWrite(gate) { pendingWrite = gate; },
    getStorage() { return storageRaw; },
  };
}

function setDraft(harness, { name = '', notes = '' } = {}) {
  harness.elements['contact-notes-name'].value = name;
  harness.elements['contact-notes-text'].value = notes;
}

(async () => {
  // A successful save may complete durably after the user has moved to B, but it must not repaint B.
  {
    const harness = createHarness();
    await harness.controller.refresh();
    setDraft(harness, { name: 'Alice', notes: 'A durable note' });
    const write = deferred();
    harness.setPendingWrite(write);
    const savePromise = harness.elements['contact-notes-save'].emit('click');

    harness.setContext({ accountId: 'account-1', family: 'whatsapp', chatId: 'B@c.us' });
    await harness.controller.refresh();
    setDraft(harness, { name: 'Bob draft', notes: 'B unsaved draft' });
    const summaryBefore = harness.elements['contact-notes-chat'].textContent;
    const statusBefore = harness.elements['contact-notes-status'].textContent;

    write.resolve(true);
    await savePromise;

    assert.equal(harness.elements['contact-notes-name'].value, 'Bob draft', 'late A success must not overwrite B name draft');
    assert.equal(harness.elements['contact-notes-text'].value, 'B unsaved draft', 'late A success must not overwrite B note draft');
    assert.equal(harness.elements['contact-notes-chat'].textContent, summaryBefore, 'late A success must not repaint B summary');
    assert.equal(harness.elements['contact-notes-status'].textContent, statusBefore, 'late A success must not paint success into B');
    const stored = harness.notes.parseStore(harness.getStorage());
    const a = harness.notes.normalizeIdentity('whatsapp', 'A@c.us');
    assert.equal(stored.items[a.key].name, 'Alice', 'stale UI completion must not cancel the durable A save');
  }

  // A failed old-context write is likewise silent in the new context.
  {
    const harness = createHarness();
    await harness.controller.refresh();
    setDraft(harness, { name: 'Alice', notes: 'will fail' });
    const write = deferred();
    harness.setPendingWrite(write);
    const savePromise = harness.elements['contact-notes-save'].emit('click');

    harness.setContext({ accountId: 'account-1', family: 'whatsapp', chatId: 'B@c.us' });
    await harness.controller.refresh();
    setDraft(harness, { name: 'Bob draft', notes: 'keep me' });
    const summaryBefore = harness.elements['contact-notes-chat'].textContent;
    const statusBefore = harness.elements['contact-notes-status'].textContent;

    write.resolve(false);
    await savePromise;

    assert.equal(harness.elements['contact-notes-name'].value, 'Bob draft');
    assert.equal(harness.elements['contact-notes-text'].value, 'keep me');
    assert.equal(harness.elements['contact-notes-chat'].textContent, summaryBefore);
    assert.equal(harness.elements['contact-notes-status'].textContent, statusBefore, 'late A failure must not paint an error into B');
  }

  // Returning A -> B -> A still advances ownership generation, so the old A completion cannot clobber a new A draft.
  {
    const harness = createHarness();
    await harness.controller.refresh();
    setDraft(harness, { name: 'Old A', notes: 'old A save' });
    const write = deferred();
    harness.setPendingWrite(write);
    const savePromise = harness.elements['contact-notes-save'].emit('click');

    harness.setContext({ accountId: 'account-1', family: 'whatsapp', chatId: 'B@c.us' });
    await harness.controller.refresh();
    harness.setContext({ accountId: 'account-1', family: 'whatsapp', chatId: 'A@c.us' });
    await harness.controller.refresh();
    setDraft(harness, { name: 'New A draft', notes: 'newer unsaved work' });

    write.resolve(true);
    await savePromise;

    assert.equal(harness.elements['contact-notes-name'].value, 'New A draft', 'context generation must reject an old A completion after A -> B -> A');
    assert.equal(harness.elements['contact-notes-text'].value, 'newer unsaved work');
  }

  // Delete uses the same completion ownership rule; a late delete must not report success on B.
  {
    const seed = createHarness();
    const identity = seed.notes.normalizeIdentity('whatsapp', 'A@c.us');
    const raw = JSON.stringify(seed.notes.updateStore('', identity, { name: 'Alice', notes: 'delete me' }, 1));
    const harness = createHarness({ initialRaw: raw });
    await harness.controller.refresh();
    const write = deferred();
    harness.setPendingWrite(write);
    const deletePromise = harness.elements['contact-notes-delete'].emit('click');

    harness.setContext({ accountId: 'account-1', family: 'whatsapp', chatId: 'B@c.us' });
    await harness.controller.refresh();
    setDraft(harness, { name: 'Bob draft', notes: 'B stays' });
    const statusBefore = harness.elements['contact-notes-status'].textContent;

    write.resolve(true);
    await deletePromise;

    assert.equal(harness.elements['contact-notes-name'].value, 'Bob draft');
    assert.equal(harness.elements['contact-notes-text'].value, 'B stays');
    assert.equal(harness.elements['contact-notes-status'].textContent, statusBefore, 'late delete must not announce deletion in B');
  }

  // Same-context completion keeps the existing normalized form + success feedback behavior.
  {
    const harness = createHarness();
    await harness.controller.refresh();
    setDraft(harness, { name: '  Alice  ', notes: '  normalized note  ' });
    await harness.elements['contact-notes-save'].emit('click');

    assert.equal(harness.elements['contact-notes-name'].value, 'Alice');
    assert.equal(harness.elements['contact-notes-text'].value, 'normalized note');
    assert.match(harness.elements['contact-notes-chat'].textContent, /Alice/);
    assert.equal(harness.elements['contact-notes-status'].textContent, '客户资料已保存');
    assert.equal(harness.elements['contact-notes-status'].dataset.state, 'success');
  }

  assert.match(source, /let contextGeneration = 0;/, 'Contact Notes must track context generations');
  assert.match(source, /const ownerIdentity = identity;[\s\S]*const ownerToken = contextToken;[\s\S]*const ownerGeneration = contextGeneration;/, 'save must capture its originating identity/token/generation');
  assert.match(source, /if \(!isCurrentContext\(ownerToken, ownerGeneration\)\) return true;/, 'successful stale saves must remain durable but skip UI repaint');
  assert.match(source, /if \(isCurrentContext\(ownerToken, ownerGeneration\)\) setStatus\(error\.message \|\| '保存失败', 'error'\)/, 'stale failures must not paint errors into a new context');

  console.log('CONTACT_NOTES_STALE_SAVE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
