// The only JavaScript module allowed to touch the native bridge.
// Expose named operations, never a generic invoke/eval/path API to views.
export function connectDesktop(invoke = globalThis.window?.__TAURI__?.core?.invoke) {
  if (typeof invoke !== 'function') return null;
  return Object.freeze({
    windowAction: (action) => invoke('desktop_window', { action }),
    snapshot: () => invoke('desktop_snapshot'),
    create: ({ name, platformId, websiteUrl, proxy }) =>
      invoke('account_create', { name, platformId, websiteUrl, proxy }),
    createBatch: ({ name, platformId, websiteUrl, proxy, count }) =>
      invoke('account_create_batch', { name, platformId, websiteUrl, proxy, count }),
    setProxy: (id, proxy) => invoke('account_set_proxy', { id, proxy }),
    rename: (id, name) => invoke('account_rename', { id, name }),
    updateDisplay: (id, name, fontSize, fontColor) => invoke('account_update_display', { id, name, fontSize, fontColor }),
    moveAccount: (id, targetId) => invoke('account_move', { id, targetId }),
    setArchived: (id, archived) => invoke('account_set_archived', { id, archived }),
    activate: (id) => invoke('account_activate', { id }),
    close: (id) => invoke('account_close', { id }),
    reload: (id) => invoke('account_reload', { id }),
    layout: (viewport) => invoke('desktop_layout', { viewport }),
    settings: (settings) => invoke('desktop_settings', { settings }),
    broadcastCatalog: (accountId) => invoke('broadcast_catalog', { accountId }),
    broadcastPickAttachments: (accountId) => invoke('broadcast_pick_attachments', { accountId }),
    broadcastReleaseAttachments: (accountId, attachmentIds) =>
      invoke('broadcast_release_attachments', { accountId, attachmentIds }),
    broadcastImportContacts: (accountId, catalogId) =>
      invoke('broadcast_import_contacts', { accountId, catalogId }),
    broadcastResolveRecipients: (accountId, catalogId, text) =>
      invoke('broadcast_resolve_recipients', { accountId, catalogId, text }),
    broadcastResolveAudience: (accountId, catalogId, source) =>
      invoke('broadcast_resolve_audience', { accountId, catalogId, source }),
    broadcastPresets: (accountId) => invoke('broadcast_presets', { accountId }),
    broadcastSaveExclusions: (accountId, expectedRevision, excludedContactIds, excludedGroupIds) =>
      invoke('broadcast_save_exclusions', { accountId, expectedRevision, excludedContactIds, excludedGroupIds }),
    broadcastSaveMessage: (accountId, expectedRevision, name, message) =>
      invoke('broadcast_save_message', { accountId, expectedRevision, name, message }),
    broadcastSaveAudience: (accountId, catalogId, expectedRevision, name, recipientIds) =>
      invoke('broadcast_save_audience', { accountId, catalogId, expectedRevision, name, recipientIds }),
    broadcastDeletePreset: (accountId, expectedRevision, kind, id) =>
      invoke('broadcast_delete_preset', { accountId, expectedRevision, kind, id }),
    broadcastRestoreAudience: (accountId, catalogId, expectedRevision, presetId) =>
      invoke('broadcast_restore_audience', { accountId, catalogId, expectedRevision, presetId }),
    broadcastExportFailures: (accountId, jobId) =>
      invoke('broadcast_export_failures', { accountId, jobId }),
    broadcastExportContacts: (accountId) => invoke('broadcast_export_contacts', { accountId }),
    broadcastHistory: (accountId) => invoke('broadcast_history', { accountId }),
    broadcastExportHistory: (accountId, expectedRevision) =>
      invoke('broadcast_export_history', { accountId, expectedRevision }),
    accountExportBackup: (accountId) => invoke('account_export_backup', { accountId }),
    accountPickBackup: (accountId) => invoke('account_pick_backup', { accountId }),
    accountRestoreBackup: (accountId, expectedPresetRevision, expectedTranslationRevision, data) =>
      invoke('account_restore_backup', { accountId, expectedPresetRevision, expectedTranslationRevision, data }),
    broadcastCreate: (draft) => invoke('broadcast_create', { draft }),
    broadcastSnapshot: () => invoke('broadcast_snapshot'),
    broadcastControl: (jobId, action) => invoke('broadcast_control', { jobId, action }),
    sessionSnapshot: () => invoke('session_snapshot'),
    contactNotes: (id, identity) => invoke('contact_notes', { id, identity }),
    contactNotesUpdate: (id, identity, note, now) =>
      invoke('contact_notes_update', { id, identity, note, now }),
    sessionLogin: (email, password) => invoke('session_login', { email, password }),
    sessionRefresh: () => invoke('session_refresh'),
    sessionLogout: () => invoke('session_logout'),
    translationContext: (accountId) => invoke('translation_context', { accountId }),
    translationHealth: () => invoke('translation_health'),
    updateTranslation: (id, chatId, policy, expectedRevision) =>
      invoke('account_update_translation', { id, chatId, policy, expectedRevision }),
  });
}
