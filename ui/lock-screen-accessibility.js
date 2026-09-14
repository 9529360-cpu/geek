(() => {
  'use strict';

  let returnFocus = null;

  function visible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function focusables(overlay) {
    return [...overlay.querySelectorAll('#lock-password, #lock-unlock')]
      .filter(node => !node.disabled && node.getAttribute('aria-hidden') !== 'true');
  }

  function setErrorState(error, input) {
    const invalid = !!error && !error.classList.contains('hidden');
    if (error) {
      error.setAttribute('role', 'status');
      error.setAttribute('aria-live', 'polite');
      error.setAttribute('aria-atomic', 'true');
    }
    if (input) {
      input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      input.setAttribute('aria-errormessage', 'lock-error');
    }
  }

  function install() {
    const overlay = document.getElementById('lock-overlay');
    const dialog = overlay?.querySelector('.lock-box');
    const app = document.querySelector('.app');
    const input = document.getElementById('lock-password');
    const unlock = document.getElementById('lock-unlock');
    const error = document.getElementById('lock-error');
    const title = overlay?.querySelector('.lock-title');
    const subtitle = overlay?.querySelector('.lock-sub');
    if (!overlay || !dialog || !app || !input || !unlock) return;

    if (title && !title.id) title.id = 'lock-title';
    if (subtitle && !subtitle.id) subtitle.id = 'lock-description';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', title?.id || 'lock-title');
    if (subtitle?.id) dialog.setAttribute('aria-describedby', subtitle.id);
    input.setAttribute('aria-describedby', subtitle?.id || 'lock-description');
    setErrorState(error, input);

    const sync = () => {
      if (visible(overlay)) {
        if (!returnFocus) {
          const active = document.activeElement;
          if (active && active !== document.body && !overlay.contains(active)) returnFocus = active;
        }
        app.inert = true;
        overlay.setAttribute('data-modal-active', 'true');
        queueMicrotask(() => {
          if (visible(overlay) && !overlay.contains(document.activeElement)) input.focus({ preventScroll: true });
        });
      } else {
        app.inert = false;
        overlay.removeAttribute('data-modal-active');
        const target = returnFocus;
        returnFocus = null;
        if (target?.isConnected && typeof target.focus === 'function') {
          queueMicrotask(() => target.focus({ preventScroll: true }));
        }
      }
    };

    overlay.addEventListener('keydown', event => {
      if (!visible(overlay)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        input.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(overlay);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (index <= 0 ? items.length - 1 : index - 1)
        : (index < 0 || index === items.length - 1 ? 0 : index + 1);
      event.preventDefault();
      items[next].focus({ preventScroll: true });
    });

    document.addEventListener('focusin', event => {
      if (!visible(overlay) || overlay.contains(event.target)) return;
      input.focus({ preventScroll: true });
    });

    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    if (error) new MutationObserver(() => setErrorState(error, input)).observe(error, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
