// The only JavaScript module allowed to touch the native bridge.
// Expose named operations, never a generic invoke/eval/path API to views.
export function connectDesktop(invoke = globalThis.window?.__TAURI__?.core?.invoke) {
  if (typeof invoke !== 'function') return null;
  return Object.freeze({
    windowAction: (action) => invoke('desktop_window', { action }),
    snapshot: () => invoke('desktop_snapshot'),
    create: ({ name, platformId, websiteUrl, proxy }) =>
      invoke('account_create', { name, platformId, websiteUrl, proxy }),
    setProxy: (id, proxy) => invoke('account_set_proxy', { id, proxy }),
    rename: (id, name) => invoke('account_rename', { id, name }),
    setArchived: (id, archived) => invoke('account_set_archived', { id, archived }),
    activate: (id) => invoke('account_activate', { id }),
    close: (id) => invoke('account_close', { id }),
    reload: (id) => invoke('account_reload', { id }),
    layout: (viewport) => invoke('desktop_layout', { viewport }),
    settings: (settings) => invoke('desktop_settings', { settings }),
  });
}
