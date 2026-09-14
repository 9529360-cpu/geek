(() => {
  'use strict';

  const OVERLAY_ID = 'proxy-overlay';
  const STATUS_ID = 'proxy-status';
  const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
  let validationAttempted = false;

  function visible(overlay) {
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function ensureStatus(overlay, doc = document) {
    let status = doc.getElementById(STATUS_ID);
    if (status) return status;
    status = doc.createElement('div');
    status.id = STATUS_ID;
    status.className = 'settings-status proxy-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const form = overlay?.querySelector('.add-form');
    form?.appendChild(status);
    return status;
  }

  function decorate(overlay, doc = document) {
    if (!overlay) return;
    const dialog = overlay.querySelector('.add-dialog');
    const title = overlay.querySelector('.settings-header > span, .settings-header .settings-head-copy > span');
    const close = doc.getElementById('proxy-close');
    const port = doc.getElementById('proxy-port');
    if (title && !title.id) title.id = 'proxy-dialog-title';
    dialog?.setAttribute('role', 'dialog');
    dialog?.setAttribute('aria-modal', 'true');
    if (title?.id) dialog?.setAttribute('aria-labelledby', title.id);
    close?.setAttribute('aria-label', '关闭独立代理设置');
    port?.setAttribute('inputmode', 'numeric');
    ensureStatus(overlay, doc);
  }

  function fields(doc = document) {
    return {
      enabled: doc.getElementById('proxy-openProxy'),
      host: doc.getElementById('proxy-host'),
      port: doc.getElementById('proxy-port'),
      status: doc.getElementById(STATUS_ID),
    };
  }

  function setFieldValidity(field, invalid) {
    if (!field) return;
    field.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    if (invalid) field.setAttribute('aria-errormessage', STATUS_ID);
    else field.removeAttribute('aria-errormessage');
  }

  function clearValidation(doc = document) {
    const { host, port, status } = fields(doc);
    setFieldValidity(host, false);
    setFieldValidity(port, false);
    if (status) {
      status.textContent = '';
      status.dataset.state = '';
    }
  }

  function validateProxy(doc = document, { focusInvalid = false } = {}) {
    const { enabled, host, port, status } = fields(doc);
    if (!enabled?.checked) {
      clearValidation(doc);
      return true;
    }

    const hostValue = String(host?.value || '').trim();
    const portValue = String(port?.value || '').trim();
    const hostInvalid = !hostValue;
    const portNumber = Number(portValue);
    const portInvalid = !/^\d+$/.test(portValue) || portNumber < 1 || portNumber > 65535;
    setFieldValidity(host, hostInvalid);
    setFieldValidity(port, portInvalid);

    if (!hostInvalid && !portInvalid) {
      if (status) {
        status.textContent = '';
        status.dataset.state = '';
      }
      return true;
    }

    const message = hostInvalid && portInvalid
      ? '请填写代理主机，并输入 1–65535 的有效端口。'
      : hostInvalid
        ? '请填写代理主机。'
        : '端口必须是 1–65535 的整数。';
    if (status) {
      status.textContent = message;
      status.dataset.state = 'error';
    }
    if (focusInvalid) (hostInvalid ? host : port)?.focus({ preventScroll: true });
    return false;
  }

  function focusableControls(overlay) {
    return [...(overlay?.querySelectorAll(FOCUSABLE) || [])]
      .filter(node => !node.hidden && !node.closest('.hidden'));
  }

  function handleKeydown(event, overlay, doc = document) {
    if (!visible(overlay)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      doc.getElementById('proxy-cancel')?.click();
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

  function onOpen(overlay, doc = document) {
    validationAttempted = false;
    clearValidation(doc);
    queueMicrotask(() => {
      if (!visible(overlay) || overlay.contains(doc.activeElement)) return;
      doc.getElementById('proxy-openProxy')?.focus({ preventScroll: true });
    });
  }

  function install() {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById(OVERLAY_ID);
    const save = document.getElementById('proxy-save');
    if (!overlay || !save) return;
    decorate(overlay, document);

    overlay.addEventListener('keydown', event => handleKeydown(event, overlay, document), true);
    overlay.addEventListener('input', event => {
      if (!validationAttempted || !event.target?.closest?.('#proxy-host, #proxy-port')) return;
      validateProxy(document, { focusInvalid: false });
    }, true);
    overlay.addEventListener('change', event => {
      if (!event.target?.closest?.('#proxy-openProxy')) return;
      if (!event.target.checked) clearValidation(document);
      else if (validationAttempted) validateProxy(document, { focusInvalid: false });
    }, true);
    save.addEventListener('click', event => {
      validationAttempted = true;
      if (validateProxy(document, { focusInvalid: true })) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    let wasVisible = visible(overlay);
    if (wasVisible) onOpen(overlay, document);
    new MutationObserver(() => {
      const isVisible = visible(overlay);
      if (isVisible && !wasVisible) onOpen(overlay, document);
      if (!isVisible && wasVisible) {
        validationAttempted = false;
        clearValidation(document);
      }
      wasVisible = isVisible;
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
