use super::{security::authorize, NativeDesktop, SharedDesktop};
use crate::{
    application::snapshot::{CreatedAccounts, Snapshot},
    domain::{
        account::Settings,
        error::{AppError, Result},
        presentation::{Viewport, WindowAction},
        proxy::ProxyConfig,
    },
};
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
