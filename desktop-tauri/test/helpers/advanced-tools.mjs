import { dom } from './dom.mjs';
import { connectDesktop } from '../../frontend/api/desktop.mjs';
import { createAdvancedToolsController } from '../../frontend/controllers/advanced-tools.mjs';
import { mountShell } from '../../frontend/controller.mjs';
import { DEFAULT_POLICY } from '../../frontend/models/translation.mjs';

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const turn = () => new Promise((resolve) => setImmediate(resolve));

export function history(accountId = 'a', revision = 7) {
  return { accountId, revision, summary: { jobs: 2, total: 12, ok: 4, fail: 2, uncertain: 1, pending: 5 }, rows: [
    { jobId: 'scheduled', createdAt: 1700000100000, finishedAt: null, total: 4, ok: 0, fail: 0, uncertain: 0,
      pending: 4, attachments: 0, messageLength: 8, state: 'scheduled' },
    { jobId: 'paused', createdAt: 1700000000000, finishedAt: null, total: 8, ok: 4, fail: 2, uncertain: 1,
      pending: 1, attachments: 2, messageLength: 15, state: 'paused' },
  ] };
}
export function backup(accountId = 'a', data = {
  presets: { messages: [{ name: '问候', message: 'Hello synthetic' }], audiences: [] },
  translation: { global: { ...DEFAULT_POLICY, target: 'it' }, chats: {} },
}) {
  return { accountId, presetRevision: 3, translationRevision: 1, backup: { version: 3,
    account: { name: '备份账号', type: 'whatsapp' }, data: structuredClone(data),
    reportedUnsupported: ['savedGroups', 'gtAutoCfg'], ignoredKeys: ['sendHistory', 'scheduleTasks'] } };
}

export async function fixture({ before = async () => {}, layoutBefore = async () => {}, fullShell = false, missing = [] } = {}) {
  const ui = dom();
  const prototype = Object.getPrototypeOf(ui.document);
  prototype.fire = function (type, properties = {}) {
    if (this.disabled) return;
    let stopped = false;
    const event = { target: this, button: 0, preventDefault() {}, stopPropagation() { stopped = true; }, ...properties };
    for (let current = this; current; current = current.parentElement) {
      event.currentTarget = current;
      for (const callback of current.listeners.get(type) || []) callback(event);
      if (stopped) break;
    }
  };
  let timer = 0;
  const timers = new Map();
  ui.window.setTimeout = (callback) => { timers.set(++timer, callback); return timer; };
  ui.window.clearTimeout = (id) => timers.delete(id);
  ui.window.removeEventListener = () => {};
  const accounts = [
    { id: 'a', name: '客服甲', platformId: 'whatsapp' },
    { id: 'b', name: '客服乙', platformId: 'whatsapp-pure' },
    { id: 'other', name: '网站账号', platformId: 'website' },
  ].map((item) => ({ ...item, archived: false, proxy: { mode: 'system', host: '', port: null },
    fontSize: 16, fontColor: '#18A058', translation: { revision: 1, global: { ...DEFAULT_POLICY }, chats: {} } }));
  const backend = { activeId: 'a', accounts, openedIds: ['a', 'b', 'other'], settings: { closeToTray: false },
    platforms: ['whatsapp', 'whatsapp-pure', 'website'].map((id) => ({ id, name: id, enabled: true,
      family: id.startsWith('whatsapp') ? 'whatsapp' : id })) };
  let shell = structuredClone(backend);
  const presets = new Map(accounts.map((item) => [item.id, { revision: 3, messages: [],
    audiences: [{ name: '原标签', recipientIds: ['100@c.us'] }], excludedContactIds: ['101@c.us'], excludedGroupIds: ['200@g.us'] }]));
  const histories = new Map(accounts.map((item) => [item.id, history(item.id)]));
  const calls = []; const errors = []; const failures = new Map();
  let selectedBackup = backup();
  let panel = null;
  let controller;

  function restore(args, { failPresets = null, failTranslation = null } = {}) {
    const { accountId, expectedPresetRevision, expectedTranslationRevision, data } = args;
    const saved = presets.get(accountId); const target = backend.accounts.find((item) => item.id === accountId);
    if (data.presets && saved.revision !== expectedPresetRevision) throw 'BROADCAST_PRESET_CONFLICT';
    if (data.translation && target.translation.revision !== expectedTranslationRevision) throw 'TRANSLATION_SETTINGS_CONFLICT';
    const result = { accountId };
    for (const kind of ['presets', 'translation']) {
      const current = kind === 'presets' ? saved : target.translation;
      const failure = kind === 'presets' ? failPresets : failTranslation;
      let status = 'notAttempted';
      if (data[kind]) {
        if (failure) status = 'failed';
        else {
          const unchanged = Object.entries(data[kind]).every(([key, value]) => JSON.stringify(value) === JSON.stringify(current[key]));
          Object.assign(current, structuredClone(data[kind]));
          if (!unchanged) current.revision += 1;
          status = unchanged ? 'unchanged' : 'restored';
        }
      }
      result[kind] = { status, code: data[kind] ? failure : null, revision: current.revision };
    }
    return { ...result, snapshot: structuredClone(backend) };
  }

  const invoke = async (command, args) => {
    calls.push([command, structuredClone(args)]);
    const override = await before(command, args);
    if (override !== undefined) return structuredClone(override);
    if (failures.has(command)) throw failures.get(command);
    if (command === 'desktop_snapshot') return structuredClone(backend);
    if (command === 'desktop_layout') { await layoutBefore(args.viewport); return null; }
    if (command === 'desktop_window') return null;
    if (command === 'broadcast_snapshot') return { revision: 0, jobs: [] };
    if (command === 'session_snapshot') return { revision: 0, state: 'signedOut', user: null,
      remainingChars: null, quotaFresh: false, issue: null };
    if (command === 'account_activate') { backend.activeId = args.id; return structuredClone(backend); }
    if (command === 'broadcast_history') return structuredClone(histories.get(args.accountId));
    if (command === 'broadcast_export_contacts') return { accountId: args.accountId, revision: null, rowCount: 3, saved: true };
    if (command === 'broadcast_export_history') {
      const report = histories.get(args.accountId);
      if (args.expectedRevision !== report.revision) throw 'BROADCAST_STATE';
      return { accountId: args.accountId, revision: report.revision, rowCount: report.rows.length, saved: true };
    }
    if (command === 'account_export_backup') return { accountId: args.accountId, saved: true };
    if (command === 'account_pick_backup') return structuredClone(selectedBackup === null ? null : {
      ...selectedBackup, accountId: args.accountId, presetRevision: presets.get(args.accountId).revision,
      translationRevision: backend.accounts.find((item) => item.id === args.accountId).translation.revision,
    });
    if (command === 'account_restore_backup') return restore(args);
    throw new Error(`Unexpected synthetic command: ${command}`);
  };
  const api = Object.fromEntries(Object.entries(connectDesktop(invoke)).filter(([name]) => !missing.includes(name)));
  async function showPanel(id, fill, focusId, isCurrent = () => true) {
    await api.layout({ x: 200, y: 35, width: 760, height: 605, visible: false });
    if (!isCurrent()) return false;
    if (panel) ui.get(panel).classList.add('hidden');
    panel = id; fill?.(); ui.get(id).classList.remove('hidden'); controller?.panelChanged(id);
    if (focusId) ui.get(focusId).focus();
  }
  async function hidePanel() {
    if (panel) ui.get(panel).classList.add('hidden');
    panel = null; controller?.panelChanged(null);
    await api.layout({ x: 200, y: 35, width: 760, height: 605, visible: true });
  }
  const acceptSnapshot = (value, id) => {
    const update = value.accounts.find((item) => item.id === id)?.translation;
    shell = { ...shell, accounts: shell.accounts.map((item) => item.id === id && update.revision >= item.translation.revision
      ? { ...item, translation: update } : item) };
    controller.renderShell(shell);
  };
  controller = fullShell ? mountShell({ ...ui, api }) : createAdvancedToolsController({ ...ui, api, getShellSnapshot: () => shell,
    showPanel, hidePanel, acceptSnapshot, reportError: (message) => errors.push(message) });
  if (!fullShell) controller.renderShell(shell);
  await controller.idle();
  return { ...ui, api, controller, backend, presets, histories, calls, errors, failures, restore, hidePanel,
    get shell() { return shell; }, get panel() { return panel; },
    setBackup(value) { selectedBackup = structuredClone(value); },
    setShell(next) { shell = structuredClone(next); controller.renderShell(shell); },
    select(id) {
      if (fullShell) {
        const item = [...ui.document.querySelectorAll('.nav-account')].find((node) => node.dataset.id === id);
        if (item) item.querySelector('.nav-account-main').fire('click');
        else {
          const target = backend.accounts.find((entry) => entry.id === id);
          const family = backend.platforms.find((entry) => entry.id === target.platformId).family;
          ui.document.querySelectorAll('.tab-item').find((node) => node.dataset.platform === family).fire('click');
        }
      } else { shell = { ...shell, activeId: id }; controller.renderShell(shell); }
    },
    click: async (id) => { ui.get(id).fire('click'); await controller.idle(); },
    idle: () => controller.idle(),
  };
}
