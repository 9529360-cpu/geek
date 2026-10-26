import { filterAccounts } from '../model.mjs';
import { families, visibleAccounts } from '../models/shell.mjs';
import { accountDisplay } from '../models/account-display.mjs';
import { createAccountOrder } from './account-order.mjs';

export function createAccountView(document) {
  const $ = (id) => document.getElementById(id);
  const order = createAccountOrder($('nav-accounts'));
  function button(className, label, callback) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.dataset.wired = 'true';
    element.setAttribute('aria-label', label);
    element.title = label;
    element.addEventListener('click', callback);
    return element;
  }
  function icon(type) {
    const family = type.startsWith('whatsapp') ? 'whatsapp'
      : type.startsWith('telegram') ? 'telegram' : type.startsWith('line') ? 'line' : 'website';
    const span = document.createElement('span');
    span.className = `p-icon p-icon-${family === 'telegram' ? 'telegram-z' : type}`;
    span.append($(`icon-${family}`).content.firstElementChild.cloneNode(true));
    return span;
  }
  function render(snapshot, family, handlers) {
    const accounts = visibleAccounts(snapshot, family);
    const visibleIds = new Set(accounts.map((account) => account.id));
    order.reset();
    $('side-nav').classList.toggle('compact', accounts.length <= 2);
    $('nav-accounts').replaceChildren();
    if (!accounts.length) {
      const empty = document.createElement('div');
      empty.className = 'nav-empty';
      empty.textContent = '\u8fd9\u4e2a\u5e73\u53f0\u8fd8\u6ca1\u6709\u8d26\u53f7';
      $('nav-accounts').append(empty);
    }
    for (const account of accounts) {
      const active = account.id === snapshot.activeId;
      const row = button(`nav-account${active ? ' active' : ''}`, account.name, (event) => {
        if (order.allowClick(event)) handlers.activate(account.id);
      });
      row.dataset.id = account.id;
      row.setAttribute('aria-pressed', String(active));
      row.title = `${account.name} \u00b7 ${snapshot.openedIds.includes(account.id) ? '\u5df2\u6253\u5f00' : '\u672a\u6253\u5f00'}`;
      const main = document.createElement('span');
      main.className = 'nav-account-main';
      const title = document.createElement('span');
      title.className = 'nav-account-name';
      title.textContent = account.name;
      const { fontSize, fontColor } = accountDisplay(account);
      title.style.fontSize = `${fontSize}px`;
      title.style.color = fontColor;
      main.append(icon(account.platformId), title);
      const dot = document.createElement('span');
      dot.className = 'acc-dot';
      dot.setAttribute('aria-hidden', 'true');
      row.append(main, dot);
      order.bind(row, account.id, visibleIds, handlers.moveAccount);
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        handlers.context(account.id, event.clientX, event.clientY);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          handlers.context(account.id, rect.right, rect.top);
        }
      });
      $('nav-accounts').append(row);
    }
    $('account-tabs').replaceChildren();
    const tabs = families(snapshot);
    if (!tabs.length) {
      const empty = document.createElement('span');
      empty.className = 'nav-empty';
      empty.textContent = '\u8fd8\u6ca1\u6709\u8d26\u53f7\uff0c\u70b9 + \u6dfb\u52a0';
      $('account-tabs').append(empty);
    }
    for (const item of tabs) {
      const tab = button(`tab-item${item.key === family ? ' active' : ''}`, item.name, () => handlers.family(item.key));
      tab.dataset.platform = item.key;
      tab.setAttribute('aria-pressed', String(item.key === family));
      const marker = document.createElement('span');
      marker.className = 'tab-dot';
      marker.setAttribute('aria-hidden', 'true');
      tab.append(icon(item.icon), marker);
      $('account-tabs').append(tab);
    }
    $('empty-state').classList.toggle('hidden', Boolean(snapshot.activeId));
  }
  function platforms(items, selected, choose) {
    $('add-platforms').replaceChildren();
    for (const item of items) {
      const card = button(`add-platform-card${item.id === selected ? ' selected' : ''}`, item.name, () => choose(item.id));
      card.dataset.type = item.id;
      card.dataset.unavailable = String(!item.enabled);
      card.disabled = !item.enabled;
      const badge = icon(item.id);
      badge.classList.add('p-icon-lg');
      const label = document.createElement('span');
      label.className = 'add-platform-label';
      label.textContent = item.name;
      if (!item.enabled) card.title += ' \u00b7 \u6682\u672a\u63a5\u5165';
      card.append(badge, label);
      $('add-platforms').append(card);
    }
  }
  function library(snapshot, manage, restore) {
    const accounts = filterAccounts(snapshot.accounts, snapshot.platforms, $('search').value, $('archived-only').checked);
    $('library-accounts').replaceChildren();
    for (const account of accounts) {
      const row = document.createElement('div');
      row.className = 'library-row';
      const title = document.createElement('strong');
      title.textContent = account.name;
      const action = button('btn-plain', account.archived ? '\u6062\u590d' : '\u8d26\u53f7\u8bbe\u7f6e',
        () => account.archived ? restore(account.id) : manage(account.id));
      action.textContent = account.archived ? '\u6062\u590d' : '\u8d26\u53f7\u8bbe\u7f6e';
      row.append(title, action);
      $('library-accounts').append(row);
    }
  }
  return { render, platforms, library, button };
}
