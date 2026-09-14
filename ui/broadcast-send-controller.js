(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSendController = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;

  function setWorkbenchStatus(doc, text, state = 'error') {
    const status = doc.getElementById('broadcast-workbench-status') || doc.getElementById('broadcast-meta');
    if (!status) return false;
    status.dataset.state = state;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const copy = status.querySelector?.('span');
    if (copy) copy.textContent = String(text || '');
    else status.textContent = String(text || '');
    return true;
  }

  function focusActionableField(doc, message) {
    const text = String(message || '');
    let target = null;
    if (/消息内容|附件|电子名片/.test(text)) target = doc.getElementById('broadcast-message');
    else if (/聊天|发送对象|群组|标签/.test(text)) target = doc.querySelector('.bc-workbench-step[data-step="audience"]');
    else if (/发送时间|定时/.test(text)) target = doc.getElementById('broadcast-schedule-time');
    target?.focus?.({ preventScroll: true });
  }

  function install(doc = document, win = window) {
    if (installed || !doc?.addEventListener) return false;
    installed = true;

    // This capture listener is intentionally installed before broadcast-runtime.js.
    // It owns only the send-button interaction and delegates all business work to
    // the runtime instance. The runtime's private listener remains a compatibility
    // fallback if this controller is absent.
    doc.addEventListener('click', event => {
      const send = event.target?.closest?.('#broadcast-send');
      if (!send) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (send.dataset.runtimePending === '1') return;

      const runtime = win.GeekBroadcastRuntimeInstance;
      if (!runtime || typeof runtime.startFromEditor !== 'function') {
        setWorkbenchStatus(doc, '群发运行时尚未就绪，请稍后重试', 'error');
        return;
      }

      send.dataset.runtimePending = '1';
      send.disabled = true;
      setWorkbenchStatus(doc, '正在检查发送内容和对象…', 'loading');
      void Promise.resolve()
        .then(() => runtime.startFromEditor())
        .catch(error => {
          const message = String(error?.message || error || '无法开始群发');
          setWorkbenchStatus(doc, message, 'error');
          focusActionableField(doc, message);
        })
        .finally(() => {
          send.dataset.runtimePending = '';
          send.disabled = false;
        });
    }, true);
    return true;
  }

  return Object.freeze({ setWorkbenchStatus, focusActionableField, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastSendController.install(), { once: true });
  else window.GeekBroadcastSendController.install();
}
