(() => {
  'use strict';

  const OVERLAY_ID = 'lock-overlay';
  const PASSWORD_ID = 'lock-password';
  const UNLOCK_ID = 'lock-unlock';
  const ERROR_ID = 'lock-error';
  const LOCK_BUTTON_ID = 'btn-lock';
  const inertState = new Map();
  let active = false;
  let returnFocus = null;
  let pendingReturnFocus = null;
  let bodyObserver = null;

  function lockVisible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function decorateLockScreen(overlay, doc = document) {
    if (!overlay) return;
    const title = overlay.querySelector('.lock-title');
    const description = overlay.querySelector('.lock-sub');
    const error = doc.getElementById(ERROR_ID);
    if (title && !title.id) title.id = 'lock-screen-title';
    if (description && !description.id) description.id = 'lock-screen-description';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (title?.id) overlay.setAttribute('aria-labelledby', title.id);
    const describedBy = [description?.id, error?.id].filter(Boolean).join(' ');
    if (describedBy) overlay.setAttribute('aria-describedby', describedBy);
    if (error) {
      error.setAttribute('role', 'alert');
      error.setAttribute('aria-live', 'assertive');
      error.setAttribute('aria-atomic', 'true');
    }
  }

  function isBackgroundNode(node, overlay) {
    return node instanceof HTMLElement && node !== overlay && node.tagName !== 'SCRIPT';
  }

  function makeInert(node) {
    if (!inertState.has(node)) inertState.set(node, !!node.inert);
    node.inert = true;
  }

  function inertBackground(overlay, doc = document) {
    for (const node of doc.body?.children || []) {
      if (isBackgroundNode(node, overlay)) makeInert(node);
    }
    if (!bodyObserver && doc.body) {
      bodyObserver = new MutationObserver((records) => {
        if (!active) return;
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (isBackgroundNode(node, overlay)) makeInert(node);
          }
        }
      });
      bodyObserver.observe(doc.body, { childList: true });
    }
  }

  function restoreBackground() {
    bodyObserver?.disconnect();
    bodyObserver = null;
    for (const [node, wasInert] of inertState) {
      if (node?.isConnected) node.inert = wasInert;
    }
    inertState.clear();
  }

  function lockControls(overlay) {
    if (!overlay) return [];
    const controls = [...overlay.querySelectorAll('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    return controls.filter(node => !node.hidden && !node.closest('.hidden'));
  }

  function focusPassword(doc = document) {
    doc.getElementById(PASSWORD_ID)?.focus({ preventScroll: true });
  }

  function validReturnTarget(target) {
    if (!(target instanceof HTMLElement) || !target.isConnected) return false;
    if (target.closest('[inert]')) return false;
    if (target.closest('.hidden')) return false;
    return true;
  }

  function restoreFocus(doc = document) {
    const target = returnFocus;
    returnFocus = null;
    const fallback = doc.getElementById(LOCK_BUTTON_ID);
    requestAnimationFrame(() => {
      const next = validReturnTarget(target) ? target : fallback;
      next?.focus?.({ preventScroll: true });
    });
  }

  function activateLock(overlay, doc = document) {
    if (active || !lockVisible(overlay)) return;
    active = true;
    overlay.dataset.lockModalActive = 'true';
    const current = doc.activeElement;
    returnFocus = validReturnTarget(pendingReturnFocus)
      ? pendingReturnFocus
      : (current && !overlay.contains(current) && validReturnTarget(current) ? current : doc.getElementById(LOCK_BUTTON_ID));
    pendingReturnFocus = null;
    inertBackground(overlay, doc);
    queueMicrotask(() => focusPassword(doc));
  }

  function deactivateLock(overlay, doc = document) {
    if (!active || lockVisible(overlay)) return;
    active = false;
    delete overlay.dataset.lockModalActive;
    restoreBackground();
    restoreFocus(doc);
  }

  function handleKeydown(event, overlay, doc = document) {
    if (!active || !lockVisible(overlay)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      focusPassword(doc);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = lockControls(overlay);
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

  function install() {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    decorateLockScreen(overlay, document);

    const lockButton = document.getElementById(LOCK_BUTTON_ID);
    lockButton?.addEventListener('click', () => {
      const current = document.activeElement;
      pendingReturnFocus = current instanceof HTMLElement ? current : lockButton;
    }, true);

    overlay.addEventListener('keydown', event => handleKeydown(event, overlay, document), true);
    document.addEventListener('focusin', event => {
      if (!active || !lockVisible(overlay) || overlay.contains(event.target)) return;
      focusPassword(document);
    }, true);

    const observer = new MutationObserver(() => {
      if (lockVisible(overlay)) activateLock(overlay, document);
      else deactivateLock(overlay, document);
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    if (lockVisible(overlay)) activateLock(overlay, document);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
