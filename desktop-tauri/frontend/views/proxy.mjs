import { proxyFromFields } from '../models/proxy.mjs';

// Both forms share DOM behavior, never native routing or account state.
export function createProxyForm(document, prefix) {
  const mode = document.getElementById(`${prefix}-proxy-mode`);
  const host = document.getElementById(`${prefix}-proxy-host`);
  const port = document.getElementById(`${prefix}-proxy-port`);
  const fields = document.getElementById(`${prefix}-proxy-fields`);
  function sync(disabled = false) {
    const custom = mode.value !== 'system';
    fields.hidden = !custom;
    host.required = port.required = custom;
    host.disabled = port.disabled = disabled || !custom;
  }
  function render(proxy = { mode: 'system' }) {
    mode.value = proxy.mode;
    host.value = proxy.host || '';
    port.value = proxy.port == null ? '' : String(proxy.port);
    sync();
  }
  render();
  return Object.freeze({ mode, sync, render,
    read: () => proxyFromFields(mode.value, host.value, port.value) });
}
