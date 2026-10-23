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
    dismissed: false, lastIssue: null, reviewRequired: false, attachments: [], ...structuredClone(overrides) };
}

export function attachment(number = 1, overrides = {}) {
  return { id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`, name: `图片 ${number}.png`,
    size: 1024, mime: 'image/png', kind: 'image', ...structuredClone(overrides) };
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
  const attachmentRefs = new Map();
  const importedCatalogs = new Map();
  const catalogLeases = new Map();
  const publish = (next) => { backend = { ...backend, ...structuredClone(next) }; };
  async function invoke(name, value) {
    calls.push([name, structuredClone(value)]);
    const override = await before(name, value);
    if (override !== undefined) {
      if (name === 'pick' && Array.isArray(override?.attachments)) for (const file of override.attachments) {
        attachmentRefs.set(`${value}:${file?.id}`, structuredClone(file));
      }
      if (name === 'import' && override?.accountId === value.accountId && override.catalog?.accountId === value.accountId) {
        importedCatalogs.set(value.accountId, structuredClone(override.catalog));
        catalogLeases.set(`${value.accountId}:${override.catalog.catalogId}`, structuredClone(override.catalog));
      }
      if (name === 'catalog' && override?.accountId === value) catalogLeases.set(`${value}:${override.catalogId}`, structuredClone(override));
      return structuredClone(override);
    }
    if (failures.has(name)) throw 'STORE_IO';
    if (name === 'catalog') return structuredClone(importedCatalogs.get(value) || catalog(value, accountCatalogs[value]));
    if (name === 'snapshot') return structuredClone(backend);
    if (name === 'import') return null;
    if (name === 'export') return { ...value, revision: backend.revision, rowCount: 1, saved: true };
    if (name === 'pick') return null;
    if (name === 'release') {
      for (const id of value.attachmentIds) {
        if (!backend.jobs.some((item) => item.accountId === value.accountId && item.attachments?.some((file) => file.id === id))) {
          attachmentRefs.delete(`${value.accountId}:${id}`);
        }
      }
      return null;
    }
    if (name === 'create') {
      if (!backend.jobs.some((item) => item.id === value.id)) {
        const source = catalogLeases.get(`${value.accountId}:${value.catalogId}`) || catalog(value.accountId, accountCatalogs[value.accountId]);
        if (source.catalogId !== value.catalogId) throw 'BROADCAST_UNAVAILABLE';
        const targets = value.recipientIds.map((id) => {
          const target = source.chats.find((chat) => chat.id === id);
          if (!target) throw 'BROADCAST_INVALID';
          return target;
        });
        backend.jobs.push(job(value.id, value.accountId, { state: value.scheduledAt ? 'scheduled' : 'running',
          targets, total: value.recipientIds.length,
          message: value.message, scheduledAt: value.scheduledAt, createdAt: Date.now(),
          attachments: value.attachmentIds.map((id) => {
            const file = attachmentRefs.get(`${value.accountId}:${id}`);
            if (!file) throw 'BROADCAST_ATTACHMENT_UNAVAILABLE';
            return file;
          }) }));
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
    broadcastCreate: (draft) => invoke('create', draft), broadcastControl: (jobId, action) => invoke('control', { jobId, action }),
    broadcastPickAttachments: (accountId) => invoke('pick', accountId),
    broadcastReleaseAttachments: (accountId, attachmentIds) => invoke('release', { accountId, attachmentIds }),
    broadcastImportContacts: (accountId, catalogId) => invoke('import', { accountId, catalogId }),
    broadcastExportFailures: (accountId, jobId) => invoke('export', { accountId, jobId }) };
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
