(() => {
  'use strict';

  const EMPTY_ID = 'empty-state';
  const APP_CENTER_ID = 'btn-app-center';
  const ADD_OVERLAY_ID = 'add-overlay';
  const ADD_PLATFORMS_ID = 'add-platforms';
  const ADD_STATUS_ID = 'add-status';
  const PLATFORM_SELECTOR = '.add-platform-card';
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
  let returnFocus = null;
  let restoreAfterClose = false;
  let initialPlatformFocusPending = false;
  let initialFocusTimer = null;

  function overlayVisible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function createTextNode(tag, className, text, doc = document) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function decorateEmptyState(doc = document) {
    const empty = doc.getElementById(EMPTY_ID);
    const appCenter = doc.getElementById(APP_CENTER_ID);
    if (!empty || !appCenter || empty.dataset.onboardingReady === 'true') return;

    const card = doc.createElement('section');
    card.className = 'empty-onboarding-card';
    const icon = createTextNode('div', 'empty-onboarding-icon', '+', doc);
    icon.setAttribute('aria-hidden', 'true');
    const title = createTextNode('h2', 'empty-onboarding-title', '添加第一个账号', doc);
    title.id = 'empty-onboarding-title';
    const body = createTextNode('p', 'empty-onboarding-copy', '把常用聊天和网页账号放进同一个工作台，之后可以从左侧快速切换。', doc);
    body.id = 'empty-onboarding-copy';
    const platforms = createTextNode('p', 'empty-onboarding-platforms', 'WhatsApp · Telegram · LINE · 网站', doc);
    const button = createTextNode('button', 'empty-onboarding-action', '添加账号', doc);
    button.id = 'empty-add-account';
    button.type = 'button';
    button.setAttribute('aria-describedby', 'empty-onboarding-copy');
    button.addEventListener('click', () => appCenter.click());

    card.append(icon, title, body, platforms, button);
    empty.replaceChildren(card);
    empty.dataset.onboardingReady = 'true';
    empty.setAttribute('role', 'region');
    empty.setAttribute('aria-labelledby', title.id);
  }

  function statusNode(doc = document) {
    const status = doc.getElementById(ADD_STATUS_ID);
    if (!status) return null;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    return status;
  }

  function setPlatformStatus(message, state = '', doc = document) {
    const status = statusNode(doc);
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.state = state;
    if (message) status.dataset.platformSelectionHint = 'true';
    else delete status.dataset.platformSelectionHint;
  }

  function platformCards(root = document) {
    return [...(root.querySelectorAll?.(PLATFORM_SELECTOR) || [])];
  }

  function selectedPlatform(root = document) {
    return platformCards(root).find(card => card.classList.contains('selected')) || null;
  }

  function syncPlatformCards(root = document) {
    const cards = platformCards(root);
    const selected = cards.find(card => card.classList.contains('selected')) || null;
    cards.forEach((card, index) => {
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', card === selected ? 'true' : 'false');
      card.setAttribute('tabindex', card === (selected || cards[0]) ? '0' : '-1');
      if (!card.getAttribute('aria-label')) {
        const label = String(card.querySelector('.add-platform-label')?.textContent || '').trim();
        if (label) card.setAttribute('aria-label', label);
      }
      card.dataset.platformIndex = String(index);
    });
  }

  function decorateAddDialog(doc = document) {
    const overlay = doc.getElementById(ADD_OVERLAY_ID);
    const platforms = doc.getElementById(ADD_PLATFORMS_ID);
    const dialog = overlay?.querySelector('.add-dialog');
    const title = overlay?.querySelector('.settings-header > span, .settings-header .settings-head-copy > span');
    const close = doc.getElementById('add-close');
    if (!overlay || !platforms || !dialog) return;

    if (title && !title.id) title.id = 'add-account-dialog-title';
    dialog.setAttribute('role', 'dialog');
    if (title?.id) dialog.setAttribute('aria-labelledby', title.id);
    close?.setAttribute('aria-label', '关闭添加账号');
    platforms.setAttribute('role', 'radiogroup');
    platforms.setAttribute('aria-label', '选择账号平台');
    statusNode(doc);
    syncPlatformCards(platforms);
  }

  function clearInitialFocusTimer() {
    if (initialFocusTimer) clearTimeout(initialFocusTimer);
    initialFocusTimer = null;
  }

  function scheduleInitialPlatformFocus(doc = document) {
    clearInitialFocusTimer();
    const overlay = doc.getElementById(ADD_OVERLAY_ID);
    const platforms = doc.getElementById(ADD_PLATFORMS_ID);
    syncPlatformCards(platforms || doc);
    initialPlatformFocusPending = !selectedPlatform(platforms || doc);
    if (!initialPlatformFocusPending) return;
    initialFocusTimer = setTimeout(() => {
      initialFocusTimer = null;
      if (!initialPlatformFocusPending || !overlayVisible(overlay)) return;
      const first = platformCards(platforms || doc)[0];
      if (!first) return;
      initialPlatformFocusPending = false;
      first.focus({ preventScroll: true });
    }, 100);
  }

  function focusableControls(overlay) {
    if (!overlay) return [];
    return [...overlay.querySelectorAll(FOCUSABLE)]
      .filter(node => !node.hidden && !node.closest('.hidden'));
  }

  function movePlatformFocus(event, platforms) {
    const card = event.target?.closest?.(PLATFORM_SELECTOR);
    if (!card || !platforms.contains(card)) return false;
    const cards = platformCards(platforms);
    const index = cards.indexOf(card);
    if (index < 0 || !cards.length) return false;

    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % cards.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + cards.length) % cards.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cards.length - 1;
    if (next >= 0) {
      event.preventDefault();
      cards[next].click();
      syncPlatformCards(platforms);
      cards[next].focus({ preventScroll: true });
      return true;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return false;
    event.preventDefault();
    card.click();
    syncPlatformCards(platforms);
    card.focus({ preventScroll: true });
    return true;
  }

  function handleDialogKeydown(event, overlay, platforms, doc = document) {
    if (!overlayVisible(overlay)) return;
    if (movePlatformFocus(event, platforms)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      restoreAfterClose = true;
      doc.getElementById('add-cancel')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusableControls(overlay);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const current = controls.indexOf(doc.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? controls.length - 1 : current - 1)
      : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
    event.preventDefault();
    controls[next]?.focus({ preventScroll: true });
  }

  function restoreInvokerFocus(doc = document) {
    const target = returnFocus;
    returnFocus = null;
    if (!(target instanceof HTMLElement) || !target.isConnected || target.closest('.hidden')) return;
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  function install() {
    if (typeof document === 'undefined') return;
    decorateEmptyState(document);
    decorateAddDialog(document);

    const appCenter = document.getElementById(APP_CENTER_ID);
    const overlay = document.getElementById(ADD_OVERLAY_ID);
    const platforms = document.getElementById(ADD_PLATFORMS_ID);
    const confirm = document.getElementById('add-confirm');
    if (!appCenter || !overlay || !platforms || !confirm) return;

    appCenter.addEventListener('click', () => {
      if (overlayVisible(overlay)) return;
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement ? active : appCenter;
      restoreAfterClose = false;
    }, true);

    platforms.addEventListener('keydown', event => movePlatformFocus(event, platforms));
    platforms.addEventListener('click', event => {
      const card = event.target?.closest?.(PLATFORM_SELECTOR);
      if (!card || !platforms.contains(card)) return;
      queueMicrotask(() => {
        syncPlatformCards(platforms);
        const status = statusNode(document);
        if (status?.dataset.platformSelectionHint === 'true') setPlatformStatus('', '', document);
      });
    });

    confirm.addEventListener('click', event => {
      if (selectedPlatform(platforms)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPlatformStatus('请选择一个平台继续。', 'error', document);
      const first = platformCards(platforms)[0];
      first?.focus({ preventScroll: true });
    }, true);

    overlay.addEventListener('focusin', event => {
      if (!initialPlatformFocusPending || selectedPlatform(platforms)) return;
      if (event.target?.closest?.(PLATFORM_SELECTOR)) {
        initialPlatformFocusPending = false;
        clearInitialFocusTimer();
        return;
      }
      const first = platformCards(platforms)[0];
      if (!first) return;
      initialPlatformFocusPending = false;
      clearInitialFocusTimer();
      queueMicrotask(() => first.focus({ preventScroll: true }));
    }, true);

    overlay.addEventListener('keydown', event => handleDialogKeydown(event, overlay, platforms, document), true);
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.closest?.('#add-close, #add-cancel')) restoreAfterClose = true;
    }, true);

    new MutationObserver(() => {
      syncPlatformCards(platforms);
    }).observe(platforms, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    let wasVisible = overlayVisible(overlay);
    if (wasVisible) scheduleInitialPlatformFocus(document);
    new MutationObserver(() => {
      const isVisible = overlayVisible(overlay);
      if (isVisible && !wasVisible) {
        decorateAddDialog(document);
        scheduleInitialPlatformFocus(document);
      } else if (!isVisible && wasVisible) {
        initialPlatformFocusPending = false;
        clearInitialFocusTimer();
        setPlatformStatus('', '', document);
        if (restoreAfterClose) restoreInvokerFocus(document);
        else returnFocus = null;
        restoreAfterClose = false;
      }
      wasVisible = isVisible;
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
