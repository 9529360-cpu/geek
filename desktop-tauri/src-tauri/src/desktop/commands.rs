pub mod advanced;
pub mod contact_notes;
pub mod translation;

use super::{
    broadcast::{
        BroadcastAudienceSource, BroadcastCatalog, BroadcastDesktop, CreateBroadcast,
        CreatedBroadcast, ExportedBroadcastFailures, ImportedBroadcastContacts,
        PickedBroadcastAttachments, ResolvedBroadcastRecipients,
    },
    security::authorize,
    session::NativeSession,
    NativeDesktop, SharedDesktop,
};
use crate::{
    application::snapshot::{CreatedAccounts, Snapshot},
    domain::{
        account::Settings,
        broadcast::{BroadcastAction, BroadcastSnapshot},
        broadcast_presets::{BroadcastPresetKind, BroadcastPresetSnapshot},
        error::{AppError, Result},
        presentation::{Viewport, WindowAction},
        proxy::ProxyConfig,
        session::SessionSnapshot,
    },
};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Webview};

/// Every command authorizes its native sender before using the blocking executor.
/// Window controls use this boundary without acquiring account/workspace state.
async fn execute<T, F>(webview: Webview, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(AppHandle) -> Result<T> + Send + 'static,
{
    authorize(&webview)?;
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || operation(app))
        .await
        .map_err(|_| AppError::StateUnavailable)?
}

/// Account mutations and guest layout remain serialized, off the UI thread.
async fn execute_workspace<T, F>(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    operation: F,
) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut NativeDesktop) -> Result<T> + Send + 'static,
{
    let shared = state.inner().clone();
    execute(webview, move |_| {
        let mut desktop = shared.lock().map_err(|_| AppError::StateUnavailable)?;
        operation(&mut desktop)
    })
    .await
}

#[tauri::command]
pub async fn desktop_snapshot(
    webview: Webview,
    state: State<'_, SharedDesktop>,
) -> Result<Snapshot> {
    execute_workspace(webview, state, |desktop| Ok(desktop.snapshot())).await
}

#[tauri::command]
pub async fn account_create(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    name: String,
    platform_id: String,
    website_url: Option<String>,
    proxy: Option<ProxyConfig>,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.create(
            &name,
            &platform_id,
            website_url.as_deref(),
            proxy.unwrap_or_default(),
        )
    })
    .await
}

#[tauri::command]
pub async fn account_create_batch(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    name: String,
    platform_id: String,
    website_url: Option<String>,
    proxy: Option<ProxyConfig>,
    count: u8,
) -> Result<CreatedAccounts> {
    execute_workspace(webview, state, move |desktop| {
        desktop.create_batch(
            &name,
            &platform_id,
            website_url.as_deref(),
            proxy.unwrap_or_default(),
            count,
        )
    })
    .await
}

#[tauri::command]
pub async fn account_set_proxy(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    proxy: ProxyConfig,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| desktop.set_proxy(&id, proxy)).await
}

#[tauri::command]
pub async fn account_rename(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    name: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| desktop.rename(&id, &name)).await
}

#[tauri::command]
pub async fn account_update_display(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    name: String,
    font_size: u8,
    font_color: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.update_display(&id, &name, font_size, &font_color)
    })
    .await
}

#[tauri::command]
pub async fn account_move(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    target_id: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.move_account(&id, &target_id)
    })
    .await
}

#[tauri::command]
pub async fn account_set_archived(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    archived: bool,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.set_archived(&id, archived)
    })
    .await
}

#[tauri::command]
pub async fn desktop_settings(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    settings: Settings,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| {
        desktop.set_settings(settings)
    })
    .await
}

#[tauri::command]
pub async fn account_activate(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| desktop.activate(&id)).await
}

#[tauri::command]
pub async fn account_close(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| desktop.close(&id)).await
}

#[tauri::command]
pub async fn account_reload(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
) -> Result<Snapshot> {
    execute_workspace(webview, state, move |desktop| desktop.reload(&id)).await
}

#[tauri::command]
pub async fn desktop_layout(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    viewport: Viewport,
) -> Result<()> {
    execute_workspace(webview, state, move |desktop| desktop.layout(viewport)).await
}

#[tauri::command]
pub async fn desktop_window(webview: Webview, action: WindowAction) -> Result<()> {
    execute(webview, move |app| super::window::apply(&app, action)).await
}

#[tauri::command]
pub async fn broadcast_catalog(webview: Webview, account_id: String) -> Result<BroadcastCatalog> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().catalog(&account_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_import_contacts(
    webview: Webview,
    account_id: String,
    catalog_id: String,
) -> Result<Option<ImportedBroadcastContacts>> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .import_contacts(&app, &account_id, &catalog_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_resolve_recipients(
    webview: Webview,
    account_id: String,
    catalog_id: String,
    text: String,
) -> Result<ResolvedBroadcastRecipients> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .resolve_recipients(&account_id, &catalog_id, &text)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_resolve_audience(
    webview: Webview,
    account_id: String,
    catalog_id: String,
    source: BroadcastAudienceSource,
) -> Result<ResolvedBroadcastRecipients> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .resolve_audience(&account_id, &catalog_id, source)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_presets(
    webview: Webview,
    account_id: String,
) -> Result<BroadcastPresetSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().presets(&account_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_save_exclusions(
    webview: Webview,
    account_id: String,
    expected_revision: u64,
    excluded_contact_ids: Vec<String>,
    excluded_group_ids: Vec<String>,
) -> Result<BroadcastPresetSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().save_exclusions(
            &account_id,
            expected_revision,
            excluded_contact_ids,
            excluded_group_ids,
        )
    })
    .await
}

#[tauri::command]
pub async fn broadcast_save_message(
    webview: Webview,
    account_id: String,
    expected_revision: u64,
    name: String,
    message: String,
) -> Result<BroadcastPresetSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().save_message(
            &account_id,
            expected_revision,
            &name,
            &message,
        )
    })
    .await
}

#[tauri::command]
pub async fn broadcast_save_audience(
    webview: Webview,
    account_id: String,
    catalog_id: String,
    expected_revision: u64,
    name: String,
    recipient_ids: Vec<String>,
) -> Result<BroadcastPresetSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().save_audience(
            &account_id,
            &catalog_id,
            expected_revision,
            &name,
            &recipient_ids,
        )
    })
    .await
}

#[tauri::command]
pub async fn broadcast_delete_preset(
    webview: Webview,
    account_id: String,
    expected_revision: u64,
    kind: BroadcastPresetKind,
    id: String,
) -> Result<BroadcastPresetSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().delete_preset(
            &account_id,
            expected_revision,
            kind,
            &id,
        )
    })
    .await
}

#[tauri::command]
pub async fn broadcast_restore_audience(
    webview: Webview,
    account_id: String,
    catalog_id: String,
    expected_revision: u64,
    preset_id: String,
) -> Result<ResolvedBroadcastRecipients> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().restore_audience(
            &account_id,
            &catalog_id,
            expected_revision,
            &preset_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn broadcast_export_failures(
    webview: Webview,
    account_id: String,
    job_id: String,
) -> Result<ExportedBroadcastFailures> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .export_failures(&app, &account_id, &job_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_create(
    webview: Webview,
    draft: CreateBroadcast,
) -> Result<CreatedBroadcast> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().create(draft)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_pick_attachments(
    webview: Webview,
    account_id: String,
) -> Result<Option<PickedBroadcastAttachments>> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .pick_attachments(&app, &account_id)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_release_attachments(
    webview: Webview,
    account_id: String,
    attachment_ids: Vec<String>,
) -> Result<()> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .release_attachments(&account_id, &attachment_ids)
    })
    .await
}

#[tauri::command]
pub async fn broadcast_snapshot(webview: Webview) -> Result<BroadcastSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>().snapshot()
    })
    .await
}

#[tauri::command]
pub async fn broadcast_control(
    webview: Webview,
    job_id: String,
    action: BroadcastAction,
) -> Result<BroadcastSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<BroadcastDesktop>>()
            .control(&job_id, action)
    })
    .await
}

#[tauri::command]
pub async fn session_snapshot(webview: Webview) -> Result<SessionSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<NativeSession>>().snapshot()
    })
    .await
}

#[tauri::command]
pub async fn session_login(
    webview: Webview,
    email: String,
    password: String,
) -> Result<SessionSnapshot> {
    let password = zeroize::Zeroizing::new(password);
    execute(webview, move |app| {
        app.state::<Arc<NativeSession>>()
            .login(&email, password.to_string())
    })
    .await
}

#[tauri::command]
pub async fn session_refresh(webview: Webview) -> Result<SessionSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<NativeSession>>().refresh()
    })
    .await
}

#[tauri::command]
pub async fn session_logout(webview: Webview) -> Result<SessionSnapshot> {
    execute(webview, move |app| {
        app.state::<Arc<NativeSession>>().logout()
    })
    .await
}
