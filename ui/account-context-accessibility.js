(() => {
  'use strict';

  const ROW_SELECTOR = '.nav-account[data-id]';
  const MAIN_SELECTOR = '.nav-account-main';
  const BUTTON_SELECTOR = '.shell-account-menu-button';
  const MENU_ITEM_SELECTOR = '.ctx-item[data-act]';
  let menuReturn = null;
  let dialogReturn = null;
  let refreshReturn = null;
  let refreshReturnTimer = null;

  function setAttr(node, name, value) {
    if (!node) return;
    const next = String(value);
    if (node.getAttribute(name) !== next) node.setAttribute(name, next);
  }

  function menuVisible(menu) {
    return !!menu && !menu.classList.contains('hidden');
  }

  function rowAccountId(row) {
    return String(row?.dataset?.id || '');
  }

  function rowName(row) {
    return String(row?.querySelector('.nav-account-name')?.textContent || '').trim();
  }

  function findRow(root, accountId) {
    return [...(root?.querySelectorAll(ROW_SELECTOR) || [])]
      .find(row => rowAccountId(row) === String(accountId || '')) || null;
  }

  function focusReturn(root, target) {
    if (!target?.accountId) return false;
    const row = findRow(root, target.accountId);
    const node = target.kind === 'menu'
      ? row?.querySelector(BUTTON_SELECTOR)
      : row?.querySelector(MAIN_SELECTOR);
    if (!node) return false;
    node.focus({ preventScroll: true });
    return true;
  }

  function clearRefreshReturn() {
    refreshReturn = null;
    if (refreshReturnTimer) clearTimeout(refreshReturnTimer);
    refreshReturnTimer = null;
  }

  function expectRefreshReturn(target) {
    clearRefreshReturn();
    refreshReturn = target;
    refreshReturnTimer = setTimeout(() => {
      if (refreshReturn === target) refreshReturn = null;
      refreshReturnTimer = null;
    }, 3000);
  }

  function ensureButtons(accountRoot, contextMenu) {
    if (!accountRoot) return;
    const openAccountId = menuVisible(contextMenu) ? String(contextMenu.dataset.accountId || '') : '';
    for (const row of accountRoot.querySelectorAll(ROW_SELECTOR)) {
      const main = row.querySelector(MAIN_SELECTOR);
      if (!main) continue;
      setAttr(main, 'aria-keyshortcuts', 'Shift+F10');

      let button = row.querySelector(BUTTON_SELECTOR);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON_SELECTOR.slice(1);
        button.textContent = '⋯';
        row.appendChild(button);
      }
      const name = rowName(row);
      setAttr(button, 'aria-label', name ? `更多操作：${name}` : '更多账号操作');
      setAttr(button, 'aria-haspopup', 'menu');
      setAttr(button, 'aria-controls', 'ctx-menu');
      setAttr(button, 'aria-expanded', rowAccountId(row) === openAccountId ? 'true' : 'false');
      setAttr(button, 'tabindex', main.getAttribute('tabindex') === '0' ? '0' : '-1');
    }
  }

  function decorateMenu(menu) {
    if (!menu) return;
    setAttr(menu, 'role', 'menu');
    setAttr(menu, 'aria-label', '账号操作');
    for (const item of menu.querySelectorAll(MENU_ITEM_SELECTOR)) {
      setAttr(item, 'role', 'menuitem');
      setAttr(item, 'tabindex', '-1');
    }
  }

  function openContextMenu(row, returnKind, focusEdge) {
    const accountId = rowAccountId(row);
    if (!accountId) return;
    menuReturn = focusEdge ? { accountId, kind: returnKind } : null;
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.max(8, rect.right - 12),
      clientY: Math.max(8, rect.top + Math.min(rect.height / 2, 22)),
    }));
    if (!focusEdge) return;
    queueMicrotask(() => {
      const items = [...document.querySelectorAll('#ctx-menu:not(.hidden) .ctx-item[data-act]')];
      const target = focusEdge === 'last' ? items.at(-1) : items[0];
      target?.focus({ preventScroll: true });
    });
  }

  function moveMenuFocus(event, menu, accountRoot) {
    if (!menuVisible(menu)) return false;
    const target = event.target?.closest?.(MENU_ITEM_SELECTOR);
    if (!target || !menu.contains(target)) return false;
    const items = [...menu.querySelectorAll(MENU_ITEM_SELECTOR)];
    const index = items.indexOf(target);
    if (index < 0 || !items.length) return false;

    let next = -1;
    if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      items[next].focus({ preventScroll: true });
      return true;
    }

    if (event.key !== 'Enter' && event.key !== ' ') return false;
    event.preventDefault();
    const action = String(target.dataset.act || '');
    const returnTarget = menuReturn;
    if (action === 'refresh' && returnTarget?.accountId) {
      expectRefreshReturn(returnTarget);
      focusReturn(accountRoot, returnTarget);
    } else if ((action === 'edit' || action === 'proxy') && returnTarget?.accountId) {
      dialogReturn = returnTarget;
    }
    menuReturn = null;
    target.click();
    if (action === 'proxy') {
      queueMicrotask(() => document.getElementById('proxy-openProxy')?.focus({ preventScroll: true }));
    }
    return true;
  }

  function install() {
    const accountRoot = document.getElementById('nav-accounts');
    const contextMenu = document.getElementById('ctx-menu');
    const accountSettingsOverlay = document.getElementById('account-settings-overlay');
    const proxyOverlay = document.getElementById('proxy-overlay');
    if (!accountRoot || !contextMenu) return;

    ensureButtons(accountRoot, contextMenu);
    decorateMenu(contextMenu);

    accountRoot.addEventListener('keydown', event => {
      const main = event.target?.closest?.(MAIN_SELECTOR);
      if (main && accountRoot.contains(main) && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(main.closest(ROW_SELECTOR), 'main', 'first');
        return;
      }

      const button = event.target?.closest?.(BUTTON_SELECTOR);
      if (!button || !accountRoot.contains(button)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(button.closest(ROW_SELECTOR), 'menu', event.key === 'ArrowUp' ? 'last' : 'first');
      }
    });

    accountRoot.addEventListener('click', event => {
      const button = event.target?.closest?.(BUTTON_SELECTOR);
      if (!button || !accountRoot.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(button.closest(ROW_SELECTOR), 'menu', event.detail === 0 ? 'first' : '');
    });

    contextMenu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menuVisible(contextMenu)) {
        event.preventDefault();
        event.stopPropagation();
        contextMenu.classList.add('hidden');
        ensureButtons(accountRoot, contextMenu);
        const target = menuReturn;
        menuReturn = null;
        focusReturn(accountRoot, target);
        return;
      }
      moveMenuFocus(event, contextMenu, accountRoot);
    });

    const accountObserver = new MutationObserver(() => {
      ensureButtons(accountRoot, contextMenu);
      if (refreshReturn && focusReturn(accountRoot, refreshReturn)) clearRefreshReturn();
    });
    accountObserver.observe(accountRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'tabindex'],
    });

    const menuObserver = new MutationObserver(() => {
      decorateMenu(contextMenu);
      if (!menuVisible(contextMenu)) {
        menuReturn = null;
      } else if (menuReturn && String(contextMenu.dataset.accountId || '') !== menuReturn.accountId) {
        menuReturn = null;
      }
      ensureButtons(accountRoot, contextMenu);
    });
    menuObserver.observe(contextMenu, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-account-id'],
    });

    const restoreDialogFocus = () => {
      if (!dialogReturn) return;
      if (!accountSettingsOverlay?.classList.contains('hidden')) return;
      if (!proxyOverlay?.classList.contains('hidden')) return;
      const target = dialogReturn;
      dialogReturn = null;
      focusReturn(accountRoot, target);
    };
    if (accountSettingsOverlay) new MutationObserver(restoreDialogFocus).observe(accountSettingsOverlay, { attributes: true, attributeFilter: ['class'] });
    if (proxyOverlay) new MutationObserver(restoreDialogFocus).observe(proxyOverlay, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
