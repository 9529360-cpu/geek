import { dom } from './dom.mjs';
import { createSessionController } from '../../frontend/controllers/session.mjs';
import { createTranslationController } from '../../frontend/controllers/translation.mjs';
import { DEFAULT_POLICY } from '../../frontend/models/translation.mjs';

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const turn = () => new Promise((resolve) => setImmediate(resolve));
export const signedOut = () => ({ revision: 1, state: 'signedOut', user: null, remainingChars: null, quotaFresh: false, issue: null });
export const signedIn = (changes = {}) => ({ revision: 2, state: 'signedIn',
  user: { id: 7, email: 'synthetic@example.invalid', accountNo: 'TEST-7' }, remainingChars: 20000, quotaFresh: true, issue: null, ...changes });

export async function fixture({ before = async () => {}, sessionState = signedIn(), wait = true } = {}) {
  const ui = dom();
  const calls = [];
  const failures = new Map();
  let sessionBackend = structuredClone(sessionState);
  let shell = { activeId: 'a', accounts: [
    { id: 'a', name: '客服一', platformId: 'whatsapp', archived: false },
    { id: 'b', name: '客服二', platformId: 'whatsapp-pure', archived: false },
    { id: 'tg', name: 'Telegram', platformId: 'telegram-z', archived: false },
  ].map((account) => ({ ...account, translation: { revision: 1, global: { ...DEFAULT_POLICY }, chats: {} } })) };
  let backend = structuredClone(shell);
  let panel = null;
  let session; let translation;
  let hides = 0;
  let shows = 0;
  const chats = new Map([['a', { id: 'a-ann', name: 'Ann' }], ['b', { id: 'b-ben', name: 'Ben' }]]);
  const commit = (id, chatId, policy, expectedRevision) => {
    const account = backend.accounts.find((item) => item.id === id);
    if (account.translation.revision !== expectedRevision) throw 'TRANSLATION_SETTINGS_CONFLICT';
    const keys = chatId === null ? Object.keys(DEFAULT_POLICY)
      : ['enabled', 'autoSend', 'target', 'messageAction', 'displayTranslation', 'translationMode', 'messageTarget'];
    if (policy !== null && (Object.keys(policy).length !== keys.length || keys.some((key) => !Object.hasOwn(policy, key)))) {
      throw 'TRANSLATION_INVALID';
    }
    if (chatId === null) account.translation.global = structuredClone(policy);
    else if (policy === null) delete account.translation.chats[chatId];
    else account.translation.chats[chatId] = structuredClone(policy);
    account.translation.revision += 1;
    return structuredClone(backend);
  };
  async function invoke(name, args) {
    calls.push([name, structuredClone(args)]);
    const override = await before(name, args);
    if (override !== undefined) return structuredClone(override);
    if (failures.has(name)) throw failures.get(name);
    if (name === 'sessionSnapshot' || name === 'sessionRefresh') return structuredClone(sessionBackend);
    if (name === 'sessionLogin') { sessionBackend = signedIn({ revision: sessionBackend.revision + 1 }); return structuredClone(sessionBackend); }
    if (name === 'sessionLogout') {
      sessionBackend = { ...signedOut(), revision: sessionBackend.revision + 1 }; return structuredClone(sessionBackend);
    }
    if (name === 'context') return { accountId: args, generation: 1, available: true, chat: structuredClone(chats.get(args) || null) };
    if (name === 'update') return commit(args.id, args.chatId, args.policy, args.expectedRevision);
    if (name === 'snapshot') return structuredClone(backend);
    throw new Error('Unknown synthetic boundary');
  }
  const api = {
    sessionSnapshot: () => invoke('sessionSnapshot', null), sessionRefresh: () => invoke('sessionRefresh', null),
    sessionLogin: (email, password) => invoke('sessionLogin', { email, password }), sessionLogout: () => invoke('sessionLogout', null),
    translationContext: (id) => invoke('context', id),
    updateTranslation: (id, chatId, policy, expectedRevision) => invoke('update', { id, chatId, policy, expectedRevision }),
    snapshot: () => invoke('snapshot', null),
  };
  async function showPanel(id, fill, focusId) {
    shows += 1;
    if (panel) ui.get(panel).classList.add('hidden');
    panel = id; fill?.(); ui.get(id).classList.remove('hidden');
    session?.panelChanged(id); translation?.panelChanged(id);
    if (focusId) ui.get(focusId).focus();
  }
  async function hidePanel() {
    hides += 1;
    if (panel) ui.get(panel).classList.add('hidden');
    panel = null; session?.panelChanged(null); translation?.panelChanged(null);
  }
  session = createSessionController({ ...ui, api, showPanel, hidePanel, onChange: () => translation?.renderSession() });
  translation = createTranslationController({ ...ui, api, showPanel, hidePanel, getShellSnapshot: () => shell,
    acceptSnapshot: (snapshot, id) => {
      const update = snapshot.accounts.find((item) => item.id === id).translation;
      shell = { ...shell, accounts: shell.accounts.map((item) => item.id === id ? { ...item, translation: update } : item) };
      translation.renderShell(shell);
    }, getSession: () => ({ snapshot: session.snapshot, error: session.error }),
    refreshSession: () => session.refresh(), openSession: () => session.open() });
  translation.renderShell(shell);
  const idle = async () => { await session.idle(); await translation.idle(); };
  if (wait) await idle();
  return { ...ui, calls, failures, session, translation, api, idle, commit, chats, showPanel, hidePanel,
    get shell() { return shell; }, get backend() { return backend; }, get panel() { return panel; },
    get hides() { return hides; }, get shows() { return shows; },
    publishSession(value) { sessionBackend = structuredClone(value); },
    switchAccount(id) { shell.activeId = id; backend.activeId = id; translation.renderShell(shell); },
    click: async (id) => { ui.get(id).fire('click'); await idle(); },
    input: async (id, value, event = 'change') => {
      const node = ui.get(id);
      if (typeof value === 'boolean') node.checked = value; else node.value = value;
      node.fire(event); await idle();
    },
  };
}
