import { matchingChats } from '../models/broadcast.mjs';
import { element, button, wire, hidden, unavailable } from './broadcast-elements.mjs';

export function createAudienceView(document, changed) {
  const $ = (id) => document.getElementById(id);
  let catalog = null;
  let selected = new Set();
  let cards = new Set();
  let blocked = false;
  const listeners = [];
  const bind = (node, type, fn) => {
    node.addEventListener(type, fn);
    listeners.push(() => node.removeEventListener(type, fn));
  };
  const setAvailable = (node, yes) => { wire(node, !yes); };
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
  const supported = new Set(['custom', 'all', 'all-contacts', 'all-groups']);
  for (const radio of radios) {
    if (!supported.has(radio.value)) {
      unavailable(radio);
      const label = radio.closest('label')?.querySelector('span');
      if (label) label.append(element(document, 'small', 'bc-unavailable-note', ' · 尚未迁移'));
      continue;
    }
    bind(radio, 'change', () => {
      if (!radio.checked) return;
      for (const other of radios) other.checked = other === radio;
      if (radio.value !== 'custom') {
        selected = new Set(matchingChats(chats(), '', radio.value === 'all' ? null : radio.value === 'all-groups' ? 'group' : 'contact')
          .map((chat) => chat.id));
      }
      render(); changed();
    });
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
    node.append(element(document, 'span', '', chat?.name || '当前不可用对象'));
    const close = button(document, '×', (event) => { event.stopPropagation(); remove(); }, '');
    close.setAttribute('aria-label', `移除 ${chat?.name || '当前不可用对象'}`);
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
      input.setAttribute('aria-label', `选择 ${chat.name || '未命名聊天'}`);
      setAvailable(input, !blocked && Boolean(catalog?.ready));
      input.addEventListener('change', () => { if (input.checked) selected.add(chat.id); render(); changed(); });
      row.append(input, element(document, 'span', 'broadcast-name', chat.name || '未命名聊天'),
        element(document, 'span', `bc-type-badge${chat.kind === 'group' ? ' group' : ''}`, chat.kind === 'group' ? '群组' : '联系人'));
      list.append(row);
    }
    if (!visible.length) list.append(element(document, 'div', 'nav-empty', catalog?.ready ? '没有匹配的聊天' : '聊天列表尚未就绪'));
    $('broadcast-meta').textContent = catalog?.ready ? `共 ${chats().length} 个聊天 · 已选 ${selected.size} 个` : '聊天列表尚未就绪';
  }

  function availability(value) {
    blocked = value;
    const ready = Boolean(catalog?.ready);
    for (const id of ['broadcast-search', 'broadcast-select-all', 'broadcast-select-groups', 'broadcast-select-contacts', 'broadcast-clear']) {
      setAvailable($(id), !blocked && ready);
    }
    for (const radio of radios) if (supported.has(radio.value)) setAvailable(radio, !blocked && ready);
    setAvailable($('broadcast-add-vcard'), !blocked && ready && Boolean(catalog?.capabilities.vcards));
    $('broadcast-add-vcard').title = catalog?.capabilities.vcards ? '选择电子名片' : '当前账号的名片能力尚未就绪';
    for (const input of $('broadcast-list').querySelectorAll('input')) setAvailable(input, !blocked && ready);
    for (const close of $('bc-selected-chips').querySelectorAll('button')) setAvailable(close, !blocked);
    for (const input of vcardResults.querySelectorAll('input')) setAvailable(input, !blocked && Boolean(catalog?.capabilities.vcards));
    for (const close of vcardSelected.querySelectorAll('button')) setAvailable(close, !blocked);
    setAvailable(vcardSearch, !blocked && Boolean(catalog?.capabilities.vcards));
  }

  return {
    set(next, recipientIds, vcardIds) {
      catalog = next;
      if (recipientIds) selected = new Set(recipientIds);
      if (vcardIds) cards = new Set(vcardIds);
      $('broadcast-add-vcard').checked = cards.size > 0;
      render(); renderCards(); availability(blocked);
    },
    resetSearch() { $('broadcast-search').value = ''; vcardSearch.value = ''; open(false); },
    values: () => ({ recipientIds: [...selected], vcardIds: [...cards] }),
    availability,
    dispose() { for (const remove of listeners) remove(); },
  };
}
