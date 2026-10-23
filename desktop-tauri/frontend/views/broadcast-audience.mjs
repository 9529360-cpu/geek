import { matchingChats, importSummaryText, audienceSourceKinds } from '../models/broadcast.mjs';
import { element, button, wire, hidden, unavailable } from './broadcast-elements.mjs';
import { createRecipientSourcesView } from './broadcast-sources.mjs';

export function createAudienceView(document, changed, resolveSource) {
  const $ = (id) => document.getElementById(id);
  let catalog = null;
  let selected = new Set();
  let cards = new Set();
  let blocked = false;
  let mode = 'custom';
  let imported = [];
  let importFileName = '';
  let importSummary = null;
  let importFeedback = null;
  let importAvailable = false;
  let sourceAvailability = { canPaste: false, canAudience: false, editable: false };
  let exclusionBase = null;
  let excludedContacts = new Set();
  let excludedGroups = new Set();
  const updateButtons = [];
  const listeners = [];
  const bind = (node, type, fn) => {
    node.addEventListener(type, fn);
    listeners.push(() => node.removeEventListener(type, fn));
  };
  const setAvailable = (node, yes) => { wire(node, !yes); };
  const sources = createRecipientSourcesView(document, () => { render(); changed(); }, resolveSource);
  const dropdown = $('bc-selectize-dropdown');
  const open = (value) => {
    hidden(dropdown, !value);
    $('bc-selectize').classList.toggle('open', value);
    $('broadcast-search').setAttribute('aria-expanded', String(value));
  };
  $('broadcast-search').setAttribute('aria-label', '搜索联系人或群组');
  $('broadcast-search').setAttribute('aria-controls', 'bc-selectize-dropdown');
  bind($('broadcast-search'), 'input', () => { open(true); render(); });
  bind($('broadcast-search'), 'focus', () => open(true));
  bind($('bc-selectize-control'), 'click', () => open(true));
  bind($('broadcast-overlay'), 'click', (event) => {
    if (!$('bc-selectize').contains(event.target)) open(false);
  });
  bind($('broadcast-search'), 'keydown', (event) => {
    if (event.key === 'Escape' && !dropdown.classList.contains('hidden')) {
      event.preventDefault(); event.stopPropagation(); open(false);
    }
  });
  const chats = () => catalog?.chats || [];
  const pick = (kind = null) => {
    for (const chat of matchingChats(chats(), $('broadcast-search').value, kind)) selected.add(chat.id);
    render(); changed();
  };
  bind($('broadcast-select-all'), 'click', () => pick());
  bind($('broadcast-select-groups'), 'click', () => pick('group'));
  bind($('broadcast-select-contacts'), 'click', () => pick('contact'));
  bind($('broadcast-clear'), 'click', () => { selected.clear(); render(); changed(); });
  const radios = [...$('broadcast-overlay').querySelectorAll('input')].filter((node) => node.name === 'bc-sendto'
    || node.getAttribute('name') === 'bc-sendto');
  const supported = new Set(['custom', 'excel', 'paste', 'group-members', 'label', 'all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups']);
  for (const radio of radios) {
    if (radio.value === 'label') radio.closest('label').querySelector('span').textContent = '同一平台标签下的聊天';
    if (!supported.has(radio.value)) {
      unavailable(radio);
      const label = radio.closest('label')?.querySelector('span');
      if (label) label.append(element(document, 'small', 'bc-unavailable-note', '（尚未迁移）'));
      continue;
    }
    bind(radio, 'change', () => {
      if (!radio.checked) return;
      mode = radio.value;
      if (['all', 'all-contacts', 'all-groups'].includes(mode)) {
        selected = new Set(matchingChats(chats(), '', radio.value === 'all' ? null : radio.value === 'all-groups' ? 'group' : 'contact')
          .map((chat) => chat.id));
      }
      if (mode.startsWith('exclude-') && exclusionBase === null) exclusionBase = chats().map((chat) => chat.id);
      render(); changed();
    });
  }
  $('bc-excel-meta').setAttribute('role', 'status');
  $('bc-excel-meta').setAttribute('aria-live', 'polite');
  $('bc-excel-meta').setAttribute('aria-atomic', 'true');
  for (const [kind, id] of [['contact', 'bc-exclude-contacts-select'], ['group', 'bc-exclude-groups-select']]) {
    const select = $(id);
    select.setAttribute('aria-label', kind === 'contact' ? '排除指定联系人' : '排除指定群组');
    bind(select, 'change', () => {
      const ids = new Set([...select.options].filter((option) => option.selected).map((option) => option.value));
      if (kind === 'contact') excludedContacts = ids; else excludedGroups = ids;
      render(); changed();
    });
    const update = button(document, '更新对象', () => {
      if (blocked || !catalog?.ready) return;
      exclusionBase = chats().map((chat) => chat.id);
      render(); changed('audience-updated');
    }, 'bc-btn bc-btn--small bc-pill');
    update.id = `broadcast-update-exclude-${kind}`;
    update.title = '按当前目录更新发送对象，保留排除项';
    const actions = element(document, 'div', 'bc-search-actions');
    actions.append(update); select.after(actions); updateButtons.push(update);
  }

  function selection() {
    const source = mode === 'excel' ? imported : audienceSourceKinds[mode]
      ? sources.ids(audienceSourceKinds[mode])
      : mode.startsWith('exclude-') ? exclusionBase || [] : [...selected];
    const all = [...new Set(source)];
    const recipientIds = all.filter((id) => !excludedContacts.has(id) && !excludedGroups.has(id));
    return { recipientIds, excludedRecipientCount: all.length - recipientIds.length };
  }

  function renderImport() {
    for (const radio of radios) radio.checked = radio.value === mode;
    const separate = ['excel', 'paste', 'group-members', 'label', 'exclude-contacts', 'exclude-groups'];
    hidden($('bc-sendto-custom'), separate.includes(mode));
    hidden($('bc-sendto-excel'), mode !== 'excel');
    for (const value of separate.filter((value) => value !== 'excel')) hidden($(`bc-sendto-${value}`), mode !== value);
    if (separate.includes(mode)) $(`bc-sendto-${mode}`).closest('details').open = true;
    const meta = $('bc-excel-meta');
    const stale = catalog?.ready && imported.some((id) => !chats().some((chat) => chat.id === id));
    meta.textContent = importFeedback?.text || (stale ? '已导入的联系人已失效，请重新导入。' : importSummaryText(importSummary));
    meta.dataset.state = importFeedback?.state || (stale ? 'error' : 'ready');
    meta.title = importFileName;
  }

  function renderExclusions() {
    for (const [kind, id, excluded] of [['contact', 'bc-exclude-contacts-select', excludedContacts],
      ['group', 'bc-exclude-groups-select', excludedGroups]]) {
      const select = $(id);
      const rows = new Map(chats().filter((chat) => chat.kind === kind).map((chat) => [chat.id, chat]));
      for (const id of excluded) if (!rows.has(id)) rows.set(id, { id, name: `${id}（当前不可用）` });
      select.replaceChildren();
      for (const chat of rows.values()) {
        const option = element(document, 'option', '', chat.name || chat.id);
        option.value = chat.id; option.selected = excluded.has(chat.id); select.append(option);
      }
    }
  }

  const vcardRoot = $('bc-vcard-list');
  const vcardSelected = element(document, 'div', 'bc-vcard-selected');
  const vcardSearch = element(document, 'input', 'bc-vcard-search');
  vcardSearch.id = 'bc-vcard-search';
  vcardSearch.type = 'search';
  vcardSearch.placeholder = '搜索联系人或号码…';
  vcardSearch.setAttribute('aria-label', '搜索电子名片');
  const vcardResults = element(document, 'div', 'bc-vcard-results');
  vcardRoot.replaceChildren(element(document, 'div', 'bc-vcard-title', '选择要发送的联系人名片'), vcardSelected, vcardSearch, vcardResults);
  bind(vcardSearch, 'input', renderCards);
  bind($('broadcast-add-vcard'), 'change', () => {
    if (!$('broadcast-add-vcard').checked) cards.clear();
    renderCards(); changed();
  });

  function chip(chat, remove, className) {
    const node = element(document, 'span', className);
    node.append(element(document, 'span', '', chat?.name || chat?.id || '当前不可用对象'));
    const close = button(document, '×', (event) => { event.stopPropagation(); remove(); }, '');
    close.setAttribute('aria-label', `移除 ${chat?.name || chat?.id || '当前不可用对象'}`);
    setAvailable(close, !blocked);
    node.append(close);
    return node;
  }

  function renderCards() {
    hidden(vcardRoot, !$('broadcast-add-vcard').checked);
    vcardSelected.replaceChildren();
    for (const id of cards) {
      vcardSelected.append(chip(chats().find((chat) => chat.id === id), () => {
        cards.delete(id); renderCards(); changed();
      }, 'bc-vcard-selected-chip'));
    }
    vcardResults.replaceChildren();
    const visible = matchingChats(chats(), vcardSearch.value, 'contact').filter((chat) => !cards.has(chat.id));
    for (const chat of visible) {
      const row = element(document, 'label', 'bc-vcard-item');
      const input = element(document, 'input');
      input.type = 'checkbox'; input.value = chat.id;
      input.setAttribute('aria-label', `选择名片 ${chat.name || '未命名联系人'}`);
      setAvailable(input, !blocked && Boolean(catalog?.capabilities.vcards));
      input.addEventListener('change', () => { if (input.checked) cards.add(chat.id); renderCards(); changed(); });
      row.append(input, element(document, 'span', '', chat.name || '未命名联系人'));
      vcardResults.append(row);
    }
    if (!visible.length) vcardResults.append(element(document, 'div', 'bc-vcard-empty', '没有匹配的联系人'));
    setAvailable(vcardSearch, !blocked && Boolean(catalog?.capabilities.vcards));
  }

  function render() {
    renderImport(); sources.render(); renderExclusions();
    const audience = selection();
    $('broadcast-overlay').querySelector('.bc-recipient-card').querySelector('.bc-card-title').querySelector('small').textContent
      = `发送 ${audience.recipientIds.length} 个对象，已排除 ${audience.excludedRecipientCount} 个`;
    $('bc-selected-chips').replaceChildren();
    for (const id of selected) {
      $('bc-selected-chips').append(chip(chats().find((chat) => chat.id === id), () => {
        selected.delete(id); render(); changed();
      }, 'bc-selected-chip'));
    }
    const list = $('broadcast-list');
    list.replaceChildren();
    const visible = matchingChats(chats(), $('broadcast-search').value).filter((chat) => !selected.has(chat.id));
    for (const chat of visible) {
      const row = element(document, 'label', 'broadcast-item');
      const input = element(document, 'input');
      input.type = 'checkbox'; input.value = chat.id;
      input.setAttribute('aria-label', `选择 ${chat.name || chat.id}`);
      setAvailable(input, !blocked && Boolean(catalog?.ready));
      input.addEventListener('change', () => { if (input.checked) selected.add(chat.id); render(); changed(); });
      row.append(input, element(document, 'span', 'broadcast-name', chat.name || chat.id),
        element(document, 'span', `bc-type-badge${chat.kind === 'group' ? ' group' : ''}`, chat.kind === 'group' ? '群组' : '联系人'));
      list.append(row);
    }
    if (!visible.length) list.append(element(document, 'div', 'nav-empty', catalog?.ready ? '没有匹配的聊天' : '聊天列表尚未就绪'));
    $('broadcast-meta').textContent = catalog?.ready ? `共 ${chats().length} 个聊天，已选 ${selected.size} 个` : '聊天列表尚未就绪';
  }

  function availability(value, canImport = importAvailable, nextSources = sourceAvailability) {
    blocked = value;
    importAvailable = canImport;
    sourceAvailability = nextSources;
    sources.availability({ ...sourceAvailability, blocked });
    const ready = Boolean(catalog?.ready);
    for (const id of ['broadcast-search', 'broadcast-select-all', 'broadcast-select-groups', 'broadcast-select-contacts', 'broadcast-clear']) {
      setAvailable($(id), !blocked && ready);
    }
    for (const radio of radios) if (supported.has(radio.value)) {
      const kind = audienceSourceKinds[radio.value];
      setAvailable(radio, !blocked && ready && (radio.value !== 'excel' || importAvailable) && (!kind || sources.available(kind)));
      if (radio.value === 'excel') radio.title = importAvailable ? '从 CSV/TXT 选择联系人' : '联系人文件导入尚不可用';
      if (radio.value === 'paste') radio.title = sources.available('paste') ? '核验粘贴号码后选择联系人' : '号码核验尚不可用';
      if (radio.value === 'group-members') radio.title = sources.available('groups') ? '选择群组并读取成员' : '当前账号的群成员读取尚不可用';
      if (radio.value === 'label') radio.title = sources.available('label') ? '读取平台标签中的聊天' : '当前账号的平台标签尚不可用';
    }
    setAvailable($('broadcast-import-csv'), !blocked && ready && importAvailable);
    $('broadcast-import-csv').title = importAvailable ? '选择 CSV/TXT 联系人文件' : '联系人文件导入尚不可用';
    for (const id of ['bc-exclude-contacts-select', 'bc-exclude-groups-select']) setAvailable($(id), !blocked && ready);
    for (const update of updateButtons) setAvailable(update, !blocked && ready);
    setAvailable($('broadcast-add-vcard'), !blocked && ready && Boolean(catalog?.capabilities.vcards));
    $('broadcast-add-vcard').title = catalog?.capabilities.vcards ? '选择电子名片' : '当前账号的名片能力尚未就绪';
    for (const input of $('broadcast-list').querySelectorAll('input')) setAvailable(input, !blocked && ready);
    for (const close of $('bc-selected-chips').querySelectorAll('button')) setAvailable(close, !blocked);
    for (const input of vcardResults.querySelectorAll('input')) setAvailable(input, !blocked && Boolean(catalog?.capabilities.vcards));
    for (const close of vcardSelected.querySelectorAll('button')) setAvailable(close, !blocked);
    setAvailable(vcardSearch, !blocked && Boolean(catalog?.capabilities.vcards));
  }

  return {
    set(next, draft) {
      catalog = next;
      if (draft) {
        selected = new Set(draft.manualRecipientIds || draft.recipientIds || []);
        cards = new Set(draft.vcardIds || []);
        mode = supported.has(draft.audienceMode) ? draft.audienceMode : 'custom';
        imported = [...(draft.importedRecipientIds || [])];
        importFileName = draft.importFileName || '';
        importSummary = draft.importSummary ? { ...draft.importSummary } : null;
        importFeedback = null;
        exclusionBase = draft.exclusionBaseIds ? [...draft.exclusionBaseIds] : null;
        excludedContacts = new Set(draft.excludedContactIds || []);
        excludedGroups = new Set(draft.excludedGroupIds || []);
      }
      sources.set(next, draft?.sources);
      $('broadcast-add-vcard').checked = cards.size > 0;
      render(); renderCards(); availability(blocked);
    },
    imported(result) {
      catalog = result.catalog; imported = result.recipientIds.slice();
      importFileName = result.fileName; importSummary = { ...result.summary }; importFeedback = null;
      sources.set(catalog);
      render(); renderCards(); availability(blocked);
    },
    resolved(kind, result, revision) {
      catalog = result.catalog; sources.resolved(kind, result, revision);
      render(); renderCards(); availability(blocked);
    },
    restored(result) {
      catalog = result.catalog; selected = new Set(result.recipientIds); mode = 'custom';
      sources.set(catalog); render(); renderCards(); availability(blocked); changed();
    },
    importStatus(text = '', state = 'ready') { importFeedback = text ? { text, state } : null; renderImport(); },
    sourceStatus: sources.status,
    clearCards() { cards.clear(); $('broadcast-add-vcard').checked = false; renderCards(); },
    resetSearch() { $('broadcast-search').value = ''; vcardSearch.value = ''; open(false); },
    values: () => ({ ...selection(), vcardIds: [...cards],
      audienceMode: mode, manualRecipientIds: [...selected], importedRecipientIds: imported.slice(),
      importFileName, importSummary: importSummary ? { ...importSummary } : null,
      sources: sources.values(), exclusionBaseIds: exclusionBase ? [...exclusionBase] : null,
      excludedContactIds: [...excludedContacts], excludedGroupIds: [...excludedGroups] }),
    availability,
    dispose() { for (const remove of listeners) remove(); sources.dispose(); },
  };
}
