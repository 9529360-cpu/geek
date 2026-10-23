import { draftRecipients, normalizeResolvedRecipients, importSummaryText } from '../models/broadcast.mjs';
import { normalizePresets, presetName, presetMessage, audienceDraftFingerprint } from '../models/broadcast-presets.mjs';
import { errorCode, errorMessage } from '../models/broadcast-status.mjs';
import { createBroadcastPresetsView } from '../views/broadcast-presets.mjs';

// Account/editor identity and recipient reads remain owned by the broadcast controller.
// This helper owns only the revisioned, durable preset collection and its editor forms.
export function createBroadcastPresets({ document, api, context, track, changed, applyMessage, applyAudience }) {
  const available = ['broadcastPresets', 'broadcastSaveMessage', 'broadcastSaveAudience', 'broadcastDeletePreset', 'broadcastRestoreAudience']
    .every((name) => typeof api?.[name] === 'function');
  const names = new Map();
  const audienceOperations = new Set();
  let scope = null;
  let snapshot = null;
  let operation = null;
  let conflict = false;
  let disposed = false;
  let message = '', audience = '';
  let messageRevision = 0, audienceRevision = 0;
  const view = createBroadcastPresetsView({ document,
    onSave: (kind) => track(save(kind)), onDelete: (kind, id) => track(remove(kind, id)),
    onApplyMessage: useMessage, onRestore: (id) => track(restore(id)),
    onRefresh: () => track(load()), onChange: render,
  });

  function observe() {
    const state = context();
    if (!state.open) return state;
    if (!scope || scope.accountId !== state.accountId || scope.epoch !== state.epoch) {
      if (scope) names.set(scope.accountId, view.names());
      scope = { accountId: state.accountId, epoch: state.epoch };
      snapshot = null; operation = null; conflict = false;
      view.bind(names.get(state.accountId));
      if (available) for (const kind of ['message', 'audience']) view.feedback(kind, '请刷新资料。', 'ready', true);
      message = state.draft.message; audience = audienceDraftFingerprint(state.draft);
      messageRevision = 0; audienceRevision = 0;
    }
    if (message !== state.draft.message) { message = state.draft.message; messageRevision += 1; }
    const next = audienceDraftFingerprint(state.draft);
    if (audience !== next) { audience = next; audienceRevision += 1; }
    return state;
  }

  function render() {
    if (disposed) return;
    const state = observe();
    view.render(snapshot);
    view.availability({ available, ready: Boolean(snapshot), busy: Boolean(operation), conflict,
      blocked: !state.open || state.blocked,
      audienceReady: Boolean(state.catalog?.ready && !state.audienceBusy && !audienceOperations.size) });
  }

  function capture(action, kind = null) {
    const state = observe();
    return { action, kind, ...scope, revision: snapshot?.revision,
      catalogId: kind === 'audience' && action !== 'delete' ? state.catalog?.catalogId : undefined,
      inputRevision: action === 'load' ? undefined : kind === 'message' ? messageRevision : audienceRevision,
      nameRevision: action === 'save' || action === 'delete' ? view.revision(kind) : undefined };
  }

  function ownerCurrent(ticket) {
    const state = observe();
    return !disposed && operation === ticket && state.open && state.accountId === ticket.accountId && state.epoch === ticket.epoch;
  }

  function current(ticket) {
    if (!ownerCurrent(ticket)) return false;
    const state = context();
    return (ticket.catalogId === undefined || state.catalog?.catalogId === ticket.catalogId)
      && (ticket.inputRevision === undefined || ticket.inputRevision === (ticket.kind === 'message' ? messageRevision : audienceRevision))
      && (ticket.nameRevision === undefined || ticket.nameRevision === view.revision(ticket.kind));
  }

  function canAct(kind, directory = kind === 'audience') {
    const state = observe();
    return available && !disposed && !operation && !conflict && snapshot && state.open && !state.blocked
      && (!directory || state.catalog?.ready && !state.audienceBusy && !audienceOperations.size);
  }

  function failure(ticket, error) {
    if (!current(ticket)) return;
    const code = errorCode(error);
    const refresh = ['BROADCAST_PRESET_CONFLICT', 'BROADCAST_PRESET_UNKNOWN'].includes(code);
    if (refresh) conflict = true;
    const text = ticket.action === 'load' ? '资料暂时无法读取，请刷新重试。' : errorMessage(error);
    for (const kind of ticket.kind ? [ticket.kind] : ['message', 'audience']) view.feedback(kind, text, 'error', refresh || ticket.action === 'load');
  }

  function finish(ticket, applied) {
    audienceOperations.delete(ticket);
    if (operation !== ticket) { render(); changed(); return; }
    if (!applied && ownerCurrent(ticket) && !current(ticket)) {
      if (ticket.action === 'restore') view.feedback('audience', '选择已变化，原选择已保留。', 'ready');
      else if (ticket.action !== 'load') {
        conflict = true;
        view.feedback(ticket.kind, '草稿已变化，请刷新资料查看结果。', 'error', true);
      }
    }
    operation = null; render(); changed();
  }

  async function load() {
    const state = observe();
    if (!available || disposed || operation || !state.open || state.blocked) { render(); return; }
    const ticket = capture('load'); operation = ticket;
    for (const kind of ['message', 'audience']) view.feedback(kind, '正在读取资料…', 'loading');
    render();
    let applied = false;
    try {
      const value = await api.broadcastPresets(ticket.accountId);
      if (!current(ticket)) return;
      const next = normalizePresets(value, ticket.accountId);
      if (snapshot && next.revision < snapshot.revision) throw 'BROADCAST_PRESET_CONFLICT';
      snapshot = next; conflict = false; applied = true;
      for (const kind of ['message', 'audience']) view.feedback(kind);
    } catch (error) { failure(ticket, error); }
    finally { finish(ticket, applied); }
  }

  async function save(kind) {
    if (!canAct(kind)) return;
    const state = context();
    const ticket = capture('save', kind);
    let applied = false;
    try {
      const name = presetName(view.name(kind));
      const payload = kind === 'message' ? presetMessage(state.draft.message) : draftRecipients(state.draft, state.catalog);
      const count = kind === 'message' ? snapshot.messages.length : snapshot.audiences.length;
      if (count >= 100 && (kind !== 'message' || !snapshot.messages.some((item) => item.name === name))
        || kind === 'audience' && payload.length > 2000) throw 'BROADCAST_PRESET_LIMIT';
      operation = ticket; if (kind === 'audience') audienceOperations.add(ticket);
      view.feedback(kind, '正在保存…', 'loading'); render(); changed();
      const value = kind === 'message'
        ? await api.broadcastSaveMessage(ticket.accountId, ticket.revision, name, payload)
        : await api.broadcastSaveAudience(ticket.accountId, ticket.catalogId, ticket.revision, name, payload);
      if (!current(ticket)) return;
      const next = normalizePresets(value, ticket.accountId);
      const unchanged = kind === 'message' && next.revision === ticket.revision
        && JSON.stringify(next) === JSON.stringify(snapshot)
        && next.messages.some((item) => item.name === name && item.message === payload);
      if (next.revision < ticket.revision || next.revision === ticket.revision && !unchanged) throw 'BROADCAST_PRESET_CONFLICT';
      snapshot = next; applied = true; view.saved(kind);
      view.feedback(kind, kind === 'message' ? '常用消息已保存' : '自定义标签已保存', 'ready');
    } catch (error) {
      if (!operation) operation = ticket;
      failure(ticket, error);
    } finally { finish(ticket, applied); }
  }

  async function remove(kind, id) {
    if (!canAct(kind, false) || !snapshot[kind === 'message' ? 'messages' : 'audiences'].some((item) => item.id === id)) return;
    const ticket = capture('delete', kind); operation = ticket;
    view.feedback(kind, '正在删除…', 'loading'); render();
    let applied = false;
    try {
      const value = await api.broadcastDeletePreset(ticket.accountId, ticket.revision, kind, id);
      if (!current(ticket)) return;
      const next = normalizePresets(value, ticket.accountId);
      if (next.revision <= ticket.revision) throw 'BROADCAST_PRESET_CONFLICT';
      snapshot = next; applied = true; view.deleted(kind); view.feedback(kind, '已删除', 'ready');
    } catch (error) { failure(ticket, error); }
    finally { finish(ticket, applied); }
  }

  function useMessage(id) {
    if (!canAct('message')) return;
    const item = snapshot.messages.find((item) => item.id === id);
    if (!item) return;
    applyMessage(item.message); view.selected('message', id);
    view.feedback('message', '已填入常用消息', 'ready'); render();
  }

  async function restore(id) {
    if (!canAct('audience') || !snapshot.audiences.some((item) => item.id === id)) return;
    const ticket = capture('restore', 'audience'); operation = ticket;
    audienceOperations.add(ticket);
    view.feedback('audience', '正在恢复发送对象…', 'loading'); render(); changed();
    let applied = false;
    try {
      const value = await api.broadcastRestoreAudience(ticket.accountId, ticket.catalogId, ticket.revision, id);
      if (!current(ticket)) return;
      const restored = normalizeResolvedRecipients(value, ticket.accountId, true, true);
      applied = true; applyAudience(restored); view.selected('audience', id);
      view.feedback('audience', importSummaryText(restored.summary, '已恢复', '对象')
        + (restored.recipientIds.length ? '，排除项已保留。' : '，当前没有可用对象。'), restored.recipientIds.length ? 'ready' : 'error');
    } catch (error) { failure(ticket, error); }
    finally { finish(ticket, applied); }
  }

  return {
    load, render,
    get audienceBusy() { return audienceOperations.size > 0; },
    dispose() { disposed = true; operation = null; names.clear(); audienceOperations.clear(); view.dispose(); },
  };
}
