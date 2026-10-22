use super::{security::authorize, NativeDesktop, SharedDesktop};
use crate::{
    application::snapshot::Snapshot,
    domain::{
        account::Settings,
        error::{AppError, Result},
        proxy::ProxyConfig,
    },
};
use tauri::{State, Webview};

/// Authorization is uniform and cannot be supplied by JavaScript. Blocking
/// storage/native calls run off the UI and async executor threads. The native
/// callbacks only use atomics; they must never lock SharedDesktop.
async fn execute<T, F>(webview: Webview, state: State<'_, SharedDesktop>, operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut NativeDesktop) -> Result<T> + Send + 'static,
{
    authorize(&webview)?;
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut desktop = shared.lock().map_err(|_| AppError::StateUnavailable)?;
        operation(&mut desktop)
    })
    .await
    .map_err(|_| AppError::StateUnavailable)?
}

#[tauri::command]
pub async fn desktop_snapshot(
    webview: Webview,
    state: State<'_, SharedDesktop>,
) -> Result<Snapshot> {
    execute(webview, state, |desktop| Ok(desktop.snapshot())).await
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
    execute(webview, state, move |desktop| {
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
pub async fn account_set_proxy(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    proxy: ProxyConfig,
) -> Result<Snapshot> {
    execute(webview, state, move |desktop| desktop.set_proxy(&id, proxy)).await
}

#[tauri::command]
pub async fn account_rename(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    name: String,
) -> Result<Snapshot> {
    execute(webview, state, move |desktop| desktop.rename(&id, &name)).await
}

#[tauri::command]
pub async fn account_set_archived(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
    archived: bool,
) -> Result<Snapshot> {
    execute(webview, state, move |desktop| {
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
    execute(webview, state, move |desktop| {
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
    execute(webview, state, move |desktop| desktop.activate(&id)).await
}

#[tauri::command]
pub async fn account_close(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
) -> Result<Snapshot> {
    execute(webview, state, move |desktop| desktop.close(&id)).await
}

#[tauri::command]
pub async fn account_reload(
    webview: Webview,
    state: State<'_, SharedDesktop>,
    id: String,
) -> Result<Snapshot> {
    execute(webview, state, move |desktop| desktop.reload(&id)).await
}

#[tauri::command]
pub async fn desktop_layout(webview: Webview, state: State<'_, SharedDesktop>) -> Result<()> {
    execute(webview, state, |desktop| desktop.layout()).await
}
