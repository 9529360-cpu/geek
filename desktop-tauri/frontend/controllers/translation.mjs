import { createTranslationView } from '../views/translation.mjs';
import { DEFAULT_POLICY, isWhatsApp, policyOf, translationError, translationOf } from '../models/translation.mjs';

export function createTranslationController({ document, api, getShellSnapshot, showPanel, hidePanel,
  acceptSnapshot, getSession, refreshSession, openSession, reportError = () => {} }) {
  const states = new Map();
  const tasks = new Set();
  const connected = Boolean(api?.translationContext && api?.updateTranslation);
  let activeId = null;
  let shellBusy = false;
  let disposed = false;
  let open = false;
  let opening = false;
  let tab = 'global';
  let context = null;
  let contextPending = false;
  let contextError = '';
  let contextEpoch = 0;
  let checking = false;
  let confirmation = false;
  const track = (task) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  };
  const view = createTranslationView(document, {
    toggle: () => track(toggle()), close: () => track(close()), tab: (next) => { tab = next; render(); },
    globalChanged, chatChanged, override, reset,
    retry: (scope) => { const state = currentState(); if (state) queue(state, scope === 'global' ? null : context?.chat?.id); },
    check: () => track(check()), session: () => openSession(),
  });
  const account = () => getShellSnapshot()?.accounts.find((item) => item.id === activeId);
  function stateFor(item) {
    if (!item) return null;
    let state = states.get(item.id);
    const authority = translationOf(item);
    if (!state) {
      state = { id: item.id, authority, drafts: new Map(), pending: new Set(), running: null };
      states.set(item.id, state);
    } else if (authority.revision >= state.authority.revision) state.authority = authority;
    return state;
  }
  function currentState() { return states.get(activeId) || stateFor(account()); }
  function effective(state, chatId = null) {
    const draft = state?.drafts.get(chatId);
    if (draft?.dirty) return draft.policy;
    return chatId === null ? state?.authority.global || DEFAULT_POLICY : state?.authority.chats[chatId] || null;
  }
  function render() {
    if (disposed) return;
    const item = account();
    const state = currentState();
    const chatId = context?.chat?.id;
    const session = getSession();
    view.render({ account: item, supported: isWhatsApp(item), connected, shellBusy, open, tab,
      global: effective(state), chat: chatId ? effective(state, chatId) : null,
      globalDraft: state?.drafts.get(null), chatDraft: chatId ? state?.drafts.get(chatId) : null,
      context, contextPending, contextError, checking, confirmation, session: session.snapshot, sessionError: session.error });
  }
  function acceptAuthority(snapshot, id) {
    const item = snapshot?.accounts?.find((entry) => entry.id === id);
    if (!item) throw 'TRANSLATION_INVALID';
    const state = stateFor(item);
    acceptSnapshot(snapshot, id);
    return state;
  }
  async function drain(state) {
    try {
      while (state.pending.size && !disposed) {
        const chatId = state.pending.values().next().value;
        state.pending.delete(chatId);
        const draft = state.drafts.get(chatId);
        const version = draft.version;
        const policy = draft.policy === null ? null : { ...draft.policy };
        draft.saving = true; draft.error = ''; render();
        try {
          const next = await api.updateTranslation(state.id, chatId, policy, state.authority.revision);
          if (disposed) break;
          acceptAuthority(next, state.id);
          if (draft.version === version) { draft.dirty = false; draft.saved = true; }
        } catch (failure) {
          if (disposed) break;
          // A revision conflict needs a fresh base. Retain the user's draft and
          // require another explicit change/retry; never replay it automatically.
          if (failure === 'TRANSLATION_SETTINGS_CONFLICT' && api.snapshot) {
            try { acceptAuthority(await api.snapshot(), state.id); } catch { /* Keep the last durable base. */ }
          }
          if (draft.version === version) {
            draft.error = `${translationError(failure)} 草稿尚未保存。`;
            draft.saved = false;
          }
        } finally { draft.saving = state.pending.has(chatId); render(); }
      }
    } finally { state.running = null; render(); }
  }
  function queue(state, chatId) {
    if (!connected || disposed || chatId === undefined || !state.drafts.has(chatId)) return;
    state.pending.add(chatId);
    const draft = state.drafts.get(chatId);
    draft.saving = true; draft.error = ''; draft.saved = false; render();
    if (!state.running) state.running = track(drain(state));
  }
  function change(chatId, policy) {
    const state = currentState();
    if (!state || !connected || shellBusy || !isWhatsApp(account())) return;
    try {
      const normalized = policy === null ? null : policyOf(policy);
      const previous = state.drafts.get(chatId);
      const draft = previous || {};
      Object.assign(draft, { policy: normalized, version: (previous?.version || 0) + 1,
        dirty: true, saving: Boolean(previous?.saving), saved: false, error: '' });
      state.drafts.set(chatId, draft);
      confirmation = false;
      queue(state, chatId);
    } catch (failure) { contextError = translationError(failure); render(); }
  }
  function globalChanged() { const state = currentState(); if (state) change(null, view.readGlobal(effective(state))); }
  function chatChanged() {
    const state = currentState(); const chatId = context?.chat?.id;
    if (state && context?.available && chatId && effective(state, chatId)) {
      change(chatId, view.readChat(effective(state, chatId)));
    }
  }
  function override(enabled) {
    const state = currentState(); const chatId = context?.chat?.id;
    if (!state || !context?.available || !chatId || contextPending) return;
    change(chatId, enabled ? { ...effective(state) } : null);
  }
  function reset() {
    if (!isWhatsApp(account()) || shellBusy) return;
    if (!confirmation) { confirmation = true; render(); return; }
    change(null, { ...DEFAULT_POLICY });
  }
  async function readContext(id, operationEpoch) {
    contextPending = true; contextError = ''; context = null; render();
    try {
      const next = await api.translationContext(id);
      if (disposed || operationEpoch !== contextEpoch || id !== activeId) return;
      if (!next || next.accountId !== id || typeof next.available !== 'boolean'
        || (next.chat !== null && (!next.chat || typeof next.chat.id !== 'string' || typeof next.chat.name !== 'string'))) {
        throw 'NETWORK_RESPONSE_INVALID';
      }
      context = next;
    } catch (failure) {
      if (operationEpoch === contextEpoch && !disposed) contextError = translationError(failure);
    } finally {
      if (operationEpoch === contextEpoch && !disposed) { contextPending = false; render(); }
    }
  }
  function loadContext() {
    const operationEpoch = ++contextEpoch;
    if (!connected || !isWhatsApp(account())) { context = null; contextPending = false; render(); return; }
    track(readContext(activeId, operationEpoch));
  }
  async function toggle() {
    if (!connected || shellBusy || opening || !account()) return;
    if (open) { await close(); return; }
    opening = true; confirmation = false;
    // Capture the native conversation while opening. Hiding the child view is a
    // presentation change, not a new account/chat binding.
    loadContext();
    try { await showPanel('translation-popover', render, 'translation-receive-auto'); }
    catch (failure) { reportError(translationError(failure)); }
    finally { opening = false; }
  }
  async function close() {
    try { await hidePanel(); } catch (failure) { reportError(translationError(failure)); }
  }
  async function check() {
    if (checking || shellBusy) return;
    checking = true; render();
    try { await refreshSession(); } finally { checking = false; render(); }
  }
  render();
  return {
    renderShell(snapshot) {
      if (disposed) return;
      for (const item of snapshot.accounts) if (states.has(item.id)) stateFor(item);
      if (activeId !== snapshot.activeId) {
        activeId = snapshot.activeId; contextEpoch += 1; context = null; contextPending = false;
        contextError = ''; confirmation = false;
        if (open) loadContext();
      }
      render();
    },
    renderSession: render,
    setShellBusy(value) { shellBusy = value; render(); },
    panelChanged(id) {
      open = id === 'translation-popover';
      if (!open) { contextEpoch += 1; contextPending = false; confirmation = false; }
      render();
    },
    idle: async () => { while (tasks.size) await Promise.allSettled([...tasks]); },
    dispose() { disposed = true; contextEpoch += 1; view.dispose(); },
  };
}
