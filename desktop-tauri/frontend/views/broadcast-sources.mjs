import { emptyRecipientSources, recipientSourceIssue, importSummaryText } from '../models/broadcast.mjs';
import { audienceSourceError } from '../models/broadcast-status.mjs';
import { element, button, wire } from './broadcast-elements.mjs';

// These are editor drafts only. The controller owns native reads and their lifetime.
export function createRecipientSourcesView(document, changed, resolve) {
  const $ = (id) => document.getElementById(id);
  const inputs = { paste: $('bc-paste-numbers'), groups: $('bc-group-members-select'), label: $('bc-label-select') };
  const buttons = {}, statuses = {}, feedback = {};
  let drafts = emptyRecipientSources();
  let catalog = null;
  let availability = { blocked: true, editable: false, canPaste: false, canAudience: false };
  const listeners = [];
  inputs.paste.setAttribute('aria-label', '每行一个完整国际号码');
  inputs.groups.setAttribute('aria-label', '选择要读取成员的群组');
  inputs.label.setAttribute('aria-label', '选择平台标签');

  for (const [kind, id, label] of [['paste', 'broadcast-verify-numbers', '核验号码'],
    ['groups', 'broadcast-read-group-members', '读取成员'], ['label', 'broadcast-read-label', '读取对象']]) {
    const action = button(document, label, () => resolve(kind), 'bc-btn bc-btn--small bc-pill');
    action.id = id; buttons[kind] = action;
    let anchor;
    if (kind === 'paste') {
      anchor = $('bc-paste-total').parentElement;
      anchor.append(element(document, 'span', '', ' '), action);
    } else {
      anchor = element(document, 'div', 'bc-search-actions');
      anchor.append(action); inputs[kind].after(anchor);
    }
    const status = kind === 'groups' ? $('bc-sendto-group-members').querySelector('.bc-meta') : element(document, 'div', 'bc-meta');
    status.id = kind === 'paste' ? 'bc-paste-meta' : `bc-${kind}-meta`;
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
    anchor.after(status); statuses[kind] = status;
    const event = kind === 'paste' ? 'input' : 'change';
    const change = () => {
      const draft = drafts[kind];
      draft.selection = selected(kind); draft.revision += 1; draft.verifiedRevision = null; feedback[kind] = null;
      render(); changed();
    };
    inputs[kind].addEventListener(event, change);
    listeners.push(() => inputs[kind].removeEventListener(event, change));
  }

  function selected(kind) {
    return kind === 'groups' ? [...inputs.groups.options].filter((option) => option.selected).map((option) => option.value)
      : inputs[kind].value;
  }

  function available(kind) {
    if (kind === 'paste') return availability.canPaste;
    return availability.canAudience && (kind === 'groups' ? catalog?.capabilities.groupMembers === true : Array.isArray(catalog?.labels));
  }

  function options() {
    const groups = new Map((catalog?.chats || []).filter((chat) => chat.kind === 'group').map((chat) => [chat.id, chat]));
    for (const id of drafts.groups.selection) if (!groups.has(id)) groups.set(id, { id, name: `${id}（已失效）` });
    inputs.groups.replaceChildren();
    for (const group of groups.values()) {
      const option = element(document, 'option', '', group.name || group.id); option.value = group.id;
      option.selected = drafts.groups.selection.includes(group.id); inputs.groups.append(option);
    }
    const labels = new Map((catalog?.labels || []).map((label) => [label.id, label]));
    const selectedLabel = drafts.label.selection;
    if (selectedLabel && !labels.has(selectedLabel)) labels.set(selectedLabel, { id: selectedLabel, name: `${selectedLabel}（已失效）` });
    const placeholder = element(document, 'option', '', catalog?.labels?.length ? '选择平台标签…' : '暂无平台标签');
    placeholder.value = ''; inputs.label.replaceChildren(placeholder);
    for (const label of labels.values()) {
      const option = element(document, 'option', '', label.name || label.id); option.value = label.id;
      inputs.label.append(option);
    }
    inputs.label.value = selectedLabel;
  }

  function render() {
    $('bc-paste-total').textContent = String(inputs.paste.value.split(/\r?\n/).filter((line) => line.trim()).length);
    for (const kind of Object.keys(inputs)) {
      const draft = drafts[kind];
      const issue = recipientSourceIssue(kind, { ...draft, selection: selected(kind) }, catalog);
      const stale = catalog?.ready && draft.recipientIds.some((id) => !catalog.chats.some((chat) => chat.id === id));
      const verified = draft.verifiedRevision === draft.revision;
      let text = kind === 'paste' ? '请先核验当前号码。' : kind === 'groups' ? '请选择群组，再读取成员。'
        : catalog?.labels?.length ? '请选择平台标签，再读取对象。' : '当前账号暂无平台标签。';
      if (issue && !['BROADCAST_SOURCE_EMPTY', 'BROADCAST_PASTE_UNVERIFIED'].includes(issue)) text = audienceSourceError(issue, kind);
      else if (verified && stale) text = kind === 'paste' ? '已核验的联系人已失效，请重新核验。' : '已读取的对象已失效，请重新读取。';
      else if (verified) text = importSummaryText(draft.summary, kind === 'paste' ? '已核验' : '已读取', kind === 'label' ? '对象' : '联系人');
      else if (!issue && kind !== 'paste') text = '来源已选择，请读取对象。';
      statuses[kind].textContent = feedback[kind]?.text || text;
      statuses[kind].dataset.state = feedback[kind]?.state || (issue || verified && stale ? 'error' : 'ready');
      wire(inputs[kind], !availability.editable || !catalog?.ready || !available(kind));
      wire(buttons[kind], availability.blocked || !catalog?.ready || !available(kind) || Boolean(issue));
    }
  }

  return {
    available,
    set(next, saved) {
      catalog = next;
      if (saved) {
        const empty = emptyRecipientSources();
        drafts = Object.fromEntries(Object.keys(empty).map((kind) => [kind, structuredClone(saved[kind] || empty[kind])]));
        for (const kind of Object.keys(feedback)) delete feedback[kind];
        inputs.paste.value = drafts.paste.selection;
      }
      options(); render();
    },
    resolved(kind, result, revision) {
      const draft = drafts[kind];
      draft.recipientIds = result.recipientIds.slice(); draft.summary = { ...result.summary };
      draft.verifiedRevision = revision; feedback[kind] = null; catalog = result.catalog;
      options(); render();
    },
    status(kind, text = '', state = 'ready') { feedback[kind] = text ? { text, state } : null; render(); },
    ids(kind) { const draft = drafts[kind]; return draft.verifiedRevision === draft.revision ? draft.recipientIds.slice() : []; },
    values() { return Object.fromEntries(Object.entries(drafts).map(([kind, draft]) => [kind, { ...structuredClone(draft), selection: selected(kind) }])); },
    availability(next) { availability = next; render(); },
    render,
    dispose() { for (const remove of listeners) remove(); },
  };
}
