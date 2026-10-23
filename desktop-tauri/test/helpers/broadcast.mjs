import { dom } from './dom.mjs';
import { createBroadcastController } from '../../frontend/controllers/broadcast.mjs';

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function catalog(accountId = 'a', overrides = {}) {
  return { accountId, accountName: accountId === 'a' ? 'Alice account' : 'Bob account', platformId: 'whatsapp',
    catalogId: `${accountId}-catalog`, ready: true, reasonCode: null,
    capabilities: { text: true, scheduled: true, vcards: true, tagAll: true, attachments: false },
    chats: [
      { id: `${accountId}-ann`, name: 'Ann', realName: 'Annie', kind: 'contact' },
      { id: `${accountId}-ben`, name: 'Ben', realName: '', kind: 'contact' },
      { id: `${accountId}-team`, name: 'Team', realName: '', kind: 'group' },
    ], ...structuredClone(overrides) };
}

export function job(id = 'job-a', accountId = 'a', overrides = {}) {
  return { id, accountId, accountName: accountId === 'a' ? 'Alice account' : 'Bob account', platformId: 'whatsapp',
    targets: catalog(accountId).chats, state: 'running', current: 0, total: 3, ok: 0, fail: 0, uncertain: 0,
    results: [], nextSendAt: null, scheduledAt: null, createdAt: 1000, updatedAt: 1000, finishedAt: null,
    dismissed: false, lastIssue: null, reviewRequired: false, ...structuredClone(overrides) };
}

// Events bubble for these controller/view behavior tests. Timers are manually
// advanced; selectors and markup still come from the actual prepare adapter.
function broadcastDom() {
  const ui = dom();
  const { document, window } = ui;
  const prototype = Object.getPrototypeOf(document);
  prototype.fire = function (type, properties = {}) {
    if (this.disabled && ['click', 'input', 'change', 'keydown'].includes(type)) return;
    let stopped = false;
    const event = { target: this, button: 0, preventDefault() {}, stopPropagation() { stopped = true; }, ...properties };
    let current = this;
    while (current) {
      event.currentTarget = current;
      for (const callback of current.listeners.get(type) || []) callback(event);
      if (stopped || type === 'focus') break;
      current = current.parentElement;
    }
  };
  const timers = new Map();
  let sequence = 0;
  let ids = 0;
  window.setTimeout = (fn) => { const id = ++sequence; timers.set(id, fn); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.crypto = { randomUUID: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` };
  return { ...ui, timers };
}

export async function fixture({ initialJobs = [], accountCatalogs = {}, before = async () => {}, layoutBefore = async () => {}, state = {} } = {}) {
  const ui = broadcastDom();
  const shell = { activeId: 'a', openedIds: ['a', 'b'], accounts: [
    { id: 'a', name: 'Alice account', platformId: 'whatsapp', archived: false },
    { id: 'b', name: 'Bob account', platformId: 'whatsapp-pure', archived: false },
    { id: 'tg', name: 'Telegram', platformId: 'telegram-z', archived: false },
  ], ...structuredClone(state) };
  const calls = [];
  const failures = new Set();
  let backend = { revision: 1, jobs: structuredClone(initialJobs) };
  let panel = null;
  let controller;
  let layouts = 0;
  const publish = (next) => { backend = { ...backend, ...structuredClone(next) }; };
  async function invoke(name, value) {
    calls.push([name, structuredClone(value)]);
    const override = await before(name, value);
    if (override !== undefined) return structuredClone(override);
    if (failures.has(name)) throw 'STORE_IO';
    if (name === 'catalog') return catalog(value, accountCatalogs[value]);
    if (name === 'snapshot') return structuredClone(backend);
    if (name === 'create') {
      if (!backend.jobs.some((item) => item.id === value.id)) {
        const chats = catalog(value.accountId, accountCatalogs[value.accountId]).chats;
        backend.jobs.push(job(value.id, value.accountId, { state: value.scheduledAt ? 'scheduled' : 'running',
          targets: value.recipientIds.map((id) => chats.find((chat) => chat.id === id)), total: value.recipientIds.length,
          message: value.message, scheduledAt: value.scheduledAt, createdAt: Date.now() }));
        backend.revision += 1;
      }
      return { jobId: value.id, snapshot: structuredClone(backend) };
    }
    if (name === 'control') {
      const target = backend.jobs.find((item) => item.id === value.jobId);
      if (value.action === 'dismiss') target.dismissed = true;
      else target.state = { pause: 'paused', resume: 'running', stop: 'stopped' }[value.action];
      if (value.action === 'resume') target.reviewRequired = false;
      backend.revision += 1;
      return structuredClone(backend);
    }
    throw new Error('Unhandled test operation');
  }
  const api = { broadcastCatalog: (id) => invoke('catalog', id), broadcastSnapshot: () => invoke('snapshot', null),
    broadcastCreate: (draft) => invoke('create', draft), broadcastControl: (jobId, action) => invoke('control', { jobId, action }) };
  async function showPanel(id, fill, focusId) {
    if (panel) ui.get(panel).classList.add('hidden');
    panel = id; fill?.(); ui.get(id).classList.remove('hidden'); controller?.panelChanged(id);
    if (focusId) ui.get(focusId).focus();
  }
  async function hidePanel() {
    if (panel) ui.get(panel).classList.add('hidden');
    panel = null; controller?.panelChanged(null);
  }
  controller = createBroadcastController({ ...ui, api, getShellSnapshot: () => shell,
    showPanel, hidePanel, requestLayout: async () => { layouts += 1; await layoutBefore(); } });
  controller.renderShell(shell);
  await controller.idle();
  const click = async (id) => { ui.get(id).fire('click'); await controller.idle(); };
  const fire = async (node, type, event) => { node.fire(type, event); await controller.idle(); };
  const tick = async () => {
    const callbacks = [...ui.timers.values()]; ui.timers.clear();
    callbacks.forEach((fn) => fn()); await controller.idle();
  };
  const select = async (id) => {
    const input = ui.get('broadcast-list').querySelectorAll('input').find((node) => node.value === id);
    if (!input) throw new Error(`Recipient not visible: ${id}`);
    input.checked = true; await fire(input, 'change');
  };
  const input = async (id, value, event = 'input') => {
    const node = ui.get(id);
    if (typeof value === 'boolean') node.checked = value; else node.value = value;
    await fire(node, event);
  };
  return { ...ui, controller, shell, calls, failures, click, fire, input, select, tick, publish, showPanel, hidePanel,
    open: async () => { await click('btn-broadcast'); await click('bc-menu-send'); },
    switchAccount(id) { shell.activeId = id; controller.renderShell(shell); },
    get panel() { return panel; }, get backend() { return backend; }, get layouts() { return layouts; } };
}
