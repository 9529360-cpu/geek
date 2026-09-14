(() => {
  'use strict';

  const LOCK_BUTTON_ID = 'btn-lock';
  const SETTINGS_BUTTON_ID = 'btn-settings';
  const SETTINGS_OVERLAY_ID = 'settings-overlay';
  const LOCK_PASSWORD_ID = 'cfg-lockPassword';
  const STATUS_ID = 'settings-status';
  const HINT = '请先设置锁屏密码，保存后即可使用锁屏。';
  let bypassPreflight = false;
  let preflightPending = false;
  let settingsObserver = null;
  let settingsObserverTimer = null;

  function overlayVisible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function clearObserver() {
    settingsObserver?.disconnect();
    settingsObserver = null;
    if (settingsObserverTimer) clearTimeout(settingsObserverTimer);
    settingsObserverTimer = null;
  }

  function revealSecuritySettings(doc = document) {
    const overlay = doc.getElementById(SETTINGS_OVERLAY_ID);
    if (!overlayVisible(overlay)) return false;
    const status = doc.getElementById(STATUS_ID);
    const field = doc.getElementById(LOCK_PASSWORD_ID);
    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      status.dataset.state = 'error';
      status.dataset.lockPasswordHint = 'true';
      status.textContent = HINT;
    }
    if (field) {
      field.setAttribute('aria-describedby', STATUS_ID);
      field.scrollIntoView?.({ block: 'center', behavior: 'auto' });
      field.focus({ preventScroll: true });
    }
    return true;
  }

  function revealWhenSettingsReady(doc = document) {
    clearObserver();
    const overlay = doc.getElementById(SETTINGS_OVERLAY_ID);
    if (revealSecuritySettings(doc)) return;
    if (!overlay) return;
    settingsObserver = new MutationObserver(() => {
      if (!revealSecuritySettings(doc)) return;
      clearObserver();
    });
    settingsObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    settingsObserverTimer = setTimeout(clearObserver, 3000);
  }

  function openSecuritySettings(doc = document) {
    const settingsButton = doc.getElementById(SETTINGS_BUTTON_ID);
    if (!settingsButton) return false;
    settingsButton.click();
    revealWhenSettingsReady(doc);
    return true;
  }

  function replayAuthoritativeLock(button) {
    bypassPreflight = true;
    try { button.click(); }
    finally { bypassPreflight = false; }
  }

  async function handleLockRequest(event, button) {
    if (bypassPreflight) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (preflightPending) return;

    preflightPending = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const cfg = await window.api.config.get();
      if (cfg?.lockPassword) replayAuthoritativeLock(button);
      else openSecuritySettings(document);
    } catch (_) {
      // Read-only preflight is UX-only. If it cannot decide, fall back to the
      // existing app.js owner rather than inventing a second lock failure mode.
      replayAuthoritativeLock(button);
    } finally {
      preflightPending = false;
      button.removeAttribute('aria-busy');
    }
  }

  function install() {
    if (typeof document === 'undefined') return;
    const button = document.getElementById(LOCK_BUTTON_ID);
    if (!button || typeof window.api?.config?.get !== 'function') return;

    button.addEventListener('click', event => {
      void handleLockRequest(event, button);
    }, true);

    document.getElementById(LOCK_PASSWORD_ID)?.addEventListener('input', event => {
      const status = document.getElementById(STATUS_ID);
      if (status?.dataset.lockPasswordHint !== 'true') return;
      status.textContent = '';
      status.dataset.state = '';
      delete status.dataset.lockPasswordHint;
      event.currentTarget?.removeAttribute('aria-describedby');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
