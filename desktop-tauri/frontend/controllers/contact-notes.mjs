// Contact notes controller: the chat identity comes from the same native
// translation context the original build used, and every write is owned by one
// captured identity/generation so late responses never repaint another chat.
import { createContactNotesView } from '../views/contact-notes.mjs';
import {
  EMPTY_PROFILE, MAX_NOTE_LENGTH, cleanText, hasProfile, normalizeIdentity, normalizeProfile,
  validFollowUp,
} from '../models/contact-notes.mjs';

const popover = 'contact-notes-popover';

export function createContactNotesController({ document, api, getShellSnapshot, showPanel, hidePanel,
  reportError = () => {} }) {
  const connected = Boolean(api?.contactNotes && api?.contactNotesUpdate);
  const view = createContactNotesView(document, {
    toggle: () => track(toggle()), close: () => track(close()),
    save: () => track(save()), remove: () => track(remove()),
  });
  let shellBusy = false;
  let disposed = false;
  let open = false;
  let identity = null;
  let profile = null;
  let accountId = null;
  let generation = 0;
  let loading = false;
  let saving = false;
  let noteError = '';
  let saved = false;
  const tasks = new Set();
  const track = (task) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  };
  const account = () => {
    const snapshot = getShellSnapshot();
    return snapshot?.accounts.find((item) => item.id === snapshot.activeId && !item.archived);
  };

  function render() {
    if (disposed) return;
    view.render({ identity, profile, open, connected: connected && Boolean(account()),
      shellBusy: shellBusy || loading, saving, noteError, saved });
  }

  function resetFeedback() { noteError = ''; saved = false; }

  async function loadContext() {
    const item = account();
    const operationEpoch = ++generation;
    loading = true;
    identity = null;
    profile = null;
    view.renderForm(EMPTY_PROFILE);
    resetFeedback();
    render();
    try {
      const context = item && typeof api?.translationContext === 'function'
        ? await api.translationContext(item.id) : null;
      if (disposed || operationEpoch !== generation) return;
      const nextIdentity = context?.available && context.chat
        ? normalizeIdentity(familyOf(item), context.chat.id) : null;
      identity = nextIdentity;
      profile = null;
      view.renderForm(EMPTY_PROFILE);
      resetFeedback();
      if (identity) {
        const result = await api.contactNotes(item.id, identity);
        if (disposed || operationEpoch !== generation) return;
        profile = normalizeProfile(result);
        view.renderForm(profile);
      }
    } catch (failure) {
      if (disposed || operationEpoch !== generation) return;
      identity = null; profile = null;
      reportError(noteMessage(failure));
    } finally {
      if (!disposed && operationEpoch === generation) { loading = false; render(); }
    }
  }

  function familyOf(item) {
    const snapshot = getShellSnapshot();
    return snapshot?.platforms.find((platform) => platform.id === item.platformId)?.family
      || item.platformId;
  }

  function validatedDraft() {
    const draft = view.readForm();
    const next = {
      name: cleanText(draft.name, 100),
      country: cleanText(draft.country, 80),
      source: cleanText(draft.source, 100),
      followStatus: draft.followStatus || '',
      nextFollowUp: cleanText(draft.nextFollowUp, 16),
      notes: cleanText(draft.notes, MAX_NOTE_LENGTH),
    };
    if (next.name.length > 100 || next.notes.length > MAX_NOTE_LENGTH) throw 'CONTACT_NOTES_INVALID';
    if (!validFollowUp(next.nextFollowUp)) throw 'CONTACT_NOTES_INVALID';
    return next;
  }

  async function write(note) {
    const owner = account();
    const ownerIdentity = identity;
    const ownerGeneration = generation;
    if (!owner || !ownerIdentity) return;
    saving = true; resetFeedback(); render();
    try {
      await api.contactNotesUpdate(owner.id, ownerIdentity, note, Date.now());
      if (disposed) return;
      // The write stays durable even if the popover moved on; only the owning
      // generation may repaint its own fields.
      if (ownerGeneration === generation && owner.id === account()?.id) {
        profile = normalizeProfile(note);
        saving = false; saved = true; render();
        view.renderForm(profile);
      } else { saving = false; render(); }
    } catch (failure) {
      if (disposed) return;
      saving = false;
      if (ownerGeneration === generation) {
        noteError = noteMessage(failure);
        render();
      }
    }
  }

  async function save() {
    if (!connected || shellBusy || loading || saving || !identity || !account()) return;
    let note;
    try { note = validatedDraft(); }
    catch (failure) { noteError = noteMessage(failure); render(); return; }
    if (!hasProfile(note)) return remove();
    await write(note);
  }

  async function remove() {
    if (!connected || shellBusy || loading || saving || !identity || !account()) return;
    await write({ ...EMPTY_PROFILE });
  }

  async function toggle() {
    if (!connected || shellBusy || !account()) return;
    if (open) { await close(); return; }
    open = true;
    try {
      // Capture the active conversation before hiding the native guest.
      await loadContext();
      if (!open || disposed) return;
      await showPanel(popover, render, 'contact-notes-close');
      render();
    } catch (failure) { reportError(noteMessage(failure)); open = false; render(); }
  }

  async function close() {
    try { await hidePanel(); } catch (failure) { reportError(noteMessage(failure)); }
  }

  render();
  return {
    renderShell(snapshot) {
      if (disposed) return;
      const next = snapshot.accounts.find((item) => item.id === snapshot.activeId)?.id;
      if (next !== accountId) {
        accountId = next;
        generation += 1;
        identity = null; profile = null; resetFeedback();
        if (open) track(loadContext());
      }
      render();
    },
    setShellBusy(value) { shellBusy = value; render(); },
    panelChanged(id) {
      open = id === popover;
      if (!open) { generation += 1; identity = null; profile = null; resetFeedback(); }
      render();
    },
    idle: async () => { while (tasks.size) await Promise.allSettled([...tasks]); },
    dispose() { disposed = true; generation += 1; view.dispose(); },
  };
}

export function noteMessage(code) {
  const messages = {
    CONTACT_NOTES_INVALID: '客户资料未通过校验：请检查字段长度和下次跟进时间格式。',
    CONTACT_NOTES_LIMIT: '当前账号的客户资料数量已达上限。',
    CONTACT_NOTES_PERSISTENCE: '客户资料保存失败；未提交的修改保留在表单中。',
    DPAPI_FAILED: 'Windows 安全存储不可用；不会回退到明文保存。',
    STORE_IO: '账号数据读写失败；未提交的修改不会生效。',
  };
  return messages[typeof code === 'string' ? code : code?.code] || null;
}
