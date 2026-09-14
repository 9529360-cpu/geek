(() => {
  'use strict';

  const ROW_SELECTOR = '.nav-account[data-id]';
  const MAIN_SELECTOR = '.nav-account-main';
  const BUTTON_SELECTOR = '.shell-account-menu-button';
  const MENU_ITEM_SELECTOR = '.ctx-item[data-act]';
  const ACCOUNT_SETTINGS_OVERLAY_ID = 'account-settings-overlay';
  const ACCOUNT_SETTINGS_DIALOG_SELECTOR = '#account-settings-overlay [role="dialog"]';
  const ACCOUNT_SETTINGS_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const accountSettingsInertState = new Map();
  let accountSettingsBodyObserver = null;
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

  function overlayVisible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function lockVisible() {
    return overlayVisible(document.getElementById('lock-overlay'));
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

  function accountSettingsDialog(overlay) {
    return overlay?.querySelector('[role="dialog"]') || null;
  }

  function accountSettingsControls(overlay) {
    const dialog = accountSettingsDialog(overlay);
    if (!dialog) return [];
    return [...dialog.querySelectorAll(ACCOUNT_SETTINGS_FOCUSABLE_SELECTOR)].filter(node => {
      if (node.hidden || node.closest('.hidden') || node.closest('[inert]')) return false;
      return node.getAttribute?.('aria-hidden') !== 'true';
    });
  }

  function decorateAccountSettingsDialog(overlay) {
    const dialog = accountSettingsDialog(overlay);
    if (!dialog) return;
    const header = dialog.querySelector('.settings-header');
    const title = header?.querySelector('.settings-head-copy > span');
    const target = document.getElementById('account-settings-target');
    const status = document.getElementById('account-settings-status');
    if (title) {
      if (!title.id) title.id = 'account-settings-dialog-title';
      setAttr(dialog, 'aria-labelledby', title.id);
      dialog.removeAttribute('aria-label');
    }
    if (target?.id) setAttr(dialog, 'aria-describedby', target.id);
    if (status) {
      setAttr(status, 'role', 'status');
      setAttr(status, 'aria-live', 'polite');
      setAttr(status, 'aria-atomic', 'true');
    }
    for (const row of dialog.querySelectorAll('.row-item')) {
      const control = row.querySelector('input, select, textarea');
      const label = String(row.querySelector('span')?.textContent || '').trim();
      if (control && label && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby')) {
        setAttr(control, 'aria-label', label);
      }
    }
  }

  function isAccountSettingsBackgroundNode(node, overlay) {
    return !!node
      && node.nodeType === 1
      && node !== overlay
      && node.id !== 'lock-overlay'
      && node.tagName !== 'SCRIPT';
  }

  function rememberAndInertAccountSettingsBackground(node) {
    if (!node || node.nodeType !== 1) return;
    if (!accountSettingsInertState.has(node)) accountSettingsInertState.set(node, !!node.inert);
    node.inert = true;
  }

  function activateAccountSettingsBoundary(overlay) {
    if (!overlayVisible(overlay)) return;
    for (const node of document.body?.children || []) {
      if (isAccountSettingsBackgroundNode(node, overlay)) rememberAndInertAccountSettingsBackground(node);
    }
    if (!accountSettingsBodyObserver && document.body && typeof MutationObserver === 'function') {
      accountSettingsBodyObserver = new MutationObserver(records => {
        if (!overlayVisible(overlay)) return;
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (isAccountSettingsBackgroundNode(node, overlay)) rememberAndInertAccountSettingsBackground(node);
          }
        }
      });
      accountSettingsBodyObserver.observe(document.body, { childList: true });
    }
  }

  function releaseAccountSettingsBoundary() {
    accountSettingsBodyObserver?.disconnect();
    accountSettingsBodyObserver = null;
    for (const [node, wasInert] of accountSettingsInertState) {
      if (node?.isConnected !== false) node.inert = wasInert;
    }
    accountSettingsInertState.clear();
  }

  function focusAccountSettingsPrimary(overlay) {
    const primary = document.getElementById('account-settings-name');
    const fallback = accountSettingsControls(overlay)[0] || accountSettingsDialog(overlay);
    (primary || fallback)?.focus?.({ preventScroll: true });
  }

  function handleAccountSettingsKeydown(event, overlay) {
    if (!overlayVisible(overlay)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById('account-settings-cancel')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = accountSettingsControls(overlay);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const current = controls.indexOf(document.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? controls.length - 1 : current - 1)
      : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
    event.preventDefault();
    controls[next]?.focus({ preventScroll: true });
  }

  function keepAccountSettingsFocusInside(event, overlay) {
    if (!overlayVisible(overlay)) return;
    const dialog = accountSettingsDialog(overlay);
    if (!dialog || dialog.contains(event.target)) return;
    const lock = document.getElementById('lock-overlay');
    if (lockVisible() && lock?.contains(event.target)) return;
    focusAccountSettingsPrimary(overlay);
  }

  function install() {
    const accountRoot = document.getElementById('nav-accounts');
    const contextMenu = document.getElementById('ctx-menu');
    const accountSettingsOverlay = document.getElementById(ACCOUNT_SETTINGS_OVERLAY_ID);
    const proxyOverlay = document.getElementById('proxy-overlay');
    if (!accountRoot || !contextMenu) return;

    ensureButtons(accountRoot, contextMenu);
    decorateMenu(contextMenu);
    decorateAccountSettingsDialog(accountSettingsOverlay);

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

    if (accountSettingsOverlay) {
      accountSettingsOverlay.addEventListener('keydown', event => handleAccountSettingsKeydown(event, accountSettingsOverlay), true);
      document.addEventListener('focusin', event => keepAccountSettingsFocusInside(event, accountSettingsOverlay), true);
      const syncAccountSettingsModal = () => {
        decorateAccountSettingsDialog(accountSettingsOverlay);
        if (overlayVisible(accountSettingsOverlay)) {
          activateAccountSettingsBoundary(accountSettingsOverlay);
          if (!accountSettingsDialog(accountSettingsOverlay)?.contains(document.activeElement)) {
            queueMicrotask(() => focusAccountSettingsPrimary(accountSettingsOverlay));
          }
        } else {
          releaseAccountSettingsBoundary();
          restoreDialogFocus();
        }
      };
      new MutationObserver(syncAccountSettingsModal).observe(accountSettingsOverlay, { attributes: true, attributeFilter: ['class'] });
      syncAccountSettingsModal();
    }
    if (proxyOverlay) new MutationObserver(restoreDialogFocus).observe(proxyOverlay, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
