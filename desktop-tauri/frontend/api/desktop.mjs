// The only JavaScript module allowed to touch the native bridge.
// Expose named operations, never a generic invoke/eval/path API to views.
export function connectDesktop(invoke = globalThis.window?.__TAURI__?.core?.invoke) {
  if (typeof invoke !== 'function') return null;
  return Object.freeze({
    snapshot: () => invoke('desktop_snapshot'),
    create: ({ name, platformId, websiteUrl }) =>
      invoke('account_create', { name, platformId, websiteUrl }),
    rename: (id, name) => invoke('account_rename', { id, name }),
    setArchived: (id, archived) => invoke('account_set_archived', { id, archived }),
    activate: (id) => invoke('account_activate', { id }),
    close: (id) => invoke('account_close', { id }),
    reload: (id) => invoke('account_reload', { id }),
    layout: () => invoke('desktop_layout'),
    settings: (settings) => invoke('desktop_settings', { settings }),
  });
}
